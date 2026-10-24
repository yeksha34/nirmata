// Storyboard graph: arcs as draggable nodes, arc-to-arc links as lines,
// and a per-node context panel driven by the same /api/context traversal
// the drafting tool uses. Node position is pure visualization state saved
// to board_layout.json; drawing a connection is the one action that writes
// a real link into a corpus file (see /api/relations/add on the server).

const $ = (s, r = document) => r.querySelector(s);
const NODE_W = 170, BAND_GAP_X = 60, ROW_GAP = 90, TIMELINE_H = 26;

// Arc filename stem -> shared setting background key. Grouped by where the
// arc physically takes place so recurring locations (the manor study, the
// pens yard, a gala hall...) read as the same place across every arc set
// there, instead of each arc getting its own bespoke, unrelated image. See
// assets/backgrounds/settings/SETTING_BACKGROUND_PROMPTS.md for the prompt
// behind each key and the drop-in convention.
const ARC_SETTINGS = {
  '05.50_arc_the_first_rut': 'pens_yard',
  '05.60_arc_the_weaker_claim': 'pens_yard',
  '05.80_arc_the_pretend_clothed': 'pens_yard',
  '06.25_arc_the_bad_catch': 'mundane_street',
  '07.40_arc_the_rotted_floor': 'mundane_institution',
  '08.35_arc_the_rivals_dog': 'pens_yard',
  '09_arc_the_manors_bite': 'manor_bathing_wing',
  '09.90_arc_the_true_turn': 'manor_bedroom',
  '10_arc_the_remembered_birth': 'pens_burrow',
  '11_arc_the_hill_that_never_asked': 'coven_hall',
  '12_arc_the_take': 'mundane_street',
  '13_arc_the_easy_supply': 'mundane_institution',
  '14_arc_the_wyvern_whole': 'night_sky_cliffs',
  '15_arc_the_first_convert': 'manor_grounds',
  '16_arc_the_channel_and_the_rim': 'pens_quarters',
  '20_arc_the_practice_marks': 'ritual_chamber',
  '21_arc_the_steadying_draught': 'apothecary',
  '24.10_arc_the_gala_circuit': 'gala_hall',
  '24.20_arc_second_reading': 'gala_hall',
  '24.30_arc_the_first_slip': 'gala_alcove',
  '24.40_arc_the_cleanup': 'gala_washroom',
  '24.50_arc_second_skin': 'gala_hall',
  '24.60_arc_the_serpents_charm': 'gala_alcove',
  '24.65_arc_the_denied_request': 'gala_alcove',
  '24.66_arc_the_referred_request': 'gala_alcove',
  '24.70_arc_the_steady_hand': 'gala_hall',
  '24.80_arc_last_gala_before_the_doorstep': 'gala_hall',
  '31_arc_the_two_contracts': 'manor_study',
  '40_arc_the_sleep_tenancy': 'manor_bedroom',
  '41.20_arc_the_clitheroe_lessons': 'law_office',
  '41_arc_the_proof': 'manor_study',
  '42_arc_the_borrowed_hours': 'manor_bedroom',
  '44.50_arc_the_unclad_pressing': 'pens_stall',
  '44.70_arc_the_old_maids_price': 'servant_quarters',
  '44_arc_the_folding_halfbreed': 'mundane_institution',
  '45_arc_the_advance_grant': 'manor_study',
  '46.50_arc_the_breakers_other_trade': 'curse_breaker_workroom',
  '46_arc_cunts_idle_hour': 'manor_grounds',
  '47_arc_the_shared_stall': 'pens_stall',
  '48_arc_the_gushmere_stunt': 'gushmere_slimepool',
  '49_arc_the_owed_kill': 'mundane_street',
  '50_arc_the_sealed_shop': 'gushmere_shopfronts',
  '51.50_arc_the_price_of_knowing': 'ritual_chamber',
  '51_arc_the_second_anchor': 'manor_study',
  '52_arc_the_two_circles': 'mundane_street',
  '53_arc_the_unread_binding': 'curse_breaker_workroom',
  '54_arc_the_waking_house': 'manor_exterior_night',
  '55.50_arc_the_short_yield': 'pens_burrow',
  '55_arc_an_ordinary_tuesday': 'manor_hearth',
  '56_arc_off_hours': 'manor_hearth',
  '57_arc_the_shared_hearth': 'manor_hearth',
  '58.30_arc_milfs_inscription': 'ritual_chamber',
  '58.60_arc_milfs_dealing': 'gushmere_boards',
  '58_arc_undedicated_understanding': 'curse_breaker_workroom',
  '59.10_arc_working_the_old_ground': 'mundane_street',
  '59.20_arc_sport_pet': 'arena_pit',
  '59.30_arc_show_pet': 'noble_estate_hall',
  '59.40_arc_parlour_pet_lent_out': 'manor_hearth',
  '59.50_arc_the_draught': 'apothecary',
  '59.60_arc_the_bad_ground': 'forest_trail',
  '59.70_arc_the_hunt_masters_due': 'forest_trail',
  '59.80_arc_the_crews_custom': 'mundane_institution',
  '59.90_arc_the_bestiary_detail': 'pens_yard',
  '59_arc_the_long_con': 'mundane_street',
  '60_arc_the_terms_end': 'servant_quarters',
  '61.05_arc_the_canid_litters_cost': 'pens_burrow',
  '61.10_arc_the_serpentine_arrangement': 'noble_estate_hall',
  '61.15_arc_the_clutchs_reckoning': 'gestation_serpentine',
  '61.20_arc_the_drakes_due': 'arena_pit',
  '61.25_arc_the_pit_that_didnt_hold': 'gestation_drake',
  '61.30_arc_the_giants_weight': 'noble_estate_hall',
  '61.35_arc_the_weight_she_carried': 'gestation_giant',
  '61.405_arc_what_the_roost_kept': 'wind_roost',
  '61.40_arc_the_quiet_pairing': 'pens_yard',
  '61.415_arc_what_the_current_took': 'underwater_cave',
  '61.41_arc_the_underdock_arrangement': 'underdock_water',
  '61.425_arc_the_den_she_defended': 'gestation_direwolf',
  '61.42_arc_the_wrackholt_den': 'gestation_feline',
  '61.435_arc_the_favor_settled': 'pens_yard',
  '61.43_arc_the_wrenmoor_favor': 'gestation_feline',
  '61.445_arc_the_first_stand': 'open_field',
  '61.44_arc_the_stable_arrangement': 'pens_stall',
  '61.455_arc_the_ash_that_settled': 'pens_forge',
  '61.45_arc_the_forge_pairing': 'pens_forge',
  '61.465_arc_the_web_that_thinned': 'gestation_arachnid',
  '61.46_arc_the_web_chamber': 'gestation_arachnid',
  '61.475_arc_the_venom_that_told_her': 'gestation_doxy',
  '61.48_arc_the_stud_she_became': 'pens_stall',
  '61.495_arc_concentrating_the_line': 'manor_study',
  '61.49_arc_the_pens_own_nerve': 'pens_yard',
  '61.50_arc_the_ordinary_consignment': 'rendering_room',
  '61.51_arc_the_commission': 'rendering_room',
  '61.52_arc_the_full_render': 'rendering_room',
  '61.60_arc_the_open_board': 'auction_block',
  '61.65_arc_favors_of_any_kind': 'gushmere_boards',
  '61.70_arc_the_blood_tier_card': 'arena_pit',
  '61.80_arc_the_walk_in': 'mundane_street',
  '61.85_arc_the_ambush_on_the_lowroad': 'lowroad_ambush',
  '61.90_arc_the_wrackholt_lesson': 'breeding_house_floor',
  '61_arc_lord_ashgroves_kennel': 'breeding_house_floor',
  '62.01_arc_raising_the_serpentine_clutch': 'nursery_serpentine',
  '62.02_arc_raising_the_draconic_hatchling': 'nursery_draconic',
  '62.03_arc_raising_the_giants_line': 'nursery_giant',
  '62.04_arc_raising_the_avian_fledgling': 'nursery_avian',
  '62.05_arc_raising_the_aquatic_brood': 'nursery_aquatic',
  '62.06_arc_raising_the_direwolf_pup': 'nursery_direwolf',
  '62.07_arc_raising_the_feline_kit': 'nursery_feline',
  '62.08_arc_raising_the_equine_foal': 'nursery_equine',
  '62.09_arc_raising_the_infernal_cub': 'nursery_infernal',
  '62.10_arc_raising_the_arachnid_brood': 'nursery_arachnid',
  '62.11_arc_raising_the_insectoid_brood': 'nursery_insectoid',
  '62_arc_raising_the_canid_litter': 'nursery_canid',
  '63.50_arc_the_favor_returned': 'gala_alcove',
  '63_arc_claiming_fuxannas_patronage': 'gala_alcove',
  "99_arc_death's_omen_halfbreed": 'rival_wilds',
};

