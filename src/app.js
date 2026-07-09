// app.js — Orquesta cámara/foto, detección de iris y render de lentes.
import { initTracker, setRunningMode, detect } from './eyeTracker.js';
import { getTexture, drawLens } from './lensRenderer.js';

const video = document.getElementById('video');
const canvas = document.getElementById('output');
const ctx = canvas.getContext('2d');
const statusEl = document.getElementById('status');

const state = {
  mode: 'live',            // 'live' | 'photo'
  lens: null,
  opacity: 0.90,
  scale: 1.0,
  blend: 'natural',
  showMesh: false,
  photoImage: null,        // HTMLImageElement en modo foto
  running: false,
  lastVideoTime: -1,
  currentDeviceId: null,
  showLogo: true
};

// Logo ACTUALIZA (overlay sobre el pecho).
const logoImg = new Image();
logoImg.src = '../assets/Actualiza.png';
const LOGO_ASPECT = 3140 / 552;   // relación de la imagen

// Dibuja el logo anclado bajo la barbilla (≈ pecho), o fijo si no hay rostro.
function drawLogo(landmarks) {
  if (!state.showLogo || !logoImg.complete || !logoImg.naturalWidth) return;
  const W = canvas.width, H = canvas.height;
  let cxp, topY, lw;
  if (landmarks) {
    const chin = landmarks[152], L = landmarks[234], Rr = landmarks[454], top = landmarks[10];
    const chinY = chin.y * H;
    const faceW = Math.hypot((Rr.x - L.x) * W, (Rr.y - L.y) * H);
    const faceH = Math.hypot((chin.x - top.x) * W, (chin.y - top.y) * H);
    lw = faceW * 2.5;              // el tamaño sigue la profundidad (cerca/lejos)
    cxp = W / 2;                   // SIEMPRE centrado horizontalmente
    topY = chinY + faceH * 0.5;    // un poco más arriba que antes
  } else {
    lw = W * 0.42; cxp = W / 2; topY = H * 0.78;
  }
  const lh = lw / LOGO_ASPECT;
  ctx.save();
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  ctx.drawImage(logoImg, cxp - lw / 2, topY, lw, lh);
  ctx.restore();
}

// ---------- Catálogo ----------
let catalogData = null;

async function loadCatalog() {
  const res = await fetch('../assets/lenses/catalog.json');
  catalogData = await res.json();
  buildGrid(document.getElementById('lensStrip'));
}

// Miniatura: imagen real del lente si existe; si no, círculo de color.
function lensThumb(lens) {
  if (lens.id === 'none') return '<div class="swatch none-sw"></div>';
  if (lens.texture) return `<div class="swatch"><img src="../assets/${lens.texture}" alt=""></div>`;
  const bg = lens.color ? `style="background:${lens.color}"` : '';
  return `<div class="swatch" ${bg}></div>`;
}

function buildGrid(grid) {
  if (!grid || !catalogData) return;
  grid.innerHTML = '';
  catalogData.lenses.forEach((lens, idx) => {
    const el = document.createElement('div');
    el.className = 'lens' + (idx === 0 ? ' active' : '');
    el.dataset.id = lens.id;
    el.innerHTML = lensThumb(lens) + `<div class="name">${lens.name}</div>`;
    el.onclick = () => selectLens(lens.id);
    grid.appendChild(el);
  });
}

// Selección de lente desde la barra inferior.
function selectLens(id) {
  const lens = catalogData.lenses.find((l) => l.id === id);
  state.lens = (!lens || lens.id === 'none') ? null : lens;
  const items = document.querySelectorAll('.lens-strip .lens');
  items.forEach((n) => n.classList.toggle('active', n.dataset.id === id));
  const active = document.querySelector('.lens-strip .lens.active');
  if (active) active.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  if (state.mode === 'photo') renderPhoto();
}

// Rueda del mouse / trackpad → desplaza la barra en horizontal.
function initStrip() {
  const strip = document.getElementById('lensStrip');
  if (!strip) return;
  strip.addEventListener('wheel', (e) => {
    if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
      strip.scrollLeft += e.deltaY;
      e.preventDefault();
    }
  }, { passive: false });
}

// ---------- Cámara ----------
// getUserMedia con timeout: si un dispositivo (p.ej. cámara virtual) se cuelga,
// no bloqueamos la app; lanzamos error para poder probar otra cámara.
function gumWithTimeout(constraints, ms = 7000) {
  return Promise.race([
    navigator.mediaDevices.getUserMedia(constraints),
    new Promise((_, rej) => setTimeout(() => {
      const e = new Error('timeout'); e.name = 'TimeoutError'; rej(e);
    }, ms))
  ]);
}

async function populateCameras(selectedId) {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const cams = devices.filter((d) => d.kind === 'videoinput');
    const sel = document.getElementById('camera');
    sel.innerHTML = '';
    cams.forEach((c, i) => {
      const opt = document.createElement('option');
      opt.value = c.deviceId;
      opt.textContent = c.label || `Cámara ${i + 1}`;
      sel.appendChild(opt);
    });
    if (selectedId) sel.value = selectedId;
    return cams;
  } catch (e) {
    console.error('enumerateDevices error', e);
    return [];
  }
}

