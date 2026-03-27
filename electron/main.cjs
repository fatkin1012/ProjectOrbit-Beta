const path = require('node:path');
const fs = require('node:fs/promises');
const { app, BrowserWindow } = require('electron');
const { ipcMain } = require('electron');

const INSTALLED_PLUGINS_FILE = 'installed-plugins.json';

function getInstalledPluginsFilePath() {
  return path.join(app.getPath('userData'), INSTALLED_PLUGINS_FILE);
}

async function readInstalledPluginsFile() {
  const filePath = getInstalledPluginsFilePath();

  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return raw;
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') {
      return null;
    }

    throw error;
  }
}

async function writeInstalledPluginsFile(payload) {
  const filePath = getInstalledPluginsFilePath();
  const dirPath = path.dirname(filePath);

  await fs.mkdir(dirPath, { recursive: true });
  await fs.writeFile(filePath, payload, 'utf8');
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  const devServerUrl = process.argv[2];

  if (devServerUrl && /^https?:\/\//i.test(devServerUrl)) {
    window.loadURL(devServerUrl);
    window.webContents.openDevTools({ mode: 'detach' });
  } else {
    window.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }
}

app.whenReady().then(() => {
  ipcMain.handle('orbit:installedPlugins:get', async () => {
    return await readInstalledPluginsFile();
  });

  ipcMain.handle('orbit:installedPlugins:set', async (_event, payload) => {
    if (typeof payload !== 'string') {
      throw new Error('Installed plugins payload must be a JSON string.');
    }

    await writeInstalledPluginsFile(payload);
    return true;
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
