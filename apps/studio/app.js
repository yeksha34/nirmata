// Story editor frontend. No build step, no deps — talks to server.mjs's
// JSON API and renders everything client-side.

const state = {
  tab: 'chapters',
  currentPath: null,      // path of whatever is in the viewer (arc/card/chapter)
  currentText: '',
  currentIsArc: false,
  contextNodes: [],        // last-loaded compacted context, for highlighting
  contextOmitted: [],
  manualAdds: [],           // cards pulled in via lookup, not part of the traversal
  mode: 'card',             // 'card' (raw-ish render) or 'preview' (reader styling)
  activeJobId: null,
  jobPollTimer: null,
  editing: false,
  cardsExpanded: new Set(), // folder paths currently expanded in the Cards tab tree
  chaptersList: null, // cached /api/chapters response, for Chapters tab + prev/next nav
  currentBody: '',  // currentText with any leading frontmatter block stripped off
  fm: null,         // parsed frontmatter (see parseFrontmatter) for the loaded card, or null
  vcDiffRows: [],         // currently displayed git diff, see computeGitDiffRows
  vcExpandedRanges: [],   // manually-expanded unchanged-context ranges within it
};

// Electron (this app's only real host -- see electron/main.js) does not
// support window.prompt() at all (throws "prompt() is and will not be
// supported" the instant it's called) and window.confirm()/alert() are
// unreliable there too (calls have been observed to hang with no dialog
// ever shown). Every input/confirmation in this file goes through these
// two instead of the native versions, so it works the same whether this
// is opened in Electron or a plain browser tab.
function uiDialog({ message, defaultValue = null, isConfirm = false, isAlert = false }) {
  return new Promise((resolveDialog) => {
    const overlay = document.createElement('div');
    overlay.className = 'ui-dialog-overlay';
    const box = document.createElement('div');
    box.className = 'ui-dialog-box';
    const msg = document.createElement('div');
    msg.className = 'ui-dialog-message';
    msg.textContent = message;
    box.appendChild(msg);
    let input = null;
    if (!isConfirm && !isAlert) {
      input = document.createElement('input');
      input.type = 'text';
      input.className = 'ui-dialog-input';
      input.value = defaultValue || '';
      box.appendChild(input);
    }
    const buttons = document.createElement('div');
    buttons.className = 'ui-dialog-buttons';
    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.textContent = 'Cancel';
    const okBtn = document.createElement('button');
    okBtn.type = 'button';
    okBtn.className = 'ui-dialog-ok';
    okBtn.textContent = 'OK';
    if (!isAlert) buttons.appendChild(cancelBtn); // alert() has nothing to cancel -- just acknowledge it
    buttons.appendChild(okBtn);
    box.appendChild(buttons);
    overlay.appendChild(box);
    document.body.appendChild(overlay);

    const resultFor = (ok) => (isAlert ? undefined : isConfirm ? ok : ok ? input.value : null);
    const finish = (ok) => { overlay.remove(); document.removeEventListener('keydown', onKeydown); resolveDialog(resultFor(ok)); };
    const onKeydown = (e) => {
      if (e.key === 'Escape' && !isAlert) finish(false);
      else if (e.key === 'Enter' && (isAlert || isConfirm || document.activeElement === input)) finish(true);
    };
    cancelBtn.addEventListener('click', () => finish(false));
    okBtn.addEventListener('click', () => finish(true));
    overlay.addEventListener('click', (e) => { if (e.target === overlay && !isAlert) finish(false); });
    document.addEventListener('keydown', onKeydown);
    (input || okBtn).focus();
    if (input) input.select();
  });
}
function uiPrompt(message, defaultValue = '') { return uiDialog({ message, defaultValue, isConfirm: false }); }
function uiConfirm(message) { return uiDialog({ message, isConfirm: true }); }
function uiAlert(message) { return uiDialog({ message, isAlert: true }); }

const $ = (sel) => document.querySelector(sel);
const el = (tag, attrs = {}, children = []) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v);
  }
  for (const c of [].concat(children)) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  return n;
};

async function api(path, opts) {
  const r = await fetch(path, opts);
  if (!r.ok) {
    // Every error route in server.mjs sends { error: "..." } -- surface that
    // instead of a bare status code, or every failure alert in this file
    // reads as an opaque "/api/whatever: 400" with no way to tell why.
    let message = `${path}: ${r.status}`;
    try {
      const body = await r.json();
      if (body && body.error) message = body.error;
    } catch {}
    throw new Error(message);
  }
  return r.json();
}

// ---------- frontmatter: pulled out of the prose into #fm-panel ----------
// Same "key: value" line shape server.mjs's own /api/chapters scan already
// assumes (see its fm loop) -- a line that doesn't match that shape is kept
// verbatim (key: null) and shown read-only rather than silently dropped, so
// nothing about the file's frontmatter is ever lost by round-tripping it
// through this parser.
function parseFrontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  if (!m) return null;
  const fields = m[1].split(/\r?\n/).map((raw) => {
    const km = raw.match(/^([a-zA-Z_][a-zA-Z0-9_]*):\s?(.*)$/);
    if (!km) return { key: null, raw };
    const value = km[2];
    const quoted = /^".*"$/.test(value);
    return { key: km[1], value: quoted ? value.slice(1, -1) : value, quoted };
  });
  return { fields, body: text.slice(m[0].length) };
}
function serializeFrontmatter(fm) {
  const lines = fm.fields.map((f) => f.key === null ? f.raw : `${f.key}: ${f.quoted ? `"${f.value}"` : f.value}`);
  return `---\n${lines.join('\n')}\n---\n`;
}
// Whatever should actually be written to disk right now: the reconstructed
// frontmatter block (if any) plus the body -- live editor buffer while
// editing, otherwise the last-loaded body. Ops (reformat/intensify) and
// Save all want this, not the editor's own value, since that textarea only
// ever holds the body half (see loadCard/renderFmPanel).
function currentFullText() {
  const body = state.editing ? $('#editor').value : state.currentBody;
  return state.fm ? serializeFrontmatter(state.fm) + body : body;
}
function renderFmPanel() {
  const panel = $('#fm-panel');
  if (!panel) return;
  const fields = state.fm?.fields || [];
  if (!fields.some((f) => f.key !== null)) {
    panel.style.display = 'none';
    panel.innerHTML = '';
    return;
  }
  panel.style.display = 'flex';
  panel.innerHTML = '';
  fields.forEach((f) => {
    if (f.key === null) {
      if (!f.raw.trim()) return; // blank line inside the block -- nothing to show
      panel.appendChild(el('div', { class: 'fm-raw' }, f.raw));
      return;
    }
    const row = el('div', { class: 'fm-row' });
    row.appendChild(el('label', {}, f.key.replace(/_/g, ' ')));
    const long = f.key === 'blurb' || f.value.length > 60;
    const input = el(long ? 'textarea' : 'input', { class: 'fm-input' });
    if (!long) input.type = 'text';
    input.value = f.value;
    input.disabled = !state.editing;
    input.addEventListener('input', () => { f.value = input.value; });
    row.appendChild(input);
    panel.appendChild(row);
  });
}

// ---------- minimal markdown -> HTML ----------
// Enough for this corpus's cards: headings, bold/italic, links (internal
// ones intercepted to load in-app), inline code, subtext spans (passed
// through raw), lists, blockquote-ish "> ", paragraphs.
function renderMarkdown(md, fromPath) {
  const lines = md.split('\n');
  let html = '';
  let inList = false;
  const closeList = () => { if (inList) { html += '</ul>'; inList = false; } };

  const inline = (s) => {
    s = s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    // restore subtext spans we intentionally allow through (they only use &lt;span&gt;)
    s = s.replace(/&lt;span class=&quot;subtext&quot; data-subtext=&quot;([^&]*?)&quot;&gt;(.*?)&lt;\/span&gt;/g,
      (m, sub, txt) => `<span class="subtext" data-subtext="${sub}">${txt}</span>`);
    s = s.replace(/&lt;span class="subtext" data-subtext="([^"]*?)"&gt;(.*?)&lt;\/span&gt;/g,
      (m, sub, txt) => `<span class="subtext" data-subtext="${sub}">${txt}</span>`);
    s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
    s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/\*(.+?)\*/g, '<em>$1</em>');
    s = s.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<em>[image: $1]</em>');
    s = s.replace(/\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (m, text, target) => {
      if (/^(https?:|mailto:)/.test(target)) return `<a href="${target}" target="_blank" rel="noopener">${text}</a>`;
      return `<a href="#" class="internal-link" data-target="${target}" data-from="${fromPath}">${text}</a>`;
    });
    return s;
  };

  for (const raw of lines) {
    const line = raw;
    if (/^---\s*$/.test(line)) { closeList(); html += '<hr>'; continue; }
    let m;
    if ((m = /^(#{1,4})\s+(.*)$/.exec(line))) {
      closeList();
      const level = m[1].length;
      html += `<h${level}>${inline(m[2])}</h${level}>`;
      continue;
    }
    if ((m = /^\*\s+(.*)$/.exec(line)) || (m = /^-\s+(.*)$/.exec(line))) {
      if (!inList) { html += '<ul>'; inList = true; }
      html += `<li>${inline(m[1])}</li>`;
      continue;
    }
    if (/^\s*$/.test(line)) { closeList(); continue; }
    closeList();
    html += `<p>${inline(line)}</p>`;
  }
  closeList();
  return html;
}

// ---------- viewer ----------
function markLinkExistence(container, links) {
  const byTarget = new Map(links.map((l) => [l.target, l]));
  container.querySelectorAll('a.internal-link').forEach((a) => {
    const l = byTarget.get(a.dataset.target);
    if (l && !l.exists) a.classList.add('broken-link');
  });
}

// ---------- remarks: notes pinned to quoted text, stored outside the chapter ----------
state.remarks = [];
function currentProse() { return state.editing ? $('#editor').value : (state.currentBody || ''); }
function remarkOffset(r) {
  const text = currentProse();
  if (r.quote && text.slice(r.start, r.start + r.quote.length) === r.quote) return r.start;
  const i = r.quote ? text.indexOf(r.quote) : -1;
  return i;
}
async function saveRemarks() {
  await api('/api/remarks', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: state.currentPath, remarks: state.remarks }) });
}
async function loadRemarks(path) {
  try { state.remarks = await api(`/api/remarks?path=${encodeURIComponent(path)}`); } catch { state.remarks = []; }
  renderRemarks();
}
function renderRemarks() {
  const box = $('#remarks-panel');
  box.innerHTML = '';
  if (!state.currentPath || !state.remarks.length) { box.style.display = 'none'; return; }
  box.style.display = 'block';
  box.appendChild(el('h2', {}, `Remarks (${state.remarks.filter((r) => !r.resolved).length} open)`));
  for (const r of state.remarks) {
    const off = remarkOffset(r);
    const note = el('textarea', { class: 'remark-note', rows: '2' });
    note.value = r.note;
    note.addEventListener('change', async () => { r.note = note.value; await saveRemarks(); });
    const mk = (label, fn) => { const b = el('button', { type: 'button' }, label); b.addEventListener('click', fn); return b; };
    const item = el('div', { class: 'remark' + (r.resolved ? ' resolved' : ''), style: 'border:1px solid var(--border);border-radius:4px;padding:6px;margin:6px 0;' }, [
      el('div', { style: 'font-style:italic;color:var(--dim);font-size:12px;cursor:pointer;' }, `“${r.quote.length > 120 ? r.quote.slice(0, 120) + '…' : r.quote}”${off < 0 ? ' — text changed, no longer found' : ''}`),
      note,
      el('div', { style: 'display:flex;gap:6px;margin-top:4px;' }, [
        mk(r.resolved ? 'Reopen' : 'Resolve', async () => { r.resolved = !r.resolved; await saveRemarks(); renderRemarks(); }),
        mk('Delete', async () => { state.remarks = state.remarks.filter((x) => x.id !== r.id); await saveRemarks(); renderRemarks(); }),
      ]),
    ]);
    item.firstChild.addEventListener('click', () => {
      if (off < 0) return;
      if (state.editing) {
        const ta = $('#editor'); ta.focus(); ta.setSelectionRange(off, off + r.quote.length);
      } else {
        // Reading view: select the quote in the rendered text if it's there.
        const v = $('#viewer'); const w = document.createTreeWalker(v, NodeFilter.SHOW_TEXT);
        for (let n; (n = w.nextNode());) {
          const i = n.nodeValue.indexOf(r.quote.slice(0, 40));
          if (i >= 0) { const rg = document.createRange(); rg.setStart(n, i); rg.setEnd(n, Math.min(n.nodeValue.length, i + r.quote.length)); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(rg); n.parentElement.scrollIntoView({ block: 'center' }); break; }
        }
      }
    });
    box.appendChild(item);
  }
}
$('#btn-add-remark').addEventListener('click', async () => {
  if (!state.currentPath) return;
  let quote = '', start = -1;
  if (state.editing) {
    const ta = $('#editor'); quote = ta.value.slice(ta.selectionStart, ta.selectionEnd); start = ta.selectionStart;
  } else {
    quote = String(getSelection()).trim(); start = currentProse().indexOf(quote);
  }
  if (!quote.trim()) { await uiAlert('Select some text first, then click + Remark.'); return; }
  state.remarks.push({ id: crypto.randomUUID(), quote, start, note: '', resolved: false, created: new Date().toISOString() });
  await saveRemarks();
  renderRemarks();
  const notes = document.querySelectorAll('#remarks-panel .remark-note');
  if (notes.length) notes[notes.length - 1].focus();
});

