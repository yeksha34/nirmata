-- Clip skip for the asset workflows: lets a ComfyUI graph use the CLIPSetLastLayer node
-- (stop_at_clip_layer = -2 is the usual "clip skip 2" for SD1.5 anime checkpoints).
-- Adds the node to the allow-list for the six workflow kinds. Safe to run again.

insert into platform.allowed_node_types (class_type, kind_keys) values
  ('CLIPSetLastLayer', array['workflow_sprite', 'workflow_cg', 'workflow_bg',
                            'workflow_clothes', 'workflow_adornment', 'workflow_object'])
on conflict (class_type) do update
   set kind_keys = excluded.kind_keys,
       enabled   = true;