const state = {
  nodes: [],           // [{path,title,order,status,linksTo:[...]}]
  positions: {},        // path -> {x,y}
  scale: 1,
  pan: { x: 40, y: 40 },
  selected: null,
  depth: 2,
  connectMode: false,
  connectFrom: null,
};

async function api(path, opts) {
  const res = await fetch(path, opts);
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.statusText);
  return res.json();
}

// Bands are timeline columns, one per distinct floor(order) -- the same
// "shared leading integer means same timeframe" convention this corpus
// already uses for split-arc siblings (see /api/chapter-for-arc on the
// server). Arcs in the same band are simultaneous-or-overlapping events --
// different perspectives on the same stretch of story -- and stack
// vertically in that band rather than competing for one x position.
function computeBands(nodes) {
  const keyOf = (n) => Number.isFinite(n.order) ? Math.floor(n.order) : Infinity;
  const keys = [...new Set(nodes.map(keyOf))].sort((a, b) => a - b);
  const indexOfKey = new Map(keys.map((k, i) => [k, i]));
  const itemsPerBand = new Map();
  for (const n of nodes) {
    const idx = indexOfKey.get(keyOf(n));
    if (!itemsPerBand.has(idx)) itemsPerBand.set(idx, []);
    itemsPerBand.get(idx).push(n);
  }
  return { keys, indexOfKey, keyOf, itemsPerBand };
}