async function loadCard(path, { asArc = false } = {}) {
  const data = await api(`/api/card?path=${encodeURIComponent(path)}`);
  state.currentPath = path;
  state.currentText = data.text;
  state.fm = parseFrontmatter(data.text);
  state.currentBody = state.fm ? state.fm.body : data.text;
  state.currentIsArc = asArc;
  state.editing = false;
  setEditingUI(false);
  $('#breadcrumb').textContent = path;
  renderFmPanel();
  renderViewer(data);
  if (asArc) await reloadContext(path);
  applyHighlights();
  refreshOpsButtons();
  refreshVersionControl(path);
  refreshImageBox(path);
  loadRemarks(path);
  refreshChapterNav(path);
  if (asArc) refreshArcChapterLinks(path);
  else { $('#arc-chapter-links').style.display = 'none'; $('#arc-chapter-links').innerHTML = ''; }
  $('#draft-controls').style.display = asArc ? 'flex' : 'none';
  $('#draft-hint').style.display = asArc ? 'block' : 'none';
  if (asArc) $('#draft-name').value = path.replace(/^.*\//, '').replace(/\.md$/, '');
  refreshPublishToggle(path, data.text);
}

// ---------- image box: character portrait, expression chosen by context ----------
// Always visible (per the box's job — "what's on screen right now" should
// always have a visual anchor). Primary source: /api/portrait — scores the
// loaded text against an emotion lexicon and picks whichever character
// with a portrait set (assets/portraits/<slug>/) is actually mentioned
// most; the server already falls back to assets/portraits/_default.* when
// nothing matches. Only if even that's missing does this fall through to
// the static per-path lookup (/api/image), and only as an absolute last
// resort to a built-in inline-SVG silhouette so the box never has to hide.
const SILHOUETTE_SVG = 'data:image/svg+xml;utf8,' + encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 220 220">
    <rect width="220" height="220" fill="#100c0a"/>
    <circle cx="110" cy="88" r="42" fill="#3a2f28"/>
    <path d="M30 210 Q110 130 190 210 Z" fill="#3a2f28"/>
  </svg>`
);

function setImageBox({ url, label, path, fallback }) {
  const box = $('#image-box');
  box.classList.toggle('empty', !url);
  box.classList.toggle('fallback', !!fallback);
  $('#image-box-img').src = url ? url + `?t=${Date.now()}` : SILHOUETTE_SVG;
  $('#image-box-label').textContent = label;
  $('#image-box-path').textContent = path || '';
}

async function refreshImageBox(path) {
  try {
    const portrait = await api(`/api/portrait?path=${encodeURIComponent(path)}`);
    if (portrait.url && !portrait.character) {
      // Generic placeholder (assets/portraits/_default.*) — no specific
      // character detected in this text at all.
      return setImageBox({
        url: portrait.url, fallback: true,
        label: '(no character with a portrait detected here)',
        path: portrait.reason || '',
      });
    }
    if (portrait.url) {
      // Two personas resolve on different axes: Cuntessa (the default) by
      // emotion, Tittiana by which of her forms the text describes — see
      // resolvePortrait()/resolveTittianaPortrait() in server.mjs. Handle
      // whichever pair of fields this particular result actually carries.
      const axis = portrait.form !== undefined ? 'form' : 'emotion';
      const value = portrait.form !== undefined ? portrait.form : portrait.emotion;
      const hasArt = portrait.form !== undefined ? portrait.hasFormArt : portrait.hasEmotionArt;
      const scoreStr = Object.entries(portrait.scores || {}).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join(' ');
      return setImageBox({
        url: portrait.url, fallback: !hasArt,
        label: `${portrait.character} — ${value}${hasArt ? '' : ` (no art for this ${axis} — nearest available shown)`}`,
        path: scoreStr || `(no ${axis} keywords matched — defaulted)`,
      });
    }
    // No portrait character detected and no generic default exists yet —
    // fall back to a static per-path image.
    const data = await api(`/api/image?path=${encodeURIComponent(path)}`);
    if (data.url) {
      return setImageBox({
        url: data.url, fallback: !data.specific,
        label: data.specific ? path.split('/').pop() : `(no image for this card — showing ${data.category || 'default'} placeholder)`,
        path: data.specific ? `tools/story_editor/assets/${path.replace(/\.md$/, '')}.*` : (portrait.reason || ''),
      });
    }
    setImageBox({ url: null, fallback: true, label: '(no portrait art for anything detected here yet)', path: '' });
  } catch {
    setImageBox({ url: null, fallback: true, label: '(image lookup failed)', path: '' });
  }
}

// ---------- in-place edit/save ----------
function setEditingUI(on) {
  $('#viewer').style.display = on ? 'none' : '';
  $('#editor-wrap').style.display = on ? 'flex' : 'none';
  $('#btn-edit').style.display = on ? 'none' : '';
  $('#btn-save').style.display = on ? '' : 'none';
  $('#btn-cancel-edit').style.display = on ? '' : 'none';
  $('#save-status').style.display = 'none';
  // Always reset preview/diff mode on any editing-state transition — entering
  // edit on a freshly-loaded card should never show a stale preview/diff
  // pane left over from whatever the previous card's editing session had.
  setPreviewMode('off');
}

function stepInput(inputEl, delta) {
  const min = Number(inputEl.dataset.min ?? -Infinity);
  const max = Number(inputEl.dataset.max ?? Infinity);
  const cur = Number(inputEl.value) || 0;
  inputEl.value = Math.min(max, Math.max(min, cur + delta));
  inputEl.dispatchEvent(new Event('change'));
}
$('#ctx-depth-dec').addEventListener('click', () => stepInput($('#ctx-depth'), -1));
$('#ctx-depth-inc').addEventListener('click', () => stepInput($('#ctx-depth'), 1));

// ---- Frameless-window controls (Electron shell only) ----
// window.electronAPI only exists when this page is loaded inside the
// Electron shell (see electron/preload.js) -- opened as a plain browser
// tab, there's no frameless window to control, so the buttons just stay
// hidden and #window-controls never gets the .electron class.
if (window.electronAPI) {
  $('#window-controls').classList.add('electron');
  $('#win-min').addEventListener('click', () => window.electronAPI.minimize());
  $('#win-max').addEventListener('click', () => window.electronAPI.toggleMaximize());
  $('#win-close').addEventListener('click', () => window.electronAPI.close());
}

// ---- Cross-window actions: storyboard & reader popups ----
// Named window.open() targets so a second click focuses the existing popup
// instead of spawning a duplicate; CuntswellBus (msgbus.js) is the actual
// message channel once that window exists, since a same-origin popup can't
// otherwise be told "select this arc" or "jump to this passage" after it's
// already open.
let readerWin = null, boardWin = null, readerStandaloneWin = null;
function openReader(slug) {
  readerWin = window.open('/reader', 'cuntswell-reader');
  if (readerWin) readerWin.focus();
  if (slug) setTimeout(() => CuntswellBus.send('goto-passage', { target: 'reader', slug }), 300);
}
// Separate window/name from openReader() above so both can be open at
// once -- this one rebuilds with every image embedded inline (base64),
// which is a much heavier build (~72MB response) and takes noticeably
// longer to come back than the plain reader. No goto-passage wiring here:
// the standalone build is meant to be grabbed as a single portable file,
// not driven from the editor the way the live reader window is.
function openReaderStandalone() {
  readerStandaloneWin = window.open('/reader-standalone', 'cuntswell-reader-standalone');
  if (readerStandaloneWin) readerStandaloneWin.focus();
}
function openBoard(path) {
  boardWin = window.open('/board', 'cuntswell-board');
  if (boardWin) boardWin.focus();
  if (path) setTimeout(() => CuntswellBus.send('focus-arc', { target: 'board', path }), 300);
}
$('#btn-open-reader').addEventListener('click', () => {
  // Open on whatever is current: the open arc or chapter, else the first
  // chapter in reading order. goto-passage ignores slugs the reader lacks.
  const cur = state.currentPath || (state.chaptersList && state.chaptersList[0] && state.chaptersList[0].path);
  const slug = cur ? cur.split('/').pop().replace(/\.md$/, '') : null;
  openReader(slug);
});
$('#btn-open-reader-standalone').addEventListener('click', () => openReaderStandalone());
$('#btn-open-board').addEventListener('click', () => openBoard(state.currentIsArc ? state.currentPath : null));
$('#btn-close-others').addEventListener('click', () => {
  CuntswellBus.send('close', { target: 'board' });
  CuntswellBus.send('close', { target: 'reader' });
  // No goto-passage/CuntswellBus wiring on the standalone build (see
  // openReaderStandalone() above), so it isn't reachable by that broadcast
  // -- close it directly via the window reference instead.
  if (readerStandaloneWin && !readerStandaloneWin.closed) readerStandaloneWin.close();
});

// ---- Export / import: desktop counterparts to the mobile app's
// zip/EPUB/Twine-reader export and zip import (see CorpusZip/EpubExporter/
// TwineExporter on that side). Each export is a plain GET that comes back
// with Content-Disposition: attachment, so just navigating to it triggers
// the browser/Electron download -- no blob/anchor juggling needed. Import
// is the one destructive action here, so it gets a confirm() first.
function triggerDownload(exportPath, busyLabel) {
  const status = $('#global-stats');
  const prevText = status.textContent;
  status.textContent = busyLabel;
  // A same-tab navigation to a Content-Disposition:attachment response
  // downloads the file without leaving the page -- no iframe/anchor needed.
  const iframe = document.createElement('iframe');
  iframe.style.display = 'none';
  iframe.src = exportPath;
  document.body.appendChild(iframe);
  setTimeout(() => { iframe.remove(); status.textContent = prevText; }, 4000);
}
$('#btn-export-zip').addEventListener('click', () => triggerDownload('/api/export/zip', 'Exporting .zip…'));
$('#btn-export-epub').addEventListener('click', () => triggerDownload('/api/export/epub', 'Building ebook…'));
$('#btn-export-twine').addEventListener('click', () => triggerDownload('/api/export/twine', 'Building Twine reader (embeds every image, can take a while)…'));

$('#btn-import-zip').addEventListener('click', () => $('#import-zip-input').click());
$('#import-zip-input').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = ''; // let the same file be picked again later
  if (!file) return;
  if (!(await uiConfirm(`Import "${file.name}"? This REPLACES every file in the active story with what's in the zip.`))) return;
  const status = $('#global-stats');
  const prevText = status.textContent;
  status.textContent = 'Importing…';
  try {
    const bytes = await file.arrayBuffer();
    const r = await fetch('/api/import/zip', { method: 'POST', body: bytes });
    const result = await r.json();
    if (!r.ok) throw new Error(result.error || `import failed: ${r.status}`);
    await uiAlert(`Imported ${result.fileCount} files (${result.markdownCount} markdown)` +
      (result.skippedEntries.length ? `\n${result.skippedEntries.length} entries skipped (unsafe path): ${result.skippedEntries.join(', ')}` : '.'));
    location.reload();
  } catch (err) {
    await uiAlert('Import failed: ' + err.message);
  } finally {
    status.textContent = prevText;
  }
});

