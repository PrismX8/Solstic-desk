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
  onLog: (callback) => {
    const handler = (_event, logData) => callback(logData);
    ipcRenderer.on('host:log', handler);
    return () => ipcRenderer.removeListener('host:log', handler);
  },
};

const updateApi = {
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  installUpdate: () => ipcRenderer.invoke('install-update'),
  onUpdateStatus: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('update-status', handler);
    return () => ipcRenderer.removeListener('update-status', handler);
  },
  onUpdateProgress: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('update-progress', handler);
    return () => ipcRenderer.removeListener('update-progress', handler);
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
  updates: updateApi,
});

