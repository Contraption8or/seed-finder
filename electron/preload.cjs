// Bridge between the sandboxed page and the desktop shell. Only update and
// version information crosses it; the page has no other access to Node/OS.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('seedFinderApp', {
  version: () => ipcRenderer.invoke('sf:version'),
  checkForUpdates: () => ipcRenderer.invoke('sf:check-updates'),
  installUpdate: () => ipcRenderer.invoke('sf:install-update'),
  onUpdate(cb) {
    ipcRenderer.invoke('sf:update-status').then(cb);
    ipcRenderer.on('sf:update', (_e, status) => cb(status));
  },
});