// The storyboard broadcasts 'card-loaded' semantics via 'focus-arc' when a
// node is clicked there -- if that's an arc this editor already knows
// about, load it, so clicking a node in one window drives the other.
CuntswellBus.on('focus-arc', ({ path, target }) => {
  if (target && target !== 'editor') return;
  if (path) loadCard(path, { asArc: true });
});

// ---- Story picker: switch or create the active stories/<name>/ tree ----
const NEW_STORY_VALUE = '__new__';
// The folder name has to match driver.mjs's ^[a-z0-9][a-z0-9_-]*$ (both
// createStory and renameStory enforce it server-side too) -- typing a
// natural title like "My Story" used to just come back as a bare 400.
// Slugify what was typed instead of rejecting it outright.
function slugifyStoryName(input) {
  return input.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^[-_]+|-+$/g, '') || 'story';
}
async function loadStorySelect() {
  const { active, stories } = await api('/api/stories');
  const sel = $('#story-select');
  sel.innerHTML = stories.map((s) => `<option value="${s}"${s === active ? ' selected' : ''}>${s}</option>`).join('')
    + `<option value="${NEW_STORY_VALUE}">+ New Story…</option>`;
}
$('#story-select').addEventListener('change', async (e) => {
  const sel = e.target;
  const value = sel.value;
  if (value === NEW_STORY_VALUE) {
    const typed = await uiPrompt('New story name:');
    if (!typed) { await loadStorySelect(); return; } // restore selection to the still-active story
    const name = slugifyStoryName(typed);
    try {
      await api('/api/stories/create', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
      location.reload(); // simplest correct way to drop every cache (arcs, chapters, hidden set, open card) tied to the old story
    } catch (err) {
      await uiAlert('Could not create story: ' + err.message);
      await loadStorySelect();
    }
    return;
  }
  try {
    await api('/api/stories/select', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: value }) });
    location.reload();
  } catch (err) {
    await uiAlert('Could not switch story: ' + err.message);
    await loadStorySelect();
  }
});
$('#btn-rename-story').addEventListener('click', async () => {
  const sel = $('#story-select');
  const oldName = sel.value;
  if (!oldName || oldName === NEW_STORY_VALUE) return;
  const typed = await uiPrompt('Rename story to:', oldName);
  if (!typed) return;
  const newName = slugifyStoryName(typed);
  if (newName === oldName) return;
  try {
    await api('/api/stories/rename', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ oldName, newName }) });
    location.reload(); // same full-reload-on-story-change convention as select/create above
  } catch (err) {
    await uiAlert('Could not rename story: ' + err.message);
  }
});
loadStorySelect();

// Shown in the header so the mobile app's LAN-sync address field (see
// LanSync.kt there) has somewhere to copy from -- this server already
// listens on every interface, the only missing piece was surfacing which
// LAN IP that actually is.
(async () => {
  try {
    const { address } = await api('/api/lan-address');
    $('#lan-address').textContent = address ? `LAN: ${address}` : '';
  } catch { /* no network interface found -- leave it blank */ }
})();

// ---- Peer sync: any device (PC or mobile) can pull from or push to any
// other, gated on both ends by an explicit accept/reject -- see the
// /api/sync/* routes on this same server, and their exact mirror on the
// Android side (LanSyncServer.kt). Clicking Pull/Push here is this
// device's own consent; the handshake below is what gets the *other*
// device's consent before any bytes move.
function normalizePeerAddress(address) {
  const trimmed = address.trim().replace(/\/+$/, '');
  const withScheme = /^https?:\/\//.test(trimmed) ? trimmed : `http://${trimmed}`;
  return /:\d+$/.test(withScheme) ? withScheme : `${withScheme}:8787`;
}
async function pollSyncStatus(base, requestId, timeoutMs = 90000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const r = await fetch(`${base}/api/sync/status?requestId=${encodeURIComponent(requestId)}`);
    if (r.ok) {
      const { status } = await r.json();
      if (status !== 'pending') return status;
    }
    await new Promise((res) => setTimeout(res, 1000));
  }
  return 'expired';
}
async function requestPeerAccept(base, direction) {
  const label = ($('#lan-address').textContent || 'PC editor').replace(/^LAN:\s*/, '') || 'PC editor';
  const r = await fetch(`${base}/api/sync/request`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ direction, fromLabel: `PC (${label})` }),
  });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `${r.status}`);
  const { requestId } = await r.json();
  $('#peer-sync-status').textContent = 'Waiting for the other device to accept…';
  const status = await pollSyncStatus(base, requestId);
  if (status === 'rejected') throw new Error('The other device declined.');
  if (status !== 'accepted') throw new Error('Timed out waiting for a response.');
  return requestId;
}
$('#btn-peer-pull').addEventListener('click', async () => {
  const address = $('#peer-address').value;
  if (!address) return;
  if (!(await uiConfirm(`Pull the story from ${address}? This REPLACES your active story with theirs.`))) return;
  const status = $('#peer-sync-status');
  try {
    const base = normalizePeerAddress(address);
    const requestId = await requestPeerAccept(base, 'pull');
    status.textContent = 'Downloading…';
    const r = await fetch(`${base}/api/export/zip?requestId=${encodeURIComponent(requestId)}`);
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `${r.status}`);
    const bytes = await r.arrayBuffer();
    const localResult = await api('/api/import/zip', { method: 'POST', body: bytes });
    status.textContent = `Pulled ${localResult.fileCount} files. Reloading…`;
    setTimeout(() => location.reload(), 800);
  } catch (err) {
    status.textContent = '';
    await uiAlert('Pull failed: ' + err.message);
  }
});
$('#btn-peer-push').addEventListener('click', async () => {
  const address = $('#peer-address').value;
  if (!address) return;
  if (!(await uiConfirm(`Push this story to ${address}? This REPLACES their active story with yours.`))) return;
  const status = $('#peer-sync-status');
  try {
    const base = normalizePeerAddress(address);
    const requestId = await requestPeerAccept(base, 'push');
    status.textContent = 'Uploading…';
    const zipResp = await fetch('/api/export/zip');
    if (!zipResp.ok) throw new Error('Could not export local story.');
    const bytes = await zipResp.arrayBuffer();
    const pushResp = await fetch(`${base}/api/import/zip?requestId=${encodeURIComponent(requestId)}`, { method: 'POST', body: bytes });
    if (!pushResp.ok) throw new Error((await pushResp.json().catch(() => ({}))).error || `${pushResp.status}`);
    status.textContent = 'Pushed successfully.';
  } catch (err) {
    status.textContent = '';
    await uiAlert('Push failed: ' + err.message);
    return;
  }
  setTimeout(() => { status.textContent = ''; }, 4000);
});

// Someone else asking THIS device to accept a pull/push -- surfaced as the
// same modal confirm as everything else, not a silent auto-accept.
let handlingIncomingSync = false;
async function pollIncomingSyncRequests() {
  try {
    if (!handlingIncomingSync) {
      const pending = await api('/api/sync/pending');
      if (pending.length) {
        handlingIncomingSync = true;
        for (const req of pending) {
          const verb = req.direction === 'push' ? 'send you their story (replacing yours)' : 'pull your story (yours is untouched)';
          const accept = await uiConfirm(`${req.fromLabel} wants to ${verb}. Allow?`);
          await api('/api/sync/respond', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestId: req.requestId, accept }) });
          if (accept && req.direction === 'push') {
            $('#peer-sync-status').textContent = 'Incoming push accepted — reloading once it lands…';
            setTimeout(() => location.reload(), 3000);
          }
        }
        handlingIncomingSync = false;
      }
    }
  } catch { /* transient network hiccup -- just try again next tick */ }
  setTimeout(pollIncomingSyncRequests, 2000);
}
pollIncomingSyncRequests();

$('#btn-rescan').addEventListener('click', async () => {
  const btn = $('#btn-rescan');
  btn.disabled = true;
  const original = btn.textContent;
  btn.textContent = '⟳ Scanning…';
  try {
    await api('/api/rescan', { method: 'POST' });
    state.chaptersList = null;
    await switchTab(state.tab);
  } catch (e) {
    await uiAlert('Rescan failed: ' + e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = original;
  }
});

$('#btn-edit').addEventListener('click', () => {
  if (!state.currentPath) return;
  state.editing = true;
  $('#editor').value = state.currentBody;
  renderFmPanel();
  setEditingUI(true);
  $('#editor').focus();
});
$('#btn-cancel-edit').addEventListener('click', () => {
  state.editing = false;
  state.fm = parseFrontmatter(state.currentText); // discard any unsaved field edits
  renderFmPanel();
  setEditingUI(false);
});
// <textarea>.value normalizes all line breaks to bare \n regardless of what
// was set into it — so state.currentText (read from disk, this corpus is
// CRLF throughout) and the live editor buffer are on different line-ending
// conventions the instant editing starts, even with no real edits made.
// Un-normalize before writing back, or every Save would silently convert
// that file from CRLF to LF, turning every future git diff on it into a
// whole-file rewrite.
function restoreLineEnding(text, sample) {
  const usesCRLF = /\r\n/.test(sample);
  const lf = text.replace(/\r\n/g, '\n');
  return usesCRLF ? lf.replace(/\n/g, '\r\n') : lf;
}

async function doSave(force) {
  const text = restoreLineEnding(currentFullText(), state.currentText);
  const r = await fetch('/api/save', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: state.currentPath, text, force }),
  });
  const body = await r.json();
  if (r.status === 409 && body.forceable) {
    // body.violations: [{group, title, raw, mitigation}] -- one entry per
    // rule that actually failed, not a single blended verdict, so the
    // user can see exactly which rule(s) and what to do about each.
    const detail = (body.violations || []).map((v) =>
      `• ${v.title || v.group}\n  ${v.raw}${v.mitigation ? `\n  Fix: ${v.mitigation}` : ''}`
    ).join('\n\n');
    const proceed = await uiConfirm(
      `rules-gatekeeper flagged ${body.violations?.length ?? ''} rule(s) (checked as: ${body.target}):\n\n${detail}\n\nSave anyway?`
    );
    if (proceed) return doSave(true);
    return false;
  }
  if (!r.ok) throw new Error(body.error || `/api/save: ${r.status}`);
  return true;
}

$('#btn-save').addEventListener('click', async () => {
  if (!state.currentPath) return;
  try {
    const saved = await doSave(false);
    if (!saved) return;
    state.editing = false;
    // reload from disk so viewer/context/highlights reflect the correction
    await loadCard(state.currentPath, { asArc: state.currentIsArc });
    const status = $('#save-status');
    status.textContent = 'saved'; status.style.display = '';
    setTimeout(() => { status.style.display = 'none'; }, 2500);
  } catch (e) {
    await uiAlert('Save failed: ' + e.message);
  }
});

