// Exposes just enough of the window chrome the frameless BrowserWindow
// removed (minimize/close/maximize-toggle) to the page, without handing it
// the raw ipcRenderer. window.electronAPI is undefined when index.html is
// opened in a normal browser tab (the same page still works there), so any
// UI wired to it must check for its presence first.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  minimize: () => ipcRenderer.send('window:minimize'),
  close: () => ipcRenderer.send('window:close'),
  toggleMaximize: () => ipcRenderer.send('window:toggleMaximize'),
  isMaximized: () => ipcRenderer.invoke('window:isMaximized'),
});
