// Cross-window message bus shared by the editor (index.html/app.js), the
// storyboard (board.html/board.js), and the published reader
// (reader_head.html, injected into tools/twine/reader.html). All three are
// served from the same origin (this dev server) as separate popup windows
// -- see electron/main.js's setWindowOpenHandler -- so BroadcastChannel is
// enough; no window.opener plumbing needed and it survives either window
// being the one that opened the other.
//
// Message shape: { type, ...payload }. Known types:
//   'focus-arc'   { path }   -- ask the storyboard to select/pan to an arc
//   'card-loaded' { path }   -- the editor just loaded a card (lets the
//                               storyboard, if open, highlight the same node)
//   'goto-passage'{ slug }   -- ask the reader to jump to a chapter passage
//   'go-back'     { target } -- ask a specific window ('reader'|'board') to
//                               step back (reader: SugarCube history back;
//                               board: clear its current selection)
//   'close'       { target } -- ask a specific window to close itself
// `target` on 'go-back'/'close' is one of 'reader' | 'board' | 'editor';
// a window ignores the message unless target matches its own WINDOW_KIND
// (set by the page before loading this script) or target is omitted.
const CuntswellBus = (() => {
  const CHANNEL = 'cuntswell-corpus-editor';
  const channel = ('BroadcastChannel' in window) ? new BroadcastChannel(CHANNEL) : null;
  const listeners = new Map(); // type -> Set<fn>

  function on(type, fn) {
    if (!listeners.has(type)) listeners.set(type, new Set());
    listeners.get(type).add(fn);
    return () => listeners.get(type).delete(fn);
  }

  function send(type, payload = {}) {
    const msg = { type, ...payload };
    if (channel) channel.postMessage(msg);
  }

  if (channel) {
    channel.onmessage = (e) => {
      const msg = e.data || {};
      const kind = window.WINDOW_KIND;
      if (msg.target && kind && msg.target !== kind) return;
      const set = listeners.get(msg.type);
      if (set) for (const fn of set) fn(msg);
    };
  }

  return { on, send };
})();