// ---- Draft <-> chapters/ publish toggle ----
// Only applies to files directly under chapters/drafts/ or chapters/ itself
// (not chapters/mistral/ or any other subdirectory, which are their own
// separate pipelines) -- moves the file to its counterpart location and lets
// /api/fs/rename handle rewriting every link corpus-wide, the same
// mechanism the rename (✎) row-action already uses.
function publishTargetPath(path) {
  if (path.startsWith('chapters/drafts/')) return 'chapters/' + path.slice('chapters/drafts/'.length);
  if (path.startsWith('chapters/') && !path.slice('chapters/'.length).includes('/')) {
    return 'chapters/drafts/' + path.slice('chapters/'.length);
  }
  return null;
}
function refreshPublishToggle(path, text) {
  const btn = $('#btn-publish-toggle');
  const target = publishTargetPath(path);
  if (!target) { btn.style.display = 'none'; return; }
  const toDraft = path.startsWith('chapters/') && !path.startsWith('chapters/drafts/');
  btn.textContent = toDraft ? 'Unpublish (move to drafts/)' : 'Publish (move to chapters/)';
  btn.style.display = '';
  btn.dataset.target = target;
  btn.dataset.hasMarker = /\[\[EXPLICIT SCENE/.test(text) ? '1' : '';
}
$('#btn-publish-toggle').addEventListener('click', async () => {
  const btn = $('#btn-publish-toggle');
  const from = state.currentPath;
  const to = btn.dataset.target;
  if (!from || !to) return;
  const toChapters = to.startsWith('chapters/') && !to.startsWith('chapters/drafts/');
  if (toChapters && btn.dataset.hasMarker) {
    if (!(await uiConfirm('This draft still has an unresolved [[EXPLICIT SCENE — beat: ...]] marker in it. Publish anyway?'))) return;
  }
  if (!(await uiConfirm(`Move ${from} -> ${to}? Every link to it corpus-wide will be rewritten.`))) return;
  try {
    const result = await api('/api/fs/rename', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ from, to }) });
    if (result.relinkErrors && result.relinkErrors.length) {
      await uiAlert(`Moved, but ${result.relinkErrors.length} file(s) couldn't be checked for links: ${result.relinkErrors.map((r) => r.file).join(', ')}`);
    }
    state.chaptersList = null;
    loadCard(to, { asArc: state.currentIsArc });
  } catch (e) { await uiAlert('Move failed: ' + e.message); }
});

// ---- Tab key: indent/outdent instead of moving focus off the textarea ----
$('#editor').addEventListener('keydown', (e) => {
  const ta = e.target;
  if (e.key === 'Tab') {
    e.preventDefault();
    const { selectionStart: s, selectionEnd: en, value } = ta;
    if (s === en && !e.shiftKey) {
      // No selection -- just insert two spaces at the cursor.
      ta.value = value.slice(0, s) + '  ' + value.slice(en);
      ta.selectionStart = ta.selectionEnd = s + 2;
    } else {
      // Selection (or shift+tab on a single line) -- indent/outdent every
      // touched line, same as a real code editor.
      const lineStart = value.lastIndexOf('\n', s - 1) + 1;
      const lineEndSearch = value.indexOf('\n', en);
      const lineEnd = lineEndSearch === -1 ? value.length : lineEndSearch;
      const block = value.slice(lineStart, lineEnd);
      const lines = block.split('\n');
      let delta0 = 0;
      const newLines = lines.map((line, i) => {
        if (e.shiftKey) {
          const stripped = line.replace(/^ {1,2}/, '');
          if (i === 0) delta0 = stripped.length - line.length;
          return stripped;
        }
        if (i === 0) delta0 = 2;
        return '  ' + line;
      });
      const newBlock = newLines.join('\n');
      ta.value = value.slice(0, lineStart) + newBlock + value.slice(lineEnd);
      ta.selectionStart = Math.max(lineStart, s + delta0);
      ta.selectionEnd = en + (newBlock.length - block.length);
    }
    ta.dispatchEvent(new Event('input'));
  }
});

// ---- Toolbar: wrap/prefix the current selection with markdown syntax ----
const MD_WRAPPERS = {
  bold: { before: '**', after: '**', placeholder: 'bold text' },
  italic: { before: '*', after: '*', placeholder: 'italic text' },
  code: { before: '`', after: '`', placeholder: 'code' },
  link: { before: '[', after: '](url)', placeholder: 'link text' },
};
const MD_LINE_PREFIX = { h1: '# ', h2: '## ', ul: '- ', ol: '1. ', quote: '> ' };

function applyMarkdownAction(action) {
  const ta = $('#editor');
  const { selectionStart: s, selectionEnd: en, value } = ta;
  const selected = value.slice(s, en);

  if (MD_WRAPPERS[action]) {
    const { before, after, placeholder } = MD_WRAPPERS[action];
    const text = selected || placeholder;
    ta.value = value.slice(0, s) + before + text + after + value.slice(en);
    ta.selectionStart = s + before.length;
    ta.selectionEnd = s + before.length + text.length;
  } else if (MD_LINE_PREFIX[action]) {
    const prefix = MD_LINE_PREFIX[action];
    const lineStart = value.lastIndexOf('\n', s - 1) + 1;
    ta.value = value.slice(0, lineStart) + prefix + value.slice(lineStart);
    ta.selectionStart = s + prefix.length;
    ta.selectionEnd = en + prefix.length;
  }
  ta.focus();
  ta.dispatchEvent(new Event('input'));
}

document.querySelectorAll('#editor-toolbar button[data-md]').forEach((btn) => {
  btn.addEventListener('click', () => applyMarkdownAction(btn.dataset.md));
});

// ---------- uncensor selection (Mistral) ----------
// Splits on blank-line paragraph boundaries and returns up to `n` whole
// paragraphs immediately before/after the [s, en) selection range within
// `value` — a small context window instead of the whole chapter, per the
// same "surrounding paragraphs, not the whole file" scoping as the rest of
// this op. Paragraph boundaries are found by absolute offset so partial
// overlap with the selection's own paragraph is excluded from both sides.
function paragraphWindow(value, s, en, n = 3) {
  const paras = [];
  const re = /[^\n]+(?:\n(?!\n)[^\n]*)*/g; // one paragraph: non-blank lines, blank line(s) as separator
  let m;
  while ((m = re.exec(value))) paras.push({ start: m.index, end: m.index + m[0].length });
  const beforeParas = paras.filter((p) => p.end <= s).slice(-n);
  const afterParas = paras.filter((p) => p.start >= en).slice(0, n);
  const before = beforeParas.map((p) => value.slice(p.start, p.end)).join('\n\n');
  const after = afterParas.map((p) => value.slice(p.start, p.end)).join('\n\n');
  return { before, after };
}

$('#btn-uncensor-selection').addEventListener('click', async () => {
  const ta = $('#editor');
  const { selectionStart: s, selectionEnd: en, value } = ta;
  const selected = value.slice(s, en);
  if (!selected.trim()) { await uiAlert('Select some text in the editor first.'); return; }
  const { before, after } = paragraphWindow(value, s, en, 3);
  const btn = $('#btn-uncensor-selection');
  const label = btn.textContent;
  btn.textContent = 'Uncensoring…';
  btn.disabled = true;
  try {
    const { rewritten } = await api('/api/mistral/uncensor', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: state.currentPath, before, selection: selected, after }),
    });
    if (!rewritten || !rewritten.trim()) throw new Error('Empty response from Mistral.');
    ta.value = value.slice(0, s) + rewritten + value.slice(en);
    ta.selectionStart = s;
    ta.selectionEnd = s + rewritten.length;
    ta.focus();
    ta.dispatchEvent(new Event('input'));
  } catch (e) {
    await uiAlert('Uncensor failed: ' + e.message);
  } finally {
    btn.textContent = label;
    btn.disabled = false;
  }
});

// ---- Link autosuggest: typing inside `](...)` offers matching corpus
// cards, picking one inserts the correct relative path from the current
// file's own directory (computed server-side, same math /api/fs/rename
// and /api/missing-links/apply already use) so nobody hand-writes
// `../../characters/...md` and gets a hop count wrong. ----
const linkSuggest = {
  open: false, items: [], activeIndex: -1, rangeStart: -1, rangeEnd: -1, reqToken: 0,
};
const lsPopup = $('#link-suggest');

function linkTargetRangeAt(value, pos) {
  // Walk back from the cursor for an unclosed `](` with no `)` in between
  // -- that's "currently typing a link target". Bails past a newline (a
  // link target never spans lines) or once a `)` is seen (target's done).
  let i = pos - 1;
  while (i >= 0) {
    const ch = value[i];
    if (ch === '\n') return null;
    if (ch === ')') return null;
    if (ch === '(' && value[i - 1] === ']') return { start: i + 1, end: pos };
    i--;
  }
  return null;
}

function closeLinkSuggest() {
  linkSuggest.open = false;
  linkSuggest.items = [];
  linkSuggest.activeIndex = -1;
  lsPopup.style.display = 'none';
}

// Mirrors the textarea's box/font/wrapping in an off-screen div so a span
// placed at the caret's character offset reports the same pixel position
// the caret actually renders at -- the standard technique for "popup near
// caret" in a plain <textarea>, which has no native API for this.
function caretPixelPosition(ta, index) {
  const mirror = document.createElement('div');
  const style = getComputedStyle(ta);
  const props = ['boxSizing', 'width', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
    'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth', 'fontFamily',
    'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'whiteSpace', 'wordWrap'];
  for (const p of props) mirror.style[p] = style[p];
  mirror.style.position = 'fixed';
  mirror.style.visibility = 'hidden';
  mirror.style.top = '0';
  mirror.style.left = '-9999px';
  mirror.style.height = 'auto';
  mirror.style.overflow = 'visible';
  mirror.style.whiteSpace = 'pre-wrap';
  mirror.style.wordWrap = 'break-word';
  mirror.textContent = ta.value.slice(0, index);
  const marker = document.createElement('span');
  marker.textContent = '​';
  mirror.appendChild(marker);
  document.body.appendChild(mirror);
  const taRect = ta.getBoundingClientRect();
  const markerRect = marker.getBoundingClientRect();
  const mirrorRect = mirror.getBoundingClientRect();
  const x = taRect.left + (markerRect.left - mirrorRect.left) - ta.scrollLeft;
  const y = taRect.top + (markerRect.top - mirrorRect.top) - ta.scrollTop + markerRect.height;
  document.body.removeChild(mirror);
  return { x, y };
}

function renderLinkSuggest() {
  if (!linkSuggest.items.length) {
    lsPopup.innerHTML = '<div class="ls-empty">No matching cards</div>';
  } else {
    lsPopup.innerHTML = linkSuggest.items.map((it, i) => `
      <div class="ls-item${i === linkSuggest.activeIndex ? ' active' : ''}" data-i="${i}">
        <div class="t">${it.title}</div>
        <div class="p">${it.relPath}</div>
      </div>`).join('');
    lsPopup.querySelectorAll('.ls-item').forEach((el) => {
      el.addEventListener('mousedown', (e) => { e.preventDefault(); pickLinkSuggest(Number(el.dataset.i)); });
    });
  }
}

function pickLinkSuggest(i) {
  const item = linkSuggest.items[i];
  if (!item) return closeLinkSuggest();
  const ta = $('#editor');
  const { rangeStart, rangeEnd } = linkSuggest;
  const value = ta.value;
  const closeParen = value[rangeEnd] === ')' ? '' : ')';
  ta.value = value.slice(0, rangeStart) + item.relPath + closeParen + value.slice(rangeEnd);
  const newPos = rangeStart + item.relPath.length + closeParen.length;
  ta.selectionStart = ta.selectionEnd = newPos;
  ta.focus();
  ta.dispatchEvent(new Event('input'));
  closeLinkSuggest();
}

let linkSuggestTimer = null;
async function updateLinkSuggest() {
  const ta = $('#editor');
  if (document.activeElement !== ta || !state.currentPath) return closeLinkSuggest();
  const range = linkTargetRangeAt(ta.value, ta.selectionStart);
  if (!range || ta.selectionStart !== ta.selectionEnd) return closeLinkSuggest();
  linkSuggest.rangeStart = range.start;
  linkSuggest.rangeEnd = range.end;
  const query = ta.value.slice(range.start, range.end);
  const token = ++linkSuggest.reqToken;
  clearTimeout(linkSuggestTimer);
  linkSuggestTimer = setTimeout(async () => {
    try {
      const items = await api(`/api/link-suggest?from=${encodeURIComponent(state.currentPath)}&q=${encodeURIComponent(query)}`);
      if (token !== linkSuggest.reqToken) return; // a newer keystroke superseded this request
      linkSuggest.open = true;
      linkSuggest.items = items;
      linkSuggest.activeIndex = items.length ? 0 : -1;
      renderLinkSuggest();
      const pos = caretPixelPosition(ta, ta.selectionStart);
      lsPopup.style.left = Math.min(pos.x, window.innerWidth - 440) + 'px';
      lsPopup.style.top = Math.min(pos.y, window.innerHeight - 240) + 'px';
      lsPopup.style.display = 'block';
    } catch { closeLinkSuggest(); }
  }, 120);
}

$('#editor').addEventListener('input', updateLinkSuggest);
$('#editor').addEventListener('click', () => closeLinkSuggest());
$('#editor').addEventListener('keydown', (e) => {
  if (!linkSuggest.open) return;
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    linkSuggest.activeIndex = Math.min(linkSuggest.items.length - 1, linkSuggest.activeIndex + 1);
    renderLinkSuggest();
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    linkSuggest.activeIndex = Math.max(0, linkSuggest.activeIndex - 1);
    renderLinkSuggest();
  } else if (e.key === 'Enter') {
    if (linkSuggest.items.length) { e.preventDefault(); pickLinkSuggest(linkSuggest.activeIndex); }
  } else if (e.key === 'Escape') {
    closeLinkSuggest();
  }
});
document.addEventListener('mousedown', (e) => {
  if (e.target !== $('#editor') && !lsPopup.contains(e.target)) closeLinkSuggest();
});
$('#editor').addEventListener('keydown', (e) => {
  if (!(e.ctrlKey || e.metaKey)) return;
  if (e.key === 'b') { e.preventDefault(); applyMarkdownAction('bold'); }
  else if (e.key === 'i') { e.preventDefault(); applyMarkdownAction('italic'); }
});

