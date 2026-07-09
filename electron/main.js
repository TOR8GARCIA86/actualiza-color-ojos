const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');

let mainWindow;
let serverPort = 0;
const ROOT = path.join(__dirname, '..'); // raíz del proyecto

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.task': 'application/octet-stream',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.map': 'application/json'
};

// Mini servidor estático local (offline). Sirve la carpeta del proyecto en 127.0.0.1.
function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      try {
        const urlPath = decodeURIComponent(req.url.split('?')[0]);
        const filePath = path.normalize(path.join(ROOT, urlPath));
        // Evita salir de la raíz del proyecto.
        if (!filePath.startsWith(ROOT)) {
          res.writeHead(403); return res.end('Forbidden');
        }
        if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
          res.writeHead(404); return res.end('Not found');
        }
        const ext = path.extname(filePath).toLowerCase();
        res.writeHead(200, {
          'Content-Type': MIME[ext] || 'application/octet-stream',
          'Cross-Origin-Opener-Policy': 'same-origin',
          'Cross-Origin-Embedder-Policy': 'require-corp'
        });
        fs.createReadStream(filePath).pipe(res);
      } catch (e) {
        res.writeHead(500); res.end('Error');
      }
    });
    server.listen(0, '127.0.0.1', () => {
      serverPort = server.address().port;
      resolve(serverPort);
    });
  });
}

async function createWindow() {
  await startServer();
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 900,
    minHeight: 640,
    backgroundColor: '#0f1117',
    title: 'AOC — Color de Ojos',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  // Reenvía errores del renderer al terminal.
  mainWindow.webContents.on('console-message', (_e, level, message) => {
    if (level >= 2) console.log(`[renderer] ${message}`);
  });

  mainWindow.loadURL(`http://127.0.0.1:${serverPort}/src/index.html`);
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.focus();
    app.focus({ steal: true });
  });
}

// Permite el acceso a la cámara sin diálogo (app local de confianza).
app.whenReady().then(async () => {
  const { session, systemPreferences } = require('electron');
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => {
    cb(permission === 'media');
  });
  session.defaultSession.setPermissionCheckHandler(() => true);

  // macOS: dispara el diálogo de permiso de cámara a nivel de sistema (TCC).
  if (process.platform === 'darwin') {
    try {
      if (systemPreferences.getMediaAccessStatus('camera') !== 'granted') {
        await systemPreferences.askForMediaAccess('camera');
      }
    } catch (_) { /* en algunas builds no aplica */ }
  }

  await createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// --- Guardar imagen exportada (foto con lentes aplicados) ---
ipcMain.handle('save-image', async (_evt, dataUrl) => {
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title: 'Guardar imagen',
    defaultPath: `AOC-ojos-${Date.now()}.png`,
    filters: [{ name: 'Imagen PNG', extensions: ['png'] }]
  });
  if (canceled || !filePath) return { ok: false };
  const base64 = dataUrl.replace(/^data:image\/png;base64,/, '');
  fs.writeFileSync(filePath, Buffer.from(base64, 'base64'));
  return { ok: true, filePath };
});

// --- Abrir una imagen desde disco (modo foto) ---
ipcMain.handle('open-image', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: 'Abrir foto',
    properties: ['openFile'],
    filters: [{ name: 'Imágenes', extensions: ['png', 'jpg', 'jpeg', 'webp'] }]
  });
  if (canceled || !filePaths[0]) return { ok: false };
  const buf = fs.readFileSync(filePaths[0]);
  const ext = path.extname(filePaths[0]).slice(1).toLowerCase();
  const mime = ext === 'jpg' ? 'jpeg' : ext;
  return { ok: true, dataUrl: `data:image/${mime};base64,${buf.toString('base64')}` };
});
