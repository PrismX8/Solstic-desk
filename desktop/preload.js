const { contextBridge, ipcRenderer } = require('electron');

const hostApi = {
  start: (options) => ipcRenderer.invoke('host:start', options || {}),
  stop: () => ipcRenderer.invoke('host:stop'),
  getState: () => ipcRenderer.invoke('host:getState'),
  onState: (callback) => {
    const handler = (_event, state) => callback(state);
    ipcRenderer.on('host:state', handler);
    return () => ipcRenderer.removeListener('host:state', handler);
  },
};

contextBridge.exposeInMainWorld('solsticeDesktop', {
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  },
  host: hostApi,
});