// ---- Live preview / saved-vs-unsaved diff (the two modes of the split pane) ----
let previewMode = 'off'; // 'off' | 'preview' | 'diff'
function setPreviewMode(mode) {
  previewMode = mode;
  const pane = $('#editor-preview');
  const btn = $('#btn-toggle-preview');
  pane.style.display = mode === 'off' ? 'none' : 'block';
  btn.textContent = mode === 'off' ? 'Preview: off' : mode === 'preview' ? 'Preview: rendered (click for diff)' : 'Preview: diff vs saved (click to close)';
  renderPreviewPane();
}
function renderPreviewPane() {
  if (previewMode === 'off') return;
  const pane = $('#editor-preview');
  const current = $('#editor').value;
  if (previewMode === 'preview') {
    pane.innerHTML = renderMarkdown(current, state.currentPath || '');
  } else if (previewMode === 'diff') {
    pane.innerHTML = renderLineDiff(state.currentBody, current);
  }
}
$('#btn-toggle-preview').addEventListener('click', () => {
  setPreviewMode(previewMode === 'off' ? 'preview' : previewMode === 'preview' ? 'diff' : 'off');
});
$('#editor').addEventListener('input', () => { if (previewMode !== 'off') renderPreviewPane(); });

// Simple LCS-based line diff (saved content vs the current unsaved editor
// buffer) — same rendering convention (add/del spans) as the git diff view
// in the Version Control drawer below, but computed client-side since
// there's no git diff for unsaved changes.
function lcsLineDiff(a, b) {
  const la = a.split('\n'), lb = b.split('\n');
  const n = la.length, m = lb.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = la[i] === lb[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const ops = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (la[i] === lb[j]) { ops.push(['eq', la[i]]); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { ops.push(['del', la[i]]); i++; }
    else { ops.push(['add', lb[j]]); j++; }
  }
  while (i < n) { ops.push(['del', la[i++]]); }
  while (j < m) { ops.push(['add', lb[j++]]); }
  return ops;
}
function renderLineDiff(saved, current) {
  // Normalize both to \n-only before comparing -- `saved` is straight from
  // disk (CRLF, this corpus) while `current` is a textarea buffer (always
  // \n internally per the DOM spec), so without this every line would
  // differ by an invisible trailing \r even with zero real edits.
  const savedLF = saved.replace(/\r\n/g, '\n');
  const currentLF = current.replace(/\r\n/g, '\n');
  if (savedLF === currentLF) return '<span style="color:var(--dim);">No unsaved changes.</span>';
  const ops = lcsLineDiff(savedLF, currentLF);
  return ops.map(([type, line]) => {
    const esc = escapeHtml(line) || '&nbsp;';
    if (type === 'add') return `<div class="add" style="white-space:pre-wrap;">+ ${esc}</div>`;
    if (type === 'del') return `<div class="del" style="white-space:pre-wrap;">- ${esc}</div>`;
    return `<div style="white-space:pre-wrap;color:var(--dim);">&nbsp; ${esc}</div>`;
  }).join('');
}

function renderViewer(data) {
  const viewer = $('#viewer');
  viewer.classList.toggle('preview-mode', state.mode === 'preview');
  const bodyHtml = renderMarkdown(state.currentBody, data.path);
  viewer.innerHTML = `<div class="card-body">${bodyHtml}</div>`;
  markLinkExistence(viewer, data.links);
  viewer.querySelectorAll('a.internal-link').forEach((a) => {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      const t = a.dataset.target;
      const from = a.dataset.from;
      resolveAndOpen(from, t);
    });
  });
  $('#viewer-mode-pill').textContent = state.mode + (state.currentIsArc ? ' · arc' : '');
}

async function resolveAndOpen(fromPath, target) {
  // Ask the server to resolve relative to `from` by refetching the source
  // card's link list (cheap; server already resolves on /api/card).
  const src = await api(`/api/card?path=${encodeURIComponent(fromPath)}`);
  const link = src.links.find((l) => l.target === target);
  if (!link || !link.resolved) return;
  if (!link.exists) { await uiAlert(`Broken link: ${link.resolved}`); return; }
  loadCard(link.resolved, { asArc: link.resolved.startsWith('plot/arcs/') && !link.resolved.includes('/beats/') });
}

// ---------- context panel ----------
async function reloadContext(arcPath) {
  const depth = Number($('#ctx-depth').value || 2);
  const maxWords = Number($('#ctx-maxwords').value || 8000);
  $('#context-header h2').textContent = 'Context — loading…';
  const data = await api(`/api/context?arc=${encodeURIComponent(arcPath)}&depth=${depth}&maxWords=${maxWords}`);
  state.contextNodes = data.included;
  state.contextOmitted = data.omitted;
  state.manualAdds = [];
  renderContextList();
  applyHighlights();
  refreshOpsButtons();
}

function renderContextList() {
  const list = $('#context-list');
  list.innerHTML = '';
  const all = [...state.contextNodes, ...state.manualAdds];
  if (!all.length) { list.innerHTML = '<div class="empty-state">No context loaded.</div>'; }
  $('#context-header h2').textContent = `Context — ${state.contextNodes.length} nodes (${state.manualAdds.length} manual)`;
  for (const node of all) {
    const isRoot = node.role === 'root';
    const row1Children = [
      el('span', { class: `dot role-${node.role}` }),
      el('span', { class: 'title' }, node.title),
    ];
    if (!isRoot) {
      const removeBtn = el('button', { class: 'remove-btn', title: 'Remove from context (won\'t be sent to Draft this chapter)' }, '×');
      removeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        state.contextNodes = state.contextNodes.filter((n) => n.path !== node.path);
        state.manualAdds = state.manualAdds.filter((n) => n.path !== node.path);
        renderContextList();
        applyHighlights();
      });
      row1Children.push(removeBtn);
    }
    const item = el('div', { class: `ctx-node role-${node.role}`, 'data-path': node.path }, [
      el('div', { class: 'row1' }, row1Children),
      el('div', { class: 'meta' }, node.manual
        ? `manual add · ${node.words || '?'} words`
        : `depth ${node.depth} · weight ${node.weight} · ${node.full ? 'full' : 'excerpt'} · ${node.words}w`),
    ]);
    item.addEventListener('click', () => loadCard(node.path, { asArc: false }));
    list.appendChild(item);
  }
  const omittedEl = $('#omitted');
  if (state.contextOmitted.length) {
    omittedEl.innerHTML = `<strong>${state.contextOmitted.length} omitted for word budget:</strong><br>` +
      state.contextOmitted.map((o) => `<a data-path="${o.path}">${o.path}</a> (w=${o.weight})`).join('<br>');
    omittedEl.querySelectorAll('a').forEach((a) => a.addEventListener('click', () => loadCard(a.dataset.path)));
  } else {
    omittedEl.innerHTML = '';
  }
}

// ---------- prose <-> context cross-highlighting ----------
// Off by default — it's a per-request opt-in ("experimental"), since
// always marking up every match can get noisy on a full chapter. Toggling
// it just re-renders the current card without highlights removed by hand.
async function applyHighlights() {
  if (!$('#toggle-highlight').checked) return;
  if (!state.currentText || !state.contextNodes.length) return;
  const nodes = [...state.contextNodes, ...state.manualAdds];
  let hits;
  try {
    hits = await api('/api/highlight', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prose: state.currentText, nodes }),
    });
  } catch { return; }
  const byPath = new Map(hits.map((h) => [h.path, h]));

  // Dim context-panel entries whose names never appear in the loaded prose.
  document.querySelectorAll('.ctx-node').forEach((n) => {
    const h = byPath.get(n.dataset.path);
    n.classList.toggle('unmatched', h ? !h.matched : false);
  });

  // Highlight occurrences of matched names inside the rendered prose.
  const container = $('#viewer .card-body');
  if (!container) return;
  for (const h of hits) {
    if (!h.matched) continue;
    for (const name of h.names) {
      highlightTextNodes(container, name, h.role);
    }
  }
}

function highlightTextNodes(root, name, role) {
  const re = new RegExp(`\\b(${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})\\b`, 'i');
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.parentElement && n.parentElement.tagName === 'MARK') ? NodeFilter.FILTER_REJECT
      : (re.test(n.nodeValue) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
  });
  const targets = [];
  let n;
  while ((n = walker.nextNode())) targets.push(n);
  for (const textNode of targets) {
    const m = re.exec(textNode.nodeValue);
    if (!m) continue;
    const span = document.createElement('span');
    const before = textNode.nodeValue.slice(0, m.index);
    const mark = document.createElement('mark');
    mark.className = `hl-${role}`;
    mark.textContent = m[0];
    const after = textNode.nodeValue.slice(m.index + m[0].length);
    span.appendChild(document.createTextNode(before));
    span.appendChild(mark);
    span.appendChild(document.createTextNode(after));
    textNode.replaceWith(span);
  }
}

// ---------- operations ----------
function refreshOpsButtons() {
  const has = !!state.currentPath;
  $('#op-extract-cards').disabled = !has;
  $('#op-contradictions-context').disabled = !has || !state.contextNodes.length;
  $('#op-contradictions-chapters').disabled = !has;
  $('#op-missing-links').disabled = !has;
  $('#op-reformat').disabled = !has;
  $('#op-intensify').disabled = !has || !state.currentPath.startsWith('chapters/');
}

async function createOp(payload) {
  const job = await api('/api/ops/create', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  });
  state.activeJobId = job.id;
  await renderJobsList();
  startJobPolling();
}

