// Descarga el modelo de MediaPipe FaceLandmarker UNA sola vez y lo guarda
// localmente en assets/models. Después la app funciona 100% offline.
const fs = require('fs');
const path = require('path');
const https = require('https');

const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
const DEST_DIR = path.join(__dirname, '..', 'assets', 'models');
const DEST = path.join(DEST_DIR, 'face_landmarker.task');

function download(url, dest, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error('Demasiadas redirecciones'));
    const file = fs.createWriteStream(dest);
    https
      .get(url, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          file.close();
          fs.unlinkSync(dest);
          return resolve(download(res.headers.location, dest, redirects + 1));
        }
        if (res.statusCode !== 200) {
          file.close();
          return reject(new Error(`HTTP ${res.statusCode}`));
        }
        res.pipe(file);
        file.on('finish', () => file.close(() => resolve()));
      })
      .on('error', (err) => {
        file.close();
        if (fs.existsSync(dest)) fs.unlinkSync(dest);
        reject(err);
      });
  });
}

(async () => {
  try {
    fs.mkdirSync(DEST_DIR, { recursive: true });
    if (fs.existsSync(DEST) && fs.statSync(DEST).size > 1_000_000) {
      console.log('✓ Modelo ya existe:', DEST);
      return;
    }
    console.log('Descargando modelo FaceLandmarker (una sola vez)...');
    await download(MODEL_URL, DEST);
    console.log('✓ Modelo guardado en:', DEST);
  } catch (err) {
    console.warn('\n⚠ No se pudo descargar el modelo automáticamente:', err.message);
    console.warn('  Descárgalo manualmente desde:\n  ' + MODEL_URL);
    console.warn('  y guárdalo en: ' + DEST + '\n');
    // No rompemos el install: el modelo se puede colocar a mano.
  }
})();
