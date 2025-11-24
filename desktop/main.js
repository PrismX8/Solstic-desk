const path = require('node:path');
const { app, BrowserWindow, shell, ipcMain } = require('electron');
const { HostController } = require('./host/controller');

const isDev = Boolean(process.env.ELECTRON_START_URL);
let mainWindow;
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

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
};

hostController.on('state', (state) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('host:state', state);
  }
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

app.whenReady().then(() => {
  createWindow();

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