async function renderJobsList() {
  const jobs = await api('/api/ops/list');
  const box = $('#ops-jobs');
  box.innerHTML = '';
  for (const j of jobs.slice(0, 12)) {
    const item = el('div', { class: `job-item status-${j.status}` }, [
      el('span', { class: 'jt' }, `${j.type}: ${j.inputSummary}`),
      el('span', { class: 'js' }, j.status),
    ]);
    item.addEventListener('click', () => showJobResult(j.id));
    box.appendChild(item);
  }
}

function startJobPolling() {
  clearInterval(state.jobPollTimer);
  state.jobPollTimer = setInterval(async () => {
    await renderJobsList();
    if (state.activeJobId) {
      const { result } = await api(`/api/ops/job?id=${state.activeJobId}`);
      if (result) { clearInterval(state.jobPollTimer); showJobResult(state.activeJobId); }
    }
  }, 3000);
}

async function showJobResult(id) {
  const { job, result } = await api(`/api/ops/job?id=${id}`);
  const box = $('#ops-result');
  if (!result) {
    box.innerHTML = `<div class="empty-state">Job queued (${job.type}) — waiting for the assistant to work it. See tools/story_editor/ops/README.md; it's read from tools/story_editor/ops/queue/${id}.json.</div>`;
    return;
  }
  box.innerHTML = `<div style="margin-bottom:8px;color:var(--dim);">${result.summary || ''}</div>`;
  if (job.type === 'reformat' && result.path) {
    const link = el('div', { class: 'proposed-card' }, [
      el('div', {}, [el('strong', {}, result.path), ' — rewritten in place']),
    ]);
    const btn = el('button', {}, 'Reload');
    btn.addEventListener('click', () => {
      if (state.editing) setEditingUI(false);
      loadCard(result.path, { asArc: state.currentPath === result.path ? state.currentIsArc : false });
    });
    link.appendChild(btn);
    box.appendChild(link);
  }
  if (result.draftPath) {
    const link = el('div', { class: 'proposed-card' }, [
      el('div', {}, [el('strong', {}, result.draftPath)]),
      el('div', { class: 'quote' }, `${result.explicitMarkerCount ?? '?'} explicit marker(s)${result.explicitMarkerLocations ? ': ' + result.explicitMarkerLocations.join(', ') : ''}`),
    ]);
    const btn = el('button', {}, 'Open draft');
    btn.addEventListener('click', () => loadCard(result.draftPath, { asArc: false }));
    link.appendChild(btn);
    box.appendChild(link);
  }
  if (result.findings) {
    for (const f of result.findings) {
      box.appendChild(el('div', { class: `finding sev-${f.severity || 'medium'}` }, [
        el('div', {}, f.description),
        el('div', { class: 'quote' }, `"${f.proseQuote || ''}"`),
        el('div', { class: 'quote' }, `vs "${f.contextQuote || f.otherQuote || ''}" (${f.contextSource || f.otherPath || ''})`),
      ]));
    }
    if (!result.findings.length) box.appendChild(el('div', { class: 'empty-state' }, 'No contradictions found.'));
  }
  if (result.proposedCards) {
    for (const c of result.proposedCards) {
      const card = el('div', { class: 'proposed-card' }, [
        el('div', {}, [el('strong', {}, c.title), ` — ${c.suggestedPath}`]),
        el('div', { class: 'quote' }, c.rationale || ''),
        el('pre', {}, c.draftBody),
      ]);
      const btn = el('button', {}, 'Create this card');
      btn.addEventListener('click', async () => {
        try {
          await api('/api/ops/apply-card', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: c.suggestedPath, body: c.draftBody }),
          });
          btn.textContent = 'Created ✓'; btn.disabled = true;
          if (state.tab === 'cards') renderCards();
        } catch (e) { await uiAlert('Failed: ' + e.message); }
      });
      card.appendChild(btn);
      box.appendChild(card);
    }
    if (!result.proposedCards.length) box.appendChild(el('div', { class: 'empty-state' }, 'No new cards proposed.'));
  }
}

$('#op-draft-chapter').addEventListener('click', () => {
  if (!state.currentPath || !state.currentIsArc) return;
  const selectedPaths = [...state.contextNodes, ...state.manualAdds].map((n) => n.path);
  createOp({
    type: 'draft-chapter', path: state.currentPath,
    depth: Number($('#ctx-depth').value || 2), maxWords: Number($('#ctx-maxwords').value || 8000),
    selectedPaths, draftName: $('#draft-name').value,
  });
});
$('#op-extract-cards').addEventListener('click', () => {
  if (!state.currentPath) return;
  createOp({ type: 'extract-cards', path: state.currentPath });
});
$('#op-contradictions-context').addEventListener('click', () => {
  if (!state.currentPath) return;
  createOp({ type: 'contradictions-context', path: state.currentPath });
});
$('#op-contradictions-chapters').addEventListener('click', async () => {
  if (!state.currentPath) return;
  const other = await uiPrompt('Path of the other chapter to compare against (e.g. chapters/02_the_severance.md):');
  if (!other) return;
  createOp({ type: 'contradictions-chapters', pathA: state.currentPath, pathB: other });
});

// Mechanical (regex-based, not an AI job) — cards mentioned by name in the
// loaded text but not linked from it. Runs instantly, no queue involved.
$('#op-missing-links').addEventListener('click', async () => {
  if (!state.currentPath) return;
  const box = $('#ops-result');
  box.innerHTML = '<div class="empty-state">Scanning…</div>';
  let candidates;
  try { candidates = await api(`/api/missing-links?path=${encodeURIComponent(state.currentPath)}`); }
  catch (e) { box.innerHTML = `<div class="empty-state">Failed: ${e.message}</div>`; return; }
  box.innerHTML = '';
  if (!candidates.length) { box.appendChild(el('div', { class: 'empty-state' }, 'No unlinked mentions found.')); return; }
  box.appendChild(el('div', { style: 'margin-bottom:8px;color:var(--dim);' }, `${candidates.length} card(s) mentioned here but not linked:`));
  for (const c of candidates) {
    const row = el('div', { class: 'proposed-card' }, [
      el('div', {}, [el('strong', {}, c.name), ` → ${c.path}`]),
      el('div', { class: 'quote' }, c.title),
    ]);
    const btn = el('button', {}, 'Insert link');
    btn.addEventListener('click', async () => {
      try {
        await api('/api/missing-links/apply', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: state.currentPath, target: c.path, name: c.name }),
        });
        btn.textContent = 'Inserted ✓'; btn.disabled = true;
        loadCard(state.currentPath, { asArc: state.currentIsArc });
      } catch (e) { await uiAlert('Failed: ' + e.message); }
    });
    row.appendChild(btn);
    box.appendChild(row);
  }
});

// Mechanical, corpus-wide (not scoped to the loaded card — reuses the same
// checkLinks() the driver's own `check` command runs). For each broken
// link, the server already tried a basename match; render one-click Apply
// where that succeeded, and a live searchable dropdown for manual picking
// where it didn't (ambiguous or genuinely missing).
$('#op-broken-links').addEventListener('click', async () => {
  const box = $('#ops-result');
  box.innerHTML = '<div class="empty-state">Scanning corpus…</div>';
  let hits;
  try { hits = await api('/api/broken-links'); }
  catch (e) { box.innerHTML = `<div class="empty-state">Failed: ${e.message}</div>`; return; }
  box.innerHTML = '';
  if (!hits.length) { box.appendChild(el('div', { class: 'empty-state' }, 'No broken links found.')); return; }
  const fixable = hits.filter((h) => h.suggestion).length;
  box.appendChild(el('div', { style: 'margin-bottom:8px;color:var(--dim);' },
    `${hits.length} broken link(s) — ${fixable} with a one-click fix, ${hits.length - fixable} need picking.`));
  for (const h of hits) {
    const row = el('div', { class: 'proposed-card' }, [
      el('div', {}, [el('strong', {}, h.from), `:${h.line}`]),
      el('div', { class: 'quote' }, `"${h.text}" → ${h.target}`),
    ]);
    // body is either {newTarget} (server's own suggestion, ready to use)
    // or {resolvedPath} (a corpus path the user picked via search) — the
    // server computes the correct relative link either way, so nothing
    // here needs to duplicate relative-path math in the browser.
    const applyFix = async (body, label) => {
      try {
        await api('/api/broken-links/apply', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ from: h.from, oldTarget: h.target, ...body }),
        });
        row.appendChild(el('div', { style: 'color:var(--ok);margin-top:4px;' }, `Fixed → ${label}`));
        if (state.currentPath === h.from) loadCard(h.from, { asArc: state.currentIsArc });
      } catch (e) { await uiAlert('Failed: ' + e.message); }
    };
    if (h.suggestion) {
      const btn = el('button', {}, `Fix → ${h.suggestion.resolvedPath}`);
      btn.addEventListener('click', () => { btn.disabled = true; applyFix({ newTarget: h.suggestion.newTarget }, h.suggestion.resolvedPath); });
      row.appendChild(btn);
    } else {
      const input = el('input', { class: 'link-fix-search', placeholder: h.matchCount > 1 ? `${h.matchCount} files share that name — search to pick one…` : 'No match found — search for the right target…' });
      const dropdown = el('div', { class: 'link-fix-dropdown' });
      dropdown.style.display = 'none';
      let debounce;
      input.addEventListener('input', () => {
        clearTimeout(debounce);
        const q = input.value.trim();
        if (q.length < 2) { dropdown.style.display = 'none'; dropdown.innerHTML = ''; return; }
        debounce = setTimeout(async () => {
          const results = await api(`/api/search?q=${encodeURIComponent(q)}`);
          dropdown.innerHTML = '';
          dropdown.style.display = results.length ? 'block' : 'none';
          for (const r of results.slice(0, 20)) {
            const item = el('div', { class: 'list-item' }, [
              el('div', { class: 't' }, r.title || r.path),
              el('div', { class: 'p' }, r.path),
            ]);
            item.addEventListener('click', () => {
              applyFix({ resolvedPath: r.path }, r.path);
              dropdown.style.display = 'none';
              input.value = r.path;
            });
            dropdown.appendChild(item);
          }
        }, 200);
      });
      row.appendChild(input);
      row.appendChild(dropdown);
    }
    box.appendChild(row);
  }
});

// AI job — takes whatever's currently on screen (the editor buffer if
// mid-edit, otherwise the loaded/saved text) and rewrites it into the
// house format for its type: chapter placeholder-convention prose, or a
// same-directory sibling's structure for any other card. Content-preserving
// reshape, not a content rewrite -- see ops/README.md.
$('#op-reformat').addEventListener('click', () => {
  if (!state.currentPath) return;
  const currentText = currentFullText();
  createOp({ type: 'reformat', path: state.currentPath, currentText });
});

$('#op-intensify').addEventListener('click', () => {
  if (!state.currentPath || !state.currentPath.startsWith('chapters/')) return;
  const currentText = currentFullText();
  createOp({ type: 'intensify-chapter', path: state.currentPath, currentText });
});

