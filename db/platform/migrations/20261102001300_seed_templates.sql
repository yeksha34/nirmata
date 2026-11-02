-- 013 seeds: the platform default template for each kind, as version 1, pinned at platform scope.
-- Graph structure and placeholders only: no prompt text, no model names, no file paths. The generation
-- server fills the {{...}} placeholders from the asset spec and its own settings. A later release adds
-- version_no + 1 in a new migration and moves the platform pin; existing VNs keep their own pins.
do $seed$
declare
  v_kind  text;
  v_t     uuid;
  v_v     uuid;
  v_body  jsonb;
  v_map   jsonb;
  v_w     int;
  v_h     int;
begin
  -- the owner publishes the shipped defaults directly; people go through publish_template
  alter table platform.templates disable trigger templates_transition;

  foreach v_kind in array array['workflow_sprite', 'workflow_cg', 'workflow_bg', 'vn'] loop
    if exists (select 1 from platform.template_pins where scope_type = 'platform' and kind_key = v_kind) then
      continue;
    end if;

    if v_kind = 'vn' then
      v_body := '{"schema": 1, "routes": [{"key": "common", "kind": "common"}]}'::jsonb;
      v_map  := '{}'::jsonb;
    else
      v_w := case v_kind when 'workflow_sprite' then 512 else 1024 end;
      v_h := case v_kind when 'workflow_sprite' then 768 else 576 end;
      v_body := jsonb_build_object(
        '1', jsonb_build_object('class_type', 'CheckpointLoaderSimple',
               'inputs', jsonb_build_object('ckpt_name', '{{checkpoint}}')),
        '2', jsonb_build_object('class_type', 'CLIPTextEncode',
               'inputs', jsonb_build_object('text', '{{positive}}', 'clip', jsonb_build_array('1', 1))),
        '3', jsonb_build_object('class_type', 'CLIPTextEncode',
               'inputs', jsonb_build_object('text', '{{negative}}', 'clip', jsonb_build_array('1', 1))),
        '4', jsonb_build_object('class_type', 'EmptyLatentImage',
               'inputs', jsonb_build_object('width', v_w, 'height', v_h, 'batch_size', 1)),
        '5', jsonb_build_object('class_type', 'KSampler',
               'inputs', jsonb_build_object('seed', 0, 'steps', 20, 'cfg', 7, 'sampler_name', 'euler',
                 'scheduler', 'normal', 'denoise', 1, 'model', jsonb_build_array('1', 0),
                 'positive', jsonb_build_array('2', 0), 'negative', jsonb_build_array('3', 0),
                 'latent_image', jsonb_build_array('4', 0))),
        '6', jsonb_build_object('class_type', 'VAEDecode',
               'inputs', jsonb_build_object('samples', jsonb_build_array('5', 0), 'vae', jsonb_build_array('1', 2))),
        '7', jsonb_build_object('class_type', 'SaveImage',
               'inputs', jsonb_build_object('images', jsonb_build_array('6', 0), 'filename_prefix', '{{prefix}}')));
      v_map := '{
        "checkpoint": {"node": "1", "input": "ckpt_name"},
        "positive":   {"node": "2", "input": "text"},
        "negative":   {"node": "3", "input": "text"},
        "width":      {"node": "4", "input": "width"},
        "height":     {"node": "4", "input": "height"},
        "seed":       {"node": "5", "input": "seed"},
        "steps":      {"node": "5", "input": "steps"},
        "cfg":        {"node": "5", "input": "cfg"},
        "sampler":    {"node": "5", "input": "sampler_name"},
        "scheduler":  {"node": "5", "input": "scheduler"},
        "prefix":     {"node": "7", "input": "filename_prefix"}
      }'::jsonb;
    end if;

    perform platform.assert_template_valid(v_kind, v_body, v_map);       -- a bad seed stops the migration

    insert into platform.templates (kind_key, scope_type) values (v_kind, 'platform') returning id into v_t;
    insert into platform.template_versions (template_id, kind_key, version_no, body, param_map, checksum, note)
      values (v_t, v_kind, 1, v_body, v_map,
              encode(sha256(convert_to(v_body::text || '|' || v_map::text, 'UTF8')), 'hex'), 'initial default')
      returning id into v_v;
    update platform.templates set publish_status_key = 'published', head_version_id = v_v where id = v_t;
    insert into platform.template_pins (scope_type, kind_key, template_version_id)
      values ('platform', v_kind, v_v);
  end loop;

  alter table platform.templates enable trigger templates_transition;
end $seed$;