async function startCamera(deviceId) {
  stopCamera();
  const constraints = {
    video: deviceId
      ? { deviceId: { exact: deviceId }, width: { ideal: 1280 }, height: { ideal: 720 } }
      : { width: { ideal: 1280 }, height: { ideal: 720 } },
    audio: false
  };
  try {
    console.log('startCamera: solicitando', deviceId || '(por defecto)');
    const stream = await gumWithTimeout(constraints);
    video.srcObject = stream;
    await video.play();
    const label = stream.getVideoTracks()[0]?.label || '';
    console.log('startCamera: OK', video.videoWidth, 'x', video.videoHeight, label);
    state.currentDeviceId = stream.getVideoTracks()[0]?.getSettings().deviceId || deviceId;
    await populateCameras(state.currentDeviceId);
    return true;
  } catch (err) {
    console.error('startCamera ERROR:', err.name, err.message);
    // Si falló/colgó la cámara por defecto, intentamos con la mejor real disponible.
    if (!deviceId) {
      const cams = await populateCameras();
      const alt =
        cams.find((c) => /logitech|logi|usb/i.test(c.label)) ||     // preferimos Logitech
        cams.find((c) => !/obs|virtual|snap/i.test(c.label)) ||     // cualquier real (no virtual)
        cams[0];
      if (alt && alt.deviceId) {
        console.log('Reintentando con:', alt.label);
        return startCamera(alt.deviceId);
      }
    }
    let msg = err.message;
    if (err.name === 'TimeoutError') msg = 'La cámara no respondió (¿es una cámara virtual?). Elige otra en el selector de arriba.';
    else if (err.name === 'NotAllowedError') msg = 'Permiso denegado. Ajustes del Sistema → Privacidad → Cámara → activa Electron.';
    else if (err.name === 'NotFoundError') msg = 'No se encontró ninguna cámara.';
    else if (err.name === 'NotReadableError') msg = 'La cámara está en uso por otra app.';
    setStatus('⚠ Cámara: ' + msg);
    return false;
  }
}

function stopCamera() {
  const s = video.srcObject;
  if (s) s.getTracks().forEach((t) => t.stop());
  video.srcObject = null;
}

// ---------- Loop de video en vivo ----------
async function liveLoop() {
  if (state.mode !== 'live' || !state.running) return;
  if (video.readyState >= 2 && video.currentTime !== state.lastVideoTime) {
    state.lastVideoTime = video.currentTime;
    const W = video.videoWidth, H = video.videoHeight;
    if (canvas.width !== W) { canvas.width = W; canvas.height = H; }

    ctx.drawImage(video, 0, 0, W, H);
    const { eyes, landmarks } = detect(video, 'VIDEO', performance.now(), W, H);
    paintEyes(smoothEyes(eyes), landmarks);
    if (eyes.length) setStatus('Detectando · ' + (state.lens ? state.lens.name : 'sin lente'));
    else setStatus('Buscando rostro…');
  }
  requestAnimationFrame(liveLoop);
}

// ---------- Modo foto ----------
async function renderPhoto() {
  if (!state.photoImage) return;
  const img = state.photoImage;
  const W = img.naturalWidth, H = img.naturalHeight;
  canvas.width = W; canvas.height = H;
  ctx.drawImage(img, 0, 0, W, H);
  await setRunningMode('IMAGE');
  const { eyes, landmarks } = detect(img, 'IMAGE', 0, W, H);
  paintEyes(eyes, landmarks);
  setStatus(eyes.length ? 'Foto lista · ' + eyes.length + ' ojo(s)' : 'No se detectó rostro en la foto');
}