// ---------- version control ----------
function escapeHtml(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

// Paired-line-number diff -- same LCS backbone as lcsLineDiff (used for the
// unsaved-vs-saved preview above) but restructured into rows carrying both
// sides' line numbers, matching the Android app's CorpusGit.DiffRow shape
// closely enough to share the same collapsing-context render logic as its
// SideBySideDiffViewer.
function computeGitDiffRows(oldText, newText) {
  const oldLF = oldText.replace(/\r\n/g, '\n');
  const newLF = newText.replace(/\r\n/g, '\n');
  const ops = lcsLineDiff(oldLF, newLF);
  const rows = [];
  let oldNum = 0, newNum = 0;
  for (const [type, line] of ops) {
    if (type === 'eq') {
      oldNum++; newNum++;
      rows.push({ oldLineNum: oldNum, oldLineText: line, newLineNum: newNum, newLineText: line, type: 'UNCHANGED' });
    } else if (type === 'del') {
      oldNum++;
      rows.push({ oldLineNum: oldNum, oldLineText: line, newLineNum: null, newLineText: null, type: 'DELETE' });
    } else {
      newNum++;
      rows.push({ oldLineNum: null, oldLineText: null, newLineNum: newNum, newLineText: line, type: 'INSERT' });
    }
  }
  return rows;
}

// state.vcDiffRows/vcExpandedRanges hold what's currently on screen so the
// click-delegated "expand" handler (attached once, below) can re-render
// without needing to recompute the diff or re-fetch anything.
function renderGitDiffRows(rows, expandedRanges) {
  if (!rows.length) return '<div class="empty-state">No changes.</div>';
  const keep = new Array(rows.length).fill(false);
  rows.forEach((r, i) => {
    if (r.type !== 'UNCHANGED') {
      for (let j = Math.max(0, i - 3); j <= Math.min(rows.length - 1, i + 3); j++) keep[j] = true;
    }
  });
  for (const [s, e] of expandedRanges) for (let j = Math.max(0, s); j <= Math.min(keep.length - 1, e); j++) keep[j] = true;

  let html = '';
  let i = 0;
  while (i < rows.length) {
    if (!keep[i]) {
      const start = i;
      while (i < rows.length && !keep[i]) i++;
      const end = i - 1;
      const count = end - start + 1;
      html += `<div class="diff-expand" data-start="${start}" data-end="${end}">▸ Expand ${count} unchanged line${count === 1 ? '' : 's'}</div>`;
      continue;
    }
    const r = rows[i];
    const cls = r.type === 'INSERT' ? 'add' : r.type === 'DELETE' ? 'del' : '';
    const prefix = r.type === 'INSERT' ? '+' : r.type === 'DELETE' ? '-' : ' ';
    const text = r.type === 'DELETE' ? r.oldLineText : r.newLineText;
    html += `<div class="diff-row ${cls}"><span class="diff-ln">${r.oldLineNum ?? ''}</span><span class="diff-ln">${r.newLineNum ?? ''}</span><span class="diff-prefix">${prefix}</span><span class="diff-text">${escapeHtml(text ?? '') || '&nbsp;'}</span></div>`;
    i++;
  }
  return html;
}
$('#vc-diff').addEventListener('click', (e) => {
  const el = e.target.closest('.diff-expand');
  if (!el) return;
  state.vcExpandedRanges.push([Number(el.dataset.start), Number(el.dataset.end)]);
  $('#vc-diff').innerHTML = renderGitDiffRows(state.vcDiffRows, state.vcExpandedRanges);
});
function showGitDiff(oldContent, newContent) {
  state.vcDiffRows = computeGitDiffRows(oldContent, newContent);
  state.vcExpandedRanges = [];
  $('#vc-diff').innerHTML = renderGitDiffRows(state.vcDiffRows, state.vcExpandedRanges);
}

async function refreshVersionControl(path) {
  if (!path) return;
  $('#vc-status').textContent = path;
  const [log, diff] = await Promise.all([
    api(`/api/git/log?path=${encodeURIComponent(path)}&limit=15`),
    api(`/api/git/diff?path=${encodeURIComponent(path)}`),
  ]);
  const workingTreeRow = `<div class="log-entry active" data-commit="">Working tree (uncommitted)</div>`;
  $('#vc-log').innerHTML = workingTreeRow + (log.length
    ? log.map((l) => `<div class="log-entry" data-commit="${l.hash}"><span class="hash">${l.hash}</span> ${l.date} — ${escapeHtml(l.message)}</div>`).join('')
    : '<div class="empty-state">No commit history for this file yet.</div>');
  showGitDiff(diff.oldContent, diff.newContent);
}
$('#vc-log').addEventListener('click', async (e) => {
  const el = e.target.closest('.log-entry');
  if (!el || !state.currentPath) return;
  $('#vc-log').querySelectorAll('.log-entry').forEach((n) => n.classList.remove('active'));
  el.classList.add('active');
  const commit = el.dataset.commit;
  const diff = commit
    ? await api(`/api/git/show?path=${encodeURIComponent(state.currentPath)}&commit=${encodeURIComponent(commit)}`)
    : await api(`/api/git/diff?path=${encodeURIComponent(state.currentPath)}`);
  showGitDiff(diff.oldContent, diff.newContent);
});

$('#vc-header').addEventListener('click', () => {
  $('#vc-body').classList.toggle('open');
});
$('#ops-header').addEventListener('click', () => {
  const open = $('#ops-body').classList.toggle('open');
  $('#ops-toggle-icon').textContent = open ? '▾' : '▸';
});
$('#vc-stage').addEventListener('click', async () => {
  if (!state.currentPath) return;
  await api('/api/git/stage', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ paths: [state.currentPath] }) });
  refreshVersionControl(state.currentPath);
});
$('#vc-commit').addEventListener('click', async () => {
  if (!state.currentPath) return;
  const message = $('#vc-message').value.trim();
  if (!message) { await uiAlert('Commit message required.'); return; }
  if (!(await uiConfirm(`Commit ${state.currentPath} with message:\n\n"${message}"?`))) return;
  await api('/api/git/commit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ paths: [state.currentPath], message }) });
  $('#vc-message').value = '';
  refreshVersionControl(state.currentPath);
});

// ---------- shared: hide/show + rename row actions, add-new rows ----------
let hiddenPaths = new Set();
async function refreshHiddenSet() {
  try { hiddenPaths = new Set(await api('/api/hidden')); } catch { hiddenPaths = new Set(); }
}

// Appends a hover-revealed 👁/rename action pair to a list-item row. Hiding
// excludes the path from browse listings AND from context-building on the
// server (see server.mjs's hiddenSet wiring into contextData) — it's not a
// display-only filter, it's genuinely subtracted from the link graph.
function attachRowActions(item, path, onChange) {
  item.classList.toggle('is-hidden', hiddenPaths.has(path));
  const hideBtn = el('button', { title: hiddenPaths.has(path) ? 'Show (currently hidden from browsing and context)' : 'Hide from browsing and context' },
    hiddenPaths.has(path) ? '🚫' : '👁');
  hideBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    const { hidden } = await api('/api/hidden/toggle', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path }) });
    if (hidden) hiddenPaths.add(path); else hiddenPaths.delete(path);
    onChange();
  });
  const renameBtn = el('button', { title: 'Rename (rewrites every link to this file corpus-wide)' }, '✎');
  renameBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    const to = await uiPrompt(`Rename ${path} to (full path):`, path);
    if (!to || to === path) return;
    try {
      const result = await api('/api/fs/rename', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ from: path, to }) });
      if (result.relinkErrors && result.relinkErrors.length) {
        await uiAlert(`Renamed, but ${result.relinkErrors.length} file(s) couldn't be checked for links: ${result.relinkErrors.map((r) => r.file).join(', ')}`);
      }
      state.chaptersList = null; // in case a chapter got renamed from a tab other than Chapters
      if (state.currentPath === path) loadCard(to, { asArc: state.currentIsArc });
      onChange();
    } catch (e2) { await uiAlert('Rename failed: ' + e2.message); }
  });
  item.appendChild(el('span', { class: 'row-actions' }, [hideBtn, renameBtn]));
}

// A clickable "+ New ..." row that prompts for a path and creates it via
// /api/save (which already supports create-on-nonexistent-path) with a
// starter template.
function addNewRow(list, label, promptText, defaultPathHint, template) {
  const row = el('div', { class: 'add-new-row' }, `+ ${label}`);
  row.addEventListener('click', async () => {
    const path = await uiPrompt(promptText, defaultPathHint);
    if (!path) return;
    if (!path.endsWith('.md')) { await uiAlert('Path must end in .md'); return; }
    try {
      await api('/api/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path, text: template(path) }) });
      state.chaptersList = null; // invalidate in case the new item is a chapter
      loadCard(path, { asArc: false });
      switchTab(state.tab);
    } catch (e) { await uiAlert('Create failed: ' + e.message); }
  });
  list.appendChild(row);
}

// ---------- sidebar tabs ----------
async function renderStoryboard() {
  await refreshHiddenSet();
  const [arcs, stats] = await Promise.all([api('/api/arcs'), api('/api/stats')]);
  $('#global-stats').textContent = `${stats.files} files · ${stats.words.toLocaleString()} words · ${stats.orphanCount} orphans`;
  const list = $('#sidebar-list');
  list.innerHTML = '';
  const essentials = el('div', { class: 'list-item', style: 'background:var(--panel2);' }, [
    el('div', { class: 't' }, 'Plot Essentials'),
    el('div', { class: 'p' }, `${arcs.length} arcs, ordered`),
  ]);
  list.appendChild(essentials);
  addNewRow(list, 'New arc', 'Path for the new arc (plot/arcs/<NN>_arc_<slug>.md — leading number controls reading order):', 'plot/arcs/99_arc_untitled.md',
    (path) => `# Arc: ${path.split('/').pop().replace(/\.md$/, '').replace(/^\d+(\.\d+)?_arc_/, '').replace(/_/g, ' ')}\n\n## Attributes\n* **Type:** Arc\n\n## Premise\n\n\n## Beats\n1. \n\n## Relations\n`);
  for (const a of arcs) {
    const item = el('div', { class: 'list-item' }, [
      el('div', { class: 't' }, [a.order === Infinity ? '' : `${a.order} `, a.title,
        el('span', { class: `badge status-${a.status || 'outline'}` }, a.status || '?')]),
      el('div', { class: 'p' }, a.path),
      el('div', { class: 'snippet' }, a.premise),
    ]);
    item.addEventListener('click', () => loadCard(a.path, { asArc: true }));
    attachRowActions(item, a.path, renderStoryboard);
    list.appendChild(item);
  }
}

// Nested {dirs: Map<name, node>, files: [{path,title}]} tree from a flat
// list of {path, title}, split on '/'.
function buildTree(items) {
  const root = { name: '', path: '', dirs: new Map(), files: [] };
  for (const it of items) {
    const parts = it.path.split('/');
    let node = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const seg = parts[i];
      if (!node.dirs.has(seg)) {
        node.dirs.set(seg, { name: seg, path: node.path ? `${node.path}/${seg}` : seg, dirs: new Map(), files: [] });
      }
      node = node.dirs.get(seg);
    }
    node.files.push(it);
  }
  return root;
}

function countAll(node) {
  let n = node.files.length;
  for (const d of node.dirs.values()) n += countAll(d);
  return n;
}

function renderTreeNode(node, depth, container) {
  const indent = 10 + depth * 14;
  const dirNames = [...node.dirs.keys()].sort();
  for (const name of dirNames) {
    const dir = node.dirs.get(name);
    const expanded = state.cardsExpanded.has(dir.path);
    const row = el('div', { class: 'tree-folder', style: `padding-left:${indent}px;` }, [
      el('span', { class: 'toggle' }, expanded ? '▾' : '▸'),
      el('span', { class: 'name' }, name + '/'),
      el('span', { class: 'count' }, String(countAll(dir))),
    ]);
    row.addEventListener('click', () => {
      if (expanded) state.cardsExpanded.delete(dir.path); else state.cardsExpanded.add(dir.path);
      renderCards();
    });
    container.appendChild(row);
    if (expanded) renderTreeNode(dir, depth + 1, container);
  }
  const files = [...node.files].sort((a, b) => a.title.localeCompare(b.title));
  for (const it of files) {
    const item = el('div', { class: 'list-item tree-file', style: `padding-left:${indent + 12}px;` }, [
      el('div', { class: 't' }, it.title),
      el('div', { class: 'p' }, it.path),
    ]);
    item.addEventListener('click', () => loadCard(it.path, { asArc: it.path.startsWith('plot/arcs/') && !it.path.includes('/beats/') }));
    attachRowActions(item, it.path, renderCards);
    container.appendChild(item);
  }
}