function defaultLayout(nodes) {
  // One column per timeline band, arcs sharing a band stacked top to
  // bottom within it -- a starting arrangement only; every node is freely
  // draggable afterward, and dragging never reassigns anything.
  const { keyOf, indexOfKey, itemsPerBand } = computeBands(nodes);
  const pos = {};
  for (const [bandIdx, items] of itemsPerBand) {
    items.forEach((n, row) => {
      pos[n.path] = { x: bandIdx * (NODE_W + BAND_GAP_X) + 20, y: TIMELINE_H + 30 + row * ROW_GAP };
    });
  }
  return pos;
}

async function load() {
  const [nodes, layout] = await Promise.all([api('/api/arc-graph'), api('/api/board/layout')]);
  state.nodes = nodes;
  const defaults = defaultLayout(nodes);
  state.positions = {};
  for (const n of nodes) state.positions[n.path] = (layout.positions && layout.positions[n.path]) || defaults[n.path];
  render();
}

let saveTimer = null;
function persistLayout() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    api('/api/board/layout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ positions: state.positions }) });
  }, 400);
}

function applyTransform() {
  $('#canvas').style.transform = `translate(${state.pan.x}px, ${state.pan.y}px) scale(${state.scale})`;
  $('#zoom-pct').textContent = Math.round(state.scale * 100) + '%';
}

function nodeCenter(path) {
  const p = state.positions[path];
  if (!p) return null;
  return { x: p.x + NODE_W, y: p.y + 20 }; // right edge, roughly vertical middle
}

// Pans the canvas so a node lands roughly centered in the visible
// canvas-wrap viewport -- used both for local clicks and for a node
// reached via 'focus-arc' from another window, where it wasn't ever
// on screen to begin with.
function centerOn(path) {
  const c = nodeCenter(path);
  const wrap = $('#canvas-wrap');
  if (!c || !wrap) return;
  state.pan = {
    x: wrap.clientWidth / 2 - c.x * state.scale,
    y: wrap.clientHeight / 2 - c.y * state.scale,
  };
  applyTransform();
}
function nodeLeft(path) {
  const p = state.positions[path];
  if (!p) return null;
  return { x: p.x, y: p.y + 20 };
}