// ---------- Pintado de lentes ----------
function paintEyes(eyes, landmarks) {
  const tex = getTexture(state.lens);
  const opts = {
    opacity: state.opacity, scale: state.scale, blend: state.blend,
    color: state.lens ? state.lens.color : null
  };
  const source = state.mode === 'live' ? video : state.photoImage;
  // Oculta el lente si el ojo está cerrado (parpadeo) → apertura < umbral.
  if (tex) eyes.forEach((eye) => { if ((eye.open ?? 1) > 0.18) drawLens(ctx, tex, eye, opts, source); });

  drawLogo(landmarks);

  if (state.showMesh) {
    ctx.save();
    ctx.strokeStyle = 'rgba(110,168,254,.9)';
    ctx.fillStyle = 'rgba(155,123,255,.9)';
    eyes.forEach((eye) => {
      ctx.beginPath(); ctx.arc(eye.cx, eye.cy, eye.r, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.arc(eye.cx, eye.cy, 2, 0, Math.PI * 2); ctx.fill();
      if (eye.poly) {
        ctx.beginPath();
        eye.poly.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
        ctx.closePath(); ctx.stroke();
      }
    });
    ctx.restore();
  }
}

// ---------- Cambio de modo ----------
async function setMode(mode) {
  if (state.mode === mode) return;
  state.mode = mode;
  document.querySelectorAll('.mode-btn').forEach((b) =>
    b.classList.toggle('active', b.dataset.mode === mode));
  document.getElementById('snapBtn').style.display = mode === 'live' ? '' : 'none';

  if (mode === 'live') {
    await setRunningMode('VIDEO');
    state.lastVideoTime = -1;
    if (!video.srcObject) await startCamera();
    state.running = true;
    liveLoop();
  } else {
    state.running = false;
    if (state.photoImage) renderPhoto();
    else setStatus('Abre una foto o captura desde la cámara');
  }
}

// ---------- Acciones ----------
function snap() {
  // Captura el frame actual de la cámara como "foto"
  const tmp = document.createElement('canvas');
  tmp.width = video.videoWidth; tmp.height = video.videoHeight;
  tmp.getContext('2d').drawImage(video, 0, 0);
  const img = new Image();
  img.onload = () => { state.photoImage = img; setMode('photo'); };
  img.src = tmp.toDataURL('image/png');
}

async function openPhoto() {
  const res = await window.aoc.openImage();
  if (!res.ok) return;
  const img = new Image();
  img.onload = () => { state.photoImage = img; setMode('photo'); };
  img.src = res.dataUrl;
}

async function save() {
  const dataUrl = canvas.toDataURL('image/png');
  const res = await window.aoc.saveImage(dataUrl);
  if (res.ok) setStatus('✓ Guardado: ' + res.filePath);
}

function setStatus(t) { statusEl.textContent = t; }

// Suavizado temporal (media móvil) del iris y del contorno: elimina el temblor
// del tracking entre fotogramas → el color se mantiene estable y no se desborda.
const _smooth = [null, null];
function smoothEyes(eyes) {
  if (!eyes.length) { _smooth[0] = _smooth[1] = null; return eyes; }
  return eyes.map((e, i) => {
    const p = _smooth[i];
    if (p && p.poly && p.poly.length === e.poly.length) {
      // Adaptativo: casi instantáneo al moverte (no se queda atrás); solo suaviza
      // el micro-temblor cuando estás quieto.
      const dist = Math.hypot(e.cx - p.cx, e.cy - p.cy);
      const a = dist > e.r * 0.10 ? 0.98 : 0.75;
      e.cx = p.cx + (e.cx - p.cx) * a;
      e.cy = p.cy + (e.cy - p.cy) * a;
      e.r = p.r + (e.r - p.r) * a;
      e.poly = e.poly.map((pt, k) => ({
        x: p.poly[k].x + (pt.x - p.poly[k].x) * a,
        y: p.poly[k].y + (pt.y - p.poly[k].y) * a
      }));
    }
    _smooth[i] = { cx: e.cx, cy: e.cy, r: e.r, poly: e.poly.map((pt) => ({ x: pt.x, y: pt.y })) };
    return e;
  });
}

// ---------- Controles UI ----------
function bindControls() {
  document.getElementById('modeSwitch').addEventListener('click', (e) => {
    const btn = e.target.closest('.mode-btn');
    if (btn) setMode(btn.dataset.mode);
  });
  document.getElementById('snapBtn').onclick = snap;
  document.getElementById('openBtn').onclick = openPhoto;
  document.getElementById('saveBtn').onclick = save;
  document.getElementById('camera').onchange = async (e) => {
    setStatus('Cambiando de cámara…');
    if (await startCamera(e.target.value)) {
      state.currentDeviceId = e.target.value;
      if (state.mode === 'live') { state.lastVideoTime = -1; liveLoop(); }
    }
  };

  const op = document.getElementById('opacity');
  op.oninput = () => {
    state.opacity = op.value / 100;
    document.getElementById('opacityVal').textContent = op.value + '%';
    if (state.mode === 'photo') renderPhoto();
  };
  const sc = document.getElementById('scale');
  sc.oninput = () => {
    state.scale = sc.value / 100;
    document.getElementById('scaleVal').textContent = sc.value + '%';
    if (state.mode === 'photo') renderPhoto();
  };
  document.getElementById('blend').onchange = (e) => {
    state.blend = e.target.value;
    if (state.mode === 'photo') renderPhoto();
  };
  document.getElementById('showMesh').onchange = (e) => {
    state.showMesh = e.target.checked;
    if (state.mode === 'photo') renderPhoto();
  };
}

// ---------- Arranque ----------
(async function main() {
  bindControls();
  await loadCatalog();
  initStrip();
  setStatus('Cargando modelo de IA…');
  try {
    await initTracker('VIDEO');
  } catch (err) {
    setStatus('⚠ Error cargando el modelo: ' + err.message + '. Ejecuta: npm run fetch-model');
    return;
  }
  state.running = true;
  if (await startCamera()) liveLoop();
})();