async function renderCards() {
  await refreshHiddenSet();
  const dirs = ['characters', 'lore', 'setting', 'plot/arcs', 'chapters', 'chapters/drafts'];
  const list = $('#sidebar-list');
  list.innerHTML = '';
  addNewRow(list, 'New card', 'Path for the new card (under characters/, lore/, setting/, or plot/arcs/):', 'characters/stock/new_character.md',
    (path) => `# ${path.split('/').pop().replace(/\.md$/, '').replace(/_/g, ' ')}\n\n## Attributes\n* **Type:** Character\n\n## Lore\n* \n`);
  if (hiddenPaths.size) {
    list.appendChild(el('div', { class: 'list-item', style: 'background:var(--panel2);font-weight:600;' }, `Hidden (${hiddenPaths.size})`));
    for (const path of [...hiddenPaths].sort()) {
      const item = el('div', { class: 'list-item is-hidden' }, [el('div', { class: 't' }, path)]);
      item.addEventListener('click', () => loadCard(path, { asArc: path.startsWith('plot/arcs/') && !path.includes('/beats/') }));
      attachRowActions(item, path, renderCards);
      list.appendChild(item);
    }
  }
  for (const dir of dirs) {
    let items;
    try { items = await api(`/api/tree?sub=${encodeURIComponent(dir)}`); } catch { continue; }
    if (!items.length) continue;
    const expanded = state.cardsExpanded.has(dir);
    const header = el('div', { class: 'tree-folder', style: 'padding-left:10px;' }, [
      el('span', { class: 'toggle' }, expanded ? '▾' : '▸'),
      el('span', { class: 'name' }, dir + '/'),
      el('span', { class: 'count' }, String(items.length)),
    ]);
    header.addEventListener('click', () => {
      if (expanded) state.cardsExpanded.delete(dir); else state.cardsExpanded.add(dir);
      renderCards();
    });
    list.appendChild(header);
    if (expanded) {
      // Descend the full tree to the node for `dir` itself, so its own
      // name doesn't get rendered a second time as a redundant nested
      // folder under the header row just added above.
      let node = buildTree(items);
      for (const seg of dir.split('/')) node = node.dirs.get(seg);
      renderTreeNode(node, 1, list);
    }
  }
}

function renderSearchResults(hits) {
  const list = $('#sidebar-list');
  list.innerHTML = '';
  if (!hits.length) { list.innerHTML = '<div class="empty-state">No matches.</div>'; return; }
  for (const h of hits) {
    const item = el('div', { class: 'list-item' }, [
      el('div', { class: 't' }, h.title || h.path),
      el('div', { class: 'p' }, h.path + (h.line ? `:${h.line}` : '')),
      h.snippet ? el('div', { class: 'snippet' }, h.snippet) : '',
    ]);
    item.addEventListener('click', () => loadCard(h.path, { asArc: h.path.startsWith('plot/arcs/') && !h.path.includes('/beats/') }));
    list.appendChild(item);
  }
}

function switchTab(tab) {
  state.tab = tab;
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  $('#search-box').style.display = tab === 'search' ? 'block' : 'none';
  if (tab === 'storyboard') renderStoryboard();
  else if (tab === 'chapters') renderChapters();
  else if (tab === 'cards') renderCards();
  else if (tab === 'rules') renderRules();
  else if (tab === 'search') { $('#sidebar-list').innerHTML = '<div class="empty-state">Type to search.</div>'; }
}

// ---------- Rules tab: .agents/rules/ hub files (split _NN_ cards excluded server-side) ----------
async function renderRules() {
  await refreshHiddenSet();
  const rules = await api('/api/rules');
  const list = $('#sidebar-list');
  list.innerHTML = '';
  addNewRow(list, 'New rule', 'Path for the new rule (.agents/rules/<slug>.md):', '.agents/rules/new-rule.md',
    (path) => `---\ntrigger: always_on\nkeywords: \n---\n# ${path.split('/').pop().replace(/\.md$/, '').replace(/-/g, ' ')}\n\n`);
  for (const r of rules) {
    const item = el('div', { class: 'list-item' }, [
      el('div', { class: 't' }, r.title),
      el('div', { class: 'p' }, r.path),
      r.keywords ? el('div', { class: 'snippet' }, r.keywords) : '',
    ]);
    item.addEventListener('click', () => loadCard(r.path, { asArc: false }));
    attachRowActions(item, r.path, renderRules);
    list.appendChild(item);
  }
}

// ---------- Chapters tab: true reading order, grouped like the reader's TOC ----------
async function getChaptersList() {
  if (!state.chaptersList) state.chaptersList = await api('/api/chapters');
  return state.chaptersList;
}

async function renderChapters() {
  await refreshHiddenSet();
  const chapters = await getChaptersList();
  // First time the app opens on this tab, land straight in a writing
  // canvas instead of the "pick something" empty state — jump to whatever
  // chapter is still an outline (i.e. mid-draft) or, failing that, the
  // first chapter in reading order, and open it already in edit mode.
  if (!state.bootedChapter) {
    state.bootedChapter = true;
    const target = chapters.find((c) => c.status === 'outline') || chapters[0];
    if (target) {
      await loadCard(target.path, { asArc: false });
      state.editing = true;
      $('#editor').value = state.currentBody;
      renderFmPanel();
      setEditingUI(true);
    }
  }
  const list = $('#sidebar-list');
  list.innerHTML = '';
  addNewRow(list, 'New chapter draft', 'Path for the new chapter (chapters/drafts/<slug>.md):', 'chapters/drafts/untitled.md',
    (path) => `---\norder: \narc: \nstatus: outline\nblurb: ""\n---\n# ${path.split('/').pop().replace(/\.md$/, '').replace(/_/g, ' ')}\n\n`);
  const grouped = new Map();
  for (const ch of chapters) {
    const key = ch.arc || '(ungrouped)';
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(ch);
  }
  for (const [arc, chs] of grouped) {
    list.appendChild(el('div', { class: 'list-item', style: 'background:var(--panel2);font-weight:600;' }, `${arc} (${chs.length})`));
    for (const ch of chs) {
      const item = el('div', { class: 'list-item' }, [
        el('div', { class: 't' }, [
          ch.order !== null ? `${ch.order} ` : '', ch.title,
          el('span', { class: `badge status-${ch.status === 'outline' ? 'outline' : 'written'}` }, ch.status),
        ]),
        el('div', { class: 'p' }, ch.path),
        ch.blurb ? el('div', { class: 'snippet' }, ch.blurb) : '',
      ]);
      item.addEventListener('click', () => loadCard(ch.path, { asArc: false }));
      attachRowActions(item, ch.path, () => { state.chaptersList = null; renderChapters(); });
      list.appendChild(item);
    }
  }
}

// ---------- prev/next chapter jump (reading order) -- works in either
// Raw Card or Preview Reader mode, whichever is currently active ----------
async function refreshChapterNav(path) {
  const chapters = await getChaptersList();
  const idx = chapters.findIndex((c) => c.path === path);
  const nav = $('#chapter-nav');
  if (idx === -1) { nav.style.display = 'none'; return; }
  nav.style.display = 'inline-flex';
  const prevBtn = $('#btn-prev-chapter'), nextBtn = $('#btn-next-chapter');
  prevBtn.disabled = idx <= 0;
  nextBtn.disabled = idx >= chapters.length - 1;
  prevBtn.onclick = () => loadCard(chapters[idx - 1].path, { asArc: false });
  nextBtn.onclick = () => loadCard(chapters[idx + 1].path, { asArc: false });
}

// When viewing an arc: jump straight to whatever chapter dramatizes it, if
// one exists yet (draft-chapter output, or an older chapter that actually
// links back to this arc — see /api/chapter-for-arc).
async function refreshArcChapterLinks(arcPath) {
  const box = $('#arc-chapter-links');
  let matches = [];
  try { matches = await api(`/api/chapter-for-arc?arc=${encodeURIComponent(arcPath)}`); } catch { /* ignore */ }
  box.innerHTML = '';
  box.style.display = matches.length ? 'inline-flex' : 'none';
  for (const m of matches) {
    const btn = el('button', { title: `${m.reason}: ${m.path}` }, `→ ${m.title}`);
    btn.addEventListener('click', () => loadCard(m.path, { asArc: false }));
    box.appendChild(btn);
  }
}

// ---------- lookup (context not loaded) ----------
async function doLookup(q) {
  const box = $('#lookup-results');
  if (q.trim().length < 2) { box.innerHTML = ''; return; }
  const hits = await api(`/api/search?q=${encodeURIComponent(q)}`);
  box.innerHTML = '';
  for (const h of hits.slice(0, 30)) {
    const item = el('div', { class: 'list-item' }, [
      el('div', { class: 't' }, h.title || h.path),
      el('div', { class: 'p' }, h.path),
    ]);
    item.addEventListener('click', async () => {
      const card = await api(`/api/card?path=${encodeURIComponent(h.path)}`);
      state.manualAdds.push({ path: card.path, title: card.title, role: 'peripheral', manual: true, words: card.text.split(/\s+/).length, text: card.text });
      renderContextList();
      applyHighlights();
      box.innerHTML = '';
      $('#lookup-input').value = '';
    });
    box.appendChild(item);
  }
}

// ---------- wire up ----------
document.querySelectorAll('#tabs button').forEach((b) => b.addEventListener('click', () => switchTab(b.dataset.tab)));

let searchTimer;
$('#search-input').addEventListener('input', (e) => {
  clearTimeout(searchTimer);
  const q = e.target.value;
  searchTimer = setTimeout(async () => {
    if (q.trim().length < 2) { $('#sidebar-list').innerHTML = '<div class="empty-state">Type to search.</div>'; return; }
    renderSearchResults(await api(`/api/search?q=${encodeURIComponent(q)}`));
  }, 220);
});

let lookupTimer;
$('#lookup-input').addEventListener('input', (e) => {
  clearTimeout(lookupTimer);
  const q = e.target.value;
  lookupTimer = setTimeout(() => doLookup(q), 220);
});

$('#btn-preview').addEventListener('click', () => { state.mode = 'preview'; if (state.currentPath) loadCard(state.currentPath, { asArc: state.currentIsArc }); });
$('#btn-raw').addEventListener('click', () => { state.mode = 'card'; if (state.currentPath) loadCard(state.currentPath, { asArc: state.currentIsArc }); });
$('#btn-reload-context').addEventListener('click', () => { if (state.currentPath) reloadContext(state.currentIsArc ? state.currentPath : state.currentPath); });
$('#toggle-highlight').addEventListener('change', () => { if (state.currentPath) loadCard(state.currentPath, { asArc: state.currentIsArc }); });

switchTab('chapters');
refreshOpsButtons();
renderJobsList();
setImageBox({ url: null, fallback: true, label: 'Pick an arc or card to see its portrait here.', path: '' });

// ---------- Mistral usage indicator ----------
// Not a true account-level quota (Mistral doesn't expose one via this API) —
// a running total of tokens actually spent by this server process, so the
// number resets when the server restarts. Polled rather than pushed since
// draft-chapter/reformat calls happen server-side inside a single request.
async function refreshMistralUsage() {
  const el2 = $('#mistral-usage');
  if (!el2) return;
  try {
    const u = await api('/api/mistral/usage');
    if (!u.configured) { el2.textContent = 'Mistral: not configured'; return; }
    if (u.calls === 0) { el2.textContent = 'Mistral: ready, 0 calls yet'; return; }
    const k = (n) => n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
    el2.textContent = `Mistral: ${k(u.totalTokens)} tokens · ${u.calls} call${u.calls === 1 ? '' : 's'}` + (u.lastError ? ' · last call failed' : '');
    el2.title = u.lastError
      ? `Last error: ${u.lastError}`
      : `${u.promptTokens.toLocaleString()} prompt + ${u.completionTokens.toLocaleString()} completion tokens, this server session only (not an account quota).`;
  } catch { el2.textContent = ''; }
}
refreshMistralUsage();
setInterval(refreshMistralUsage, 15000);