function renderTimeline() {
  const canvas = $('#canvas');
  canvas.querySelectorAll('.timeline-tick').forEach((n) => n.remove());
  const { keys, indexOfKey } = computeBands(state.nodes);
  for (const k of keys) {
    const idx = indexOfKey.get(k);
    const el = document.createElement('div');
    el.className = 'timeline-tick';
    el.style.position = 'absolute';
    el.style.left = (idx * (NODE_W + BAND_GAP_X) + 20) + 'px';
    el.style.top = '0px';
    el.style.width = NODE_W + 'px';
    el.style.fontSize = '10px';
    el.style.color = 'var(--dim)';
    el.style.borderBottom = '1px dashed var(--border)';
    el.style.paddingBottom = '4px';
    el.textContent = k === Infinity ? 'unordered' : k;
    canvas.appendChild(el);
  }
}

function render() {
  const canvas = $('#canvas');
  canvas.querySelectorAll('.node').forEach((n) => n.remove());
  renderTimeline();
  for (const n of state.nodes) {
    const pos = state.positions[n.path];
    const el = document.createElement('div');
    el.className = 'node' + (state.selected === n.path ? ' selected' : '');
    el.style.left = pos.x + 'px';
    el.style.top = pos.y + 'px';
    el.dataset.path = n.path;
    const arcSlug = n.path.split('/').pop().replace(/\.md$/, '');
    const settingKey = ARC_SETTINGS[arcSlug];
    if (settingKey) {
      el.style.setProperty('--arc-bg', `url('/assets/backgrounds/settings/${settingKey}.jpg')`);
    }
    el.innerHTML = `
      <div class="order">${n.order === Infinity ? '' : n.order}</div>
      <div class="title">${escapeHtml(n.title)}</div>
      <div class="path">${escapeHtml(n.path)}</div>
      ${n.status ? `<span class="badge">${escapeHtml(n.status)}</span>` : ''}
      <div class="connector" title="Drag onto another node to link this arc to it"></div>
    `;
    wireNode(el, n);
    canvas.appendChild(el);
  }
  drawEdges();
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function drawEdges() {
  const svg = $('#edges');
  svg.innerHTML = '';
  let maxX = 0, maxY = 0;
  for (const n of state.nodes) {
    const p = state.positions[n.path];
    maxX = Math.max(maxX, p.x + NODE_W + 40);
    maxY = Math.max(maxY, p.y + 80);
  }
  svg.setAttribute('width', maxX);
  svg.setAttribute('height', maxY);
  for (const n of state.nodes) {
    for (const target of n.linksTo) {
      if (!state.positions[target]) continue;
      const a = nodeCenter(n.path), b = nodeLeft(target);
      if (!a || !b) continue;
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      const midX = (a.x + b.x) / 2;
      path.setAttribute('d', `M ${a.x} ${a.y} C ${midX} ${a.y}, ${midX} ${b.y}, ${b.x} ${b.y}`);
      path.setAttribute('stroke', 'var(--accent2)');
      path.setAttribute('stroke-width', '1.5');
      path.setAttribute('fill', 'none');
      path.setAttribute('opacity', '0.55');
      svg.appendChild(path);
    }
  }
}

// ---- dragging a node (visual reposition, saved but never touches the corpus) ----
function wireNode(el, n) {
  let dragging = false, startX, startY, origX, origY, moved = false;
  el.addEventListener('mousedown', (e) => {
    if (e.target.classList.contains('connector')) return; // handled separately
    e.stopPropagation();
    dragging = true; moved = false;
    startX = e.clientX; startY = e.clientY;
    origX = state.positions[n.path].x; origY = state.positions[n.path].y;
    el.style.cursor = 'grabbing';
  });
  window.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const dx = (e.clientX - startX) / state.scale, dy = (e.clientY - startY) / state.scale;
    if (Math.abs(dx) > 2 || Math.abs(dy) > 2) moved = true;
    state.positions[n.path] = { x: origX + dx, y: origY + dy };
    el.style.left = state.positions[n.path].x + 'px';
    el.style.top = state.positions[n.path].y + 'px';
    drawEdges();
  });
  window.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    el.style.cursor = 'grab';
    if (moved) persistLayout();
    else selectNode(n.path);
  });

  // ---- connector drag: draw a new real link ----
  const connector = el.querySelector('.connector');
  connector.addEventListener('mousedown', (e) => {
    e.stopPropagation();
    state.connectFrom = n.path;
    $('#canvas-wrap').classList.add('connecting');
  });
}

