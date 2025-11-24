const path = require('node:path');
const { app, BrowserWindow, shell, ipcMain, dialog } = require('electron');
const { autoUpdater } = require('electron-updater');
const { HostController } = require('./host/controller');

const isDev = Boolean(process.env.ELECTRON_START_URL);
const UPDATE_SERVER = process.env.UPDATE_SERVER || 'https://railways.up.railway.app';
const APP_VERSION = app.getVersion();

let mainWindow;
let updateWindow = null;
const hostController = new HostController();

// Configure auto-updater
autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = true;

// Set custom update server URL
if (!isDev) {
  const updateServer = process.env.UPDATE_SERVER || 'https://railways.up.railway.app';
  autoUpdater.setFeedURL({
    provider: 'generic',
    url: `${updateServer}/api/updates`,
  });
}

// Check for updates on startup
async function checkForUpdates(forceCheck = false) {
  if (isDev) {
    console.log('[updater] Skipping update check in development');
    return;
  }

  try {
    // First, check minimum required version from server
    const versionCheck = await fetch(`${UPDATE_SERVER}/api/version`).then((r) =>
      r.json().catch(() => ({ minimumVersion: APP_VERSION, currentVersion: APP_VERSION })),
    );

    const minimumVersion = versionCheck.minimumVersion || APP_VERSION;
    const currentVersion = versionCheck.currentVersion || APP_VERSION;

    // Compare versions (simple semver comparison)
    if (compareVersions(APP_VERSION, minimumVersion) < 0) {
      // App is too old - force update
      showUpdateRequiredDialog(minimumVersion, currentVersion);
      return;
    }

    // Check for updates using electron-updater
    if (forceCheck || !updateWindow) {
      const updateInfo = await autoUpdater.checkForUpdates();
      if (updateInfo && updateInfo.updateInfo.version !== APP_VERSION) {
        showUpdateAvailableDialog(updateInfo.updateInfo);
      }
    }
  } catch (error) {
    console.error('[updater] Update check failed:', error);
    // Don't block app if update check fails
  }
}

function compareVersions(v1, v2) {
  const parts1 = v1.split('.').map(Number);
  const parts2 = v2.split('.').map(Number);
  for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
    const part1 = parts1[i] || 0;
    const part2 = parts2[i] || 0;
    if (part1 < part2) return -1;
    if (part1 > part2) return 1;
  }
  return 0;
}

function showUpdateRequiredDialog(minimumVersion, latestVersion) {
  if (updateWindow) return;

  updateWindow = new BrowserWindow({
    width: 500,
    height: 400,
    resizable: false,
    modal: true,
    parent: mainWindow,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  updateWindow.loadURL(
    `data:text/html;charset=utf-8,${encodeURIComponent(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Update Required</title>
          <style>
            body {
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
              padding: 40px;
              text-align: center;
              background: #050714;
              color: white;
            }
            h1 { color: #ff6b6b; margin-bottom: 20px; }
            p { line-height: 1.6; margin: 15px 0; }
            button {
              background: #4CAF50;
              color: white;
              border: none;
              padding: 12px 24px;
              font-size: 16px;
              cursor: pointer;
              border-radius: 6px;
              margin-top: 20px;
            }
            button:hover { background: #45a049; }
          </style>
        </head>
        <body>
          <h1>⚠️ Update Required</h1>
          <p>Your version (${APP_VERSION}) is no longer supported.</p>
          <p>Minimum required version: <strong>${minimumVersion}</strong></p>
          <p>Latest version: <strong>${latestVersion}</strong></p>
          <p>Please update to continue using Solstice Desk.</p>
          <button onclick="window.location.href='${UPDATE_SERVER}/api/updates/Solstice Desk Setup ${latestVersion}.exe'">
            Download Update
          </button>
        </body>
      </html>
    `)}`,
  );

  updateWindow.on('closed', () => {
    updateWindow = null;
    app.quit(); // Force quit if update is required
  });
}

function showUpdateAvailableDialog(updateInfo) {
  if (updateWindow) return;

  const response = dialog.showMessageBoxSync(mainWindow, {
    type: 'info',
    title: 'Update Available',
    message: `A new version (${updateInfo.version}) is available!`,
    detail: `Current version: ${APP_VERSION}\n\nWould you like to download and install it now?`,
    buttons: ['Download Now', 'Later'],
    defaultId: 0,
    cancelId: 1,
  });

  if (response === 0) {
    downloadAndInstallUpdate();
  }
}

async function downloadAndInstallUpdate() {
  try {
    if (mainWindow) {
      mainWindow.webContents.send('update:downloading');
    }
    await autoUpdater.downloadUpdate();
  } catch (error) {
    console.error('[updater] Download failed:', error);
    dialog.showErrorBox('Update Error', 'Failed to download update. Please try again later.');
  }
}

// Auto-updater events
autoUpdater.on('update-downloaded', () => {
  if (mainWindow) {
    mainWindow.webContents.send('update:ready');
  }
  const response = dialog.showMessageBoxSync(mainWindow, {
    type: 'info',
    title: 'Update Ready',
    message: 'Update downloaded successfully!',
    detail: 'The update will be installed when you restart the application.',
    buttons: ['Restart Now', 'Later'],
    defaultId: 0,
  });

  if (response === 0) {
    autoUpdater.quitAndInstall(false, true);
  }
});

autoUpdater.on('download-progress', (progress) => {
  if (mainWindow) {
    mainWindow.webContents.send('update:progress', progress);
  }
});

autoUpdater.on('error', (error) => {
  console.error('[updater] Error:', error);
  if (mainWindow) {
    mainWindow.webContents.send('update:error', error.message);
  }
});

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

ipcMain.handle('update:check', () => checkForUpdates(true));
ipcMain.handle('update:install', () => downloadAndInstallUpdate());

app.whenReady().then(() => {
  createWindow();

  // Check for updates after a short delay
  setTimeout(() => {
    checkForUpdates();
  }, 3000);

  // Check for updates every 6 hours
  setInterval(() => {
    checkForUpdates();
  }, 6 * 60 * 60 * 1000);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    hostController.stop();
    app.quit();
  }
});

