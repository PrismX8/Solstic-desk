const path = require('node:path');
const {
  app,
  BrowserWindow,
  shell,
  ipcMain,
  session,
  screen,
  desktopCapturer,
} = require('electron');
const { autoUpdater } = require('electron-updater');
const { HostController } = require('./host/controller');
const { startLocalRelay } = require('./relay');

app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');

const isDev = Boolean(process.env.ELECTRON_START_URL);
let mainWindow;
let localRelay;
let selectedCaptureSourceId;
const hostController = new HostController();

const createWindow = () => {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: '#050714',
    title: 'Solstice Desk',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  const startUrl = process.env.ELECTRON_START_URL;
  if (startUrl) {
    mainWindow.loadURL(startUrl);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    const uiPath = path.join(__dirname, 'resources', 'ui', 'index.html');
    mainWindow.loadFile(uiPath);
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Enable DevTools with F12 or Ctrl+Shift+I
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.key === 'F12' || (input.control && input.shift && input.key === 'I')) {
      if (mainWindow.webContents.isDevToolsOpened()) {
        mainWindow.webContents.closeDevTools();
      } else {
        mainWindow.webContents.openDevTools({ mode: 'detach' });
      }
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
};

hostController.on('state', (state) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('host:state', state);
  }
});

hostController.on('log', (logData) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('host:log', logData);
  }
  // Also log to main process console
  console.log(`[host] ${logData.message}`, ...logData.args);
});

ipcMain.handle('host:start', async (_event, options) => {
  await hostController.start(options);
  return hostController.getState();
});

ipcMain.handle('host:stop', async () => {
  await hostController.stop();
  return hostController.getState();
});

ipcMain.handle('host:getState', () => hostController.getState());
ipcMain.handle('host:applyInput', (_event, payload) => hostController.applyInput(payload));
ipcMain.handle('host:listCaptureSources', async () => {
  const sources = await desktopCapturer.getSources({
    types: ['screen', 'window'],
    thumbnailSize: { width: 320, height: 180 },
    fetchWindowIcons: true,
  });
  return sources.map((source) => ({
    id: source.id,
    name: source.name,
    displayId: source.display_id,
    thumbnail: source.thumbnail.toDataURL(),
  }));
});
ipcMain.handle('host:setCaptureSource', (_event, sourceId) => {
  selectedCaptureSourceId = String(sourceId || '');
});

// Configure auto-updater
autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;

// Auto-updater event handlers
autoUpdater.on('checking-for-update', () => {
  console.log('[updater] Checking for updates...');
  if (mainWindow) {
    mainWindow.webContents.send('update-status', { status: 'checking' });
  }
});

autoUpdater.on('update-available', (info) => {
  console.log('[updater] Update available:', info.version);
  if (mainWindow) {
    mainWindow.webContents.send('update-status', { 
      status: 'available', 
      version: info.version 
    });
  }
});

autoUpdater.on('update-not-available', () => {
  console.log('[updater] Update not available');
  if (mainWindow) {
    mainWindow.webContents.send('update-status', { status: 'not-available' });
  }
});

autoUpdater.on('error', (err) => {
  console.error('[updater] Error:', err);
  if (mainWindow) {
    mainWindow.webContents.send('update-status', { 
      status: 'error', 
      error: err.message 
    });
  }
});

autoUpdater.on('download-progress', (progressObj) => {
  if (mainWindow) {
    mainWindow.webContents.send('update-progress', {
      percent: progressObj.percent,
      transferred: progressObj.transferred,
      total: progressObj.total,
    });
  }
});

autoUpdater.on('update-downloaded', (info) => {
  console.log('[updater] Update downloaded:', info.version);
  if (mainWindow) {
    mainWindow.webContents.send('update-status', { 
      status: 'downloaded',
      version: info.version 
    });
  }
  // Auto-install on next app quit, or user can trigger manually
});

// Check for updates on app ready (only in production)
// Note: Auto-updates only work with packaged releases, not in dev mode
if (!isDev) {
  app.whenReady().then(() => {
    // Wait a bit before first check to let app fully initialize
    setTimeout(() => {
      console.log('[updater] Checking for updates (production mode only)...');
      autoUpdater.checkForUpdates();
    }, 3000);
    
    // Check for updates every 4 hours
    setInterval(() => {
      autoUpdater.checkForUpdates();
    }, 4 * 60 * 60 * 1000);
  });
} else {
  console.log('[updater] Auto-updates disabled in development mode');
  console.log('[updater] To test auto-updates, build a release: npm run dist:desktop');
}

// IPC handler to manually check for updates
ipcMain.handle('check-for-updates', () => {
  if (!isDev) {
    return autoUpdater.checkForUpdates();
  }
  return Promise.resolve({ updateInfo: null });
});

// IPC handler to install update
ipcMain.handle('install-update', () => {
  if (!isDev) {
    autoUpdater.quitAndInstall(false, true);
  }
});

app.whenReady().then(() => {
  // Set Content Security Policy to fix security warning
  // Must be done after app is ready
  const csp = isDev
    ? "default-src 'self' 'unsafe-inline' 'unsafe-eval' http://localhost:* ws://localhost:* wss://* https://* data: blob:; script-src 'self' 'unsafe-inline' 'unsafe-eval' http://localhost:* blob:; worker-src 'self' blob:; style-src 'self' 'unsafe-inline' http://localhost:* https://*; style-src-elem 'self' 'unsafe-inline' http://localhost:* https://*;"
    : "default-src 'self' 'unsafe-inline' http://127.0.0.1:* http://localhost:* ws://127.0.0.1:* ws://localhost:* ws://* wss://* https://* data: blob:; script-src 'self' 'unsafe-inline' blob:; worker-src 'self' blob:; style-src 'self' 'unsafe-inline' https://*; style-src-elem 'self' 'unsafe-inline' https://*;";

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [csp],
      },
    });
  });

  session.defaultSession.setDisplayMediaRequestHandler(async (_request, callback) => {
    try {
      const sources = await desktopCapturer.getSources({
        types: ['screen', 'window'],
        thumbnailSize: { width: 0, height: 0 },
      });
      const primaryDisplayId = screen.getPrimaryDisplay().id.toString();
      const source =
        sources.find((candidate) => candidate.id === selectedCaptureSourceId) ??
        sources.find((candidate) => candidate.display_id === primaryDisplayId) ??
        sources[0];
      callback(source ? { video: source } : {});
    } catch (error) {
      console.error('[capture] Could not select desktop source', error);
      callback({});
    }
  });

  localRelay = startLocalRelay({
    log: (message) => console.log(`[relay] ${message}`),
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    hostController.stop();
    localRelay?.close();
    app.quit();
  }
});