// While drawing a connection, show a live line to the cursor and drop it
// onto whichever node the mouse is over on release.
let liveLine = null;
window.addEventListener('mousemove', (e) => {
  if (!state.connectFrom) return;
  const wrap = $('#canvas-wrap').getBoundingClientRect();
  const cx = (e.clientX - wrap.left - state.pan.x) / state.scale;
  const cy = (e.clientY - wrap.top - state.pan.y) / state.scale;
  const a = nodeCenter(state.connectFrom);
  if (!liveLine) {
    liveLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    liveLine.setAttribute('stroke', 'var(--accent)');
    liveLine.setAttribute('stroke-width', '2');
    liveLine.setAttribute('stroke-dasharray', '4 3');
    $('#edges').appendChild(liveLine);
  }
  liveLine.setAttribute('x1', a.x); liveLine.setAttribute('y1', a.y);
  liveLine.setAttribute('x2', cx); liveLine.setAttribute('y2', cy);
});
window.addEventListener('mouseup', async (e) => {
  if (!state.connectFrom) return;
  const from = state.connectFrom;
  state.connectFrom = null;
  if (liveLine) { liveLine.remove(); liveLine = null; }
  const el = document.elementFromPoint(e.clientX, e.clientY);
  const targetNode = el && el.closest('.node');
  if (targetNode && targetNode.dataset.path && targetNode.dataset.path !== from) {
    try {
      const result = await api('/api/relations/add', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to: targetNode.dataset.path }),
      });
      if (result.alreadyLinked) {
        // no-op, already connected
      }
      await load(); // refresh edges from the corpus's actual link graph
    } catch (err) {
      alert('Could not add link: ' + err.message);
    }
  }
});

async function selectNode(path, { broadcast = true } = {}) {
  state.selected = path;
  render();
  centerOn(path);
  if (broadcast) CuntswellBus.send('focus-arc', { target: 'editor', path });
  const body = $('#sidebar-body');
  body.className = '';
  body.innerHTML = 'Loading context…';
  try {
    const data = await api(`/api/context?arc=${encodeURIComponent(path)}&depth=${state.depth}&maxWords=8000`);
    const items = (data.included || []).map((c) => `
      <div class="ctx-item">
        <div class="t">${escapeHtml(c.title)}</div>
        <div class="p">${escapeHtml(c.path)}</div>
        <span class="role role-${escapeHtml(c.role)}">${escapeHtml(c.role)}${c.words ? ` · ${c.words}w` : ''}</span>
      </div>`).join('');
    const omitted = (data.omitted || []).length
      ? `<h2 style="margin-top:14px;">Omitted For Space (${data.omitted.length})</h2>` +
        data.omitted.map((o) => `<div class="ctx-item"><div class="p">${escapeHtml(o.path)}</div></div>`).join('')
      : '';
    body.innerHTML = `<div style="margin-bottom:8px;color:var(--dim);">${data.totalWords} words total, depth ${state.depth}</div>${items}${omitted}`;
  } catch (err) {
    body.innerHTML = `<div class="empty">Failed to load context: ${escapeHtml(err.message)}</div>`;
  }
}

// ---- pan & zoom on the background ----
function wireCanvas() {
  const wrap = $('#canvas-wrap');
  let panning = false, startX, startY, origPan;
  wrap.addEventListener('mousedown', (e) => {
    if (e.target !== wrap && e.target.id !== 'canvas') return;
    panning = true; wrap.classList.add('panning');
    startX = e.clientX; startY = e.clientY; origPan = { ...state.pan };
  });
  window.addEventListener('mousemove', (e) => {
    if (!panning) return;
    state.pan = { x: origPan.x + (e.clientX - startX), y: origPan.y + (e.clientY - startY) };
    applyTransform();
  });
  window.addEventListener('mouseup', () => { panning = false; wrap.classList.remove('panning'); });
  wrap.addEventListener('wheel', (e) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.08 : 0.08;
    state.scale = Math.min(2.5, Math.max(0.3, state.scale + delta));
    applyTransform();
  }, { passive: false });
}

