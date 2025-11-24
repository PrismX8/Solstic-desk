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
  check: () => ipcRenderer.invoke('update:check'),
  install: () => ipcRenderer.invoke('update:install'),
  onDownloading: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('update:downloading', handler);
    return () => ipcRenderer.removeListener('update:downloading', handler);
  },
  onProgress: (callback) => {
    const handler = (_event, progress) => callback(progress);
    ipcRenderer.on('update:progress', handler);
    return () => ipcRenderer.removeListener('update:progress', handler);
  },
  onReady: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('update:ready', handler);
    return () => ipcRenderer.removeListener('update:ready', handler);
  },
  onError: (callback) => {
    const handler = (_event, error) => callback(error);
    ipcRenderer.on('update:error', handler);
    return () => ipcRenderer.removeListener('update:error', handler);
  },
};

contextBridge.exposeInMainWorld('solsticeDesktop', {
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    app: require('./package.json').version,
  },
  host: hostApi,
  update: updateApi,
});

