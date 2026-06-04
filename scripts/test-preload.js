const { app, BrowserWindow } = require('electron');
const path = require('path');

app.whenReady().then(async () => {
  const preloadPath = path.join(__dirname, '../electron/preload.js');
  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.webContents.on('preload-error', (_e, p, err) => {
    console.error('PRELOAD ERROR:', p, err?.message || err);
  });
  win.webContents.on('console-message', (_e, _level, msg) => {
    console.log('renderer console:', msg);
  });

  await win.loadURL('about:blank');
  await new Promise((r) => setTimeout(r, 500));

  const result = await win.webContents.executeJavaScript(
    JSON.stringify({
      fancheng: 'typeof window.fancheng',
      version: 'window.fancheng?.appVersion',
    }).replace(/"([^"]+)"/g, '$1')
  ).catch(() => null);

  // executeJavaScript needs expression not object - fix:
  const probe = await win.webContents.executeJavaScript(`
    ({ type: typeof window.fancheng, version: window.fancheng?.appVersion })
  `);
  console.log('probe:', probe);
  app.quit();
});