function wireControls() {
  $('#btn-reset-layout').addEventListener('click', () => {
    state.positions = defaultLayout(state.nodes);
    persistLayout();
    render();
  });
  $('#zoom-in').addEventListener('click', () => { state.scale = Math.min(2.5, state.scale + 0.1); applyTransform(); });
  $('#zoom-out').addEventListener('click', () => { state.scale = Math.max(0.3, state.scale - 0.1); applyTransform(); });
  const depthInput = $('#depth');
  const setDepth = (v) => { state.depth = Math.min(5, Math.max(1, v)); depthInput.value = state.depth; if (state.selected) selectNode(state.selected); };
  $('#depth-dec').addEventListener('click', () => setDepth(state.depth - 1));
  $('#depth-inc').addEventListener('click', () => setDepth(state.depth + 1));
  depthInput.addEventListener('change', () => setDepth(Number(depthInput.value) || 2));
}

// ---- Frameless-window controls (Electron shell only, see index.html's app.js for the same pattern) ----
if (window.electronAPI) {
  $('#window-controls').classList.add('electron');
  $('#win-min').addEventListener('click', () => window.electronAPI.minimize());
  $('#win-max').addEventListener('click', () => window.electronAPI.toggleMaximize());
  $('#win-close').addEventListener('click', () => window.electronAPI.close());
}

// ---- Cross-window actions ----
// 'go-back' here means "clear the current selection" -- there's no deeper
// navigation history on this page, just a selected-node/no-selection state.
$('#btn-back-editor').addEventListener('click', () => { window.opener ? window.close() : (location.href = '/'); });
let readerWinFromBoard = null, readerStandaloneWinFromBoard = null;
$('#btn-open-reader').addEventListener('click', () => {
  readerWinFromBoard = window.open('/reader', 'cuntswell-reader');
  if (readerWinFromBoard) readerWinFromBoard.focus();
  if (state.selected) {
    const slug = state.selected.split('/').pop().replace(/\.md$/, '');
    setTimeout(() => CuntswellBus.send('goto-passage', { target: 'reader', slug }), 300);
  }
});
// Same window name as app.js's own openReaderStandalone() -- clicking
// "Standalone" from either the editor or the board reuses the one window
// rather than spawning duplicates. No goto-passage wiring, same reasoning
// as app.js: the standalone build is a portable file to grab, not a view
// to drive from here.
$('#btn-open-reader-standalone').addEventListener('click', () => {
  readerStandaloneWinFromBoard = window.open('/reader-standalone', 'cuntswell-reader-standalone');
  if (readerStandaloneWinFromBoard) readerStandaloneWinFromBoard.focus();
});
CuntswellBus.on('focus-arc', ({ path, target }) => {
  if (target && target !== 'board') return;
  if (path && state.positions[path]) selectNode(path, { broadcast: false });
});
CuntswellBus.on('close', ({ target }) => { if (!target || target === 'board') window.close(); });
CuntswellBus.on('go-back', ({ target }) => {
  if (target && target !== 'board') return;
  state.selected = null;
  render();
  $('#sidebar-body').innerHTML = '<div class="empty">Select a node to see its context.</div>';
});

// ---- story picker (same switch/create flow as the main editor) ----
async function loadStorySelect() {
  const { active, stories } = await api('/api/stories');
  const sel = $('#story-select');
  sel.innerHTML = stories.map((s) => `<option value="${s}"${s === active ? ' selected' : ''}>${s}</option>`).join('')
    + `<option value="__new__">+ New Story…</option>`;
}
$('#story-select').addEventListener('change', async (e) => {
  const value = e.target.value;
  if (value === '__new__') {
    const name = prompt('New story name (lowercase letters, numbers, - or _):');
    if (!name) return loadStorySelect();
    try {
      await api('/api/stories/create', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
      location.reload();
    } catch (err) { alert('Could not create story: ' + err.message); loadStorySelect(); }
    return;
  }
  try {
    await api('/api/stories/select', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: value }) });
    location.reload();
  } catch (err) { alert('Could not switch story: ' + err.message); loadStorySelect(); }
});
loadStorySelect();

wireCanvas();
wireControls();
applyTransform();
load();
