// lensRenderer.js
// Compone lentes sobre el iris detectado. Soporta:
//  1) Imágenes de lente reales (PNG con fondo/centro transparente, tipo Alcon):
//     detecta automáticamente el radio del anillo de color y el hueco central,
//     y los alinea al iris. Preserva el brillo (catchlight) del ojo real.
//  2) Texturas procedurales generadas a partir de un color base.

const textureCache = new Map();   // key -> HTMLImageElement | HTMLCanvasElement
const analysisCache = new Map();  // key -> { outer, inner }  (ratios 0..1)

// Capa de composición reutilizable (para difuminar borde y pupila del lente).
const _layer = document.createElement('canvas');
const _lx = _layer.getContext('2d');

// ---------- Texturas ----------
function makeIrisTexture(color) {
  if (textureCache.has(color)) return textureCache.get(color);
  const size = 256;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const cx = size / 2, cy = size / 2, R = size / 2;
  const { r, g, b } = hexToRgb(color);
  const base = `rgb(${r},${g},${b})`;
  const dark = `rgb(${Math.round(r * 0.45)},${Math.round(g * 0.45)},${Math.round(b * 0.45)})`;
  const light = `rgb(${Math.min(255, r + 60)},${Math.min(255, g + 60)},${Math.min(255, b + 60)})`;
  const grad = ctx.createRadialGradient(cx, cy, R * 0.22, cx, cy, R);
  grad.addColorStop(0, light); grad.addColorStop(0.45, base);
  grad.addColorStop(0.85, base); grad.addColorStop(1, dark);
  ctx.fillStyle = grad;
  ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fill();
  for (let i = 0; i < 130; i++) {
    const a = (i / 130) * Math.PI * 2;
    const r0 = R * (0.24 + Math.random() * 0.08), r1 = R * (0.78 + Math.random() * 0.2);
    ctx.strokeStyle = `rgba(255,255,255,${0.03 + Math.random() * 0.08})`;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
    ctx.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
    ctx.stroke();
  }
  const ring = ctx.createRadialGradient(cx, cy, R * 0.7, cx, cy, R);
  ring.addColorStop(0, 'rgba(0,0,0,0)'); ring.addColorStop(1, 'rgba(0,0,0,0.55)');
  ctx.fillStyle = ring;
  ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fill();
  textureCache.set(color, c);
  return c;
}

function loadImageTexture(src) {
  if (textureCache.has(src)) return textureCache.get(src);
  const img = new Image();
  img.onerror = () => console.error('No se pudo cargar el lente:', src);
  img.src = src;
  textureCache.set(src, img);
  return img;
}

export function getTexture(lens) {
  if (!lens || !lens.id || lens.id === 'none') return null;
  // Las rutas del catálogo son relativas a assets/ (p.ej. "lenses/xxx.png").
  // La página vive en /src/, así que anteponemos "../assets/".
  if (lens.texture) return loadImageTexture('assets/' + lens.texture);
  if (lens.color) return makeIrisTexture(lens.color);
  return null;
}

// ---------- Análisis del PNG del lente ----------
// Detecta el radio exterior del anillo de color y el radio del hueco central,
// como fracción del semiancho de la imagen (0..1).
function analyze(texture, key) {
  if (analysisCache.has(key)) return analysisCache.get(key);
  const s = 96;
  const c = document.createElement('canvas'); c.width = c.height = s;
  const x = c.getContext('2d');
  try { x.drawImage(texture, 0, 0, s, s); } catch (_) { return null; }
  let data;
  try { data = x.getImageData(0, 0, s, s).data; } catch (_) { return null; }
  const cx = s / 2, cy = s / 2, TH = 60;

  // Radio exterior: máxima distancia con alpha > umbral.
  let outer = 0;
  for (let y = 0; y < s; y++) {
    for (let xx = 0; xx < s; xx++) {
      if (data[(y * s + xx) * 4 + 3] > TH) {
        const d = Math.hypot(xx - cx, y - cy);
        if (d > outer) outer = d;
      }
    }
  }
  // Radio del hueco central: primer radio (desde el centro) donde el anillo
  // de color ya está presente en la mayoría de direcciones.
  let inner = 0;
  const N = 24;
  for (let rr = 1; rr < outer; rr++) {
    let hit = 0;
    for (let k = 0; k < N; k++) {
      const a = (k / N) * Math.PI * 2;
      const px = Math.round(cx + Math.cos(a) * rr);
      const py = Math.round(cy + Math.sin(a) * rr);
      if (px < 0 || py < 0 || px >= s || py >= s) continue;
      if (data[(py * s + px) * 4 + 3] > TH) hit++;
    }
    if (hit / N > 0.6) { inner = rr; break; }
  }
  const res = { outer: outer / (s / 2), inner: inner / (s / 2) };
  analysisCache.set(key, res);
  return res;
}

// ---------- Dibujo ----------
// eye = { cx, cy, r, poly } en píxeles del canvas.
// opts = { opacity, scale, blend }.  source = video/imagen original (para brillos).
export function drawLens(ctx, texture, eye, opts, source) {
  if (!texture || !eye) return;
  const isImg = texture instanceof HTMLImageElement;
  if (isImg && (!texture.complete || texture.naturalWidth === 0)) return;

  const key = isImg ? texture.src : null;
  const info = isImg ? analyze(texture, key) : { outer: 1, inner: 0 };
  if (!info) return;

  const scale = opts.scale || 1;
  const R = eye.r * scale * 0.93;             // radio del iris (ajuste fino para no asomar al blanco)
  const outer = info.outer > 0.05 ? info.outer : 1;
  const blend = opts.blend || 'natural';
  const op = opts.opacity;
  const W = ctx.canvas.width, H = ctx.canvas.height;

  ctx.save();
  // Recorte a la abertura del ojo (evita pintar el párpado). Encogemos el
  // contorno hacia su centro —más en vertical— para dejar margen y que el
  // lente no se monte en el párpado si el tracking va con un leve retardo.
  if (eye.poly && eye.poly.length > 2) {
    let mx = 0, my = 0;
    for (const p of eye.poly) { mx += p.x; my += p.y; }
    mx /= eye.poly.length; my /= eye.poly.length;
    const ix = (p) => mx + (p.x - mx) * 0.94;   // 6% en horizontal
    const iy = (p) => my + (p.y - my) * 0.80;   // 20% en vertical (párpados)
    ctx.beginPath();
    ctx.moveTo(ix(eye.poly[0]), iy(eye.poly[0]));
    for (let i = 1; i < eye.poly.length; i++) ctx.lineTo(ix(eye.poly[i]), iy(eye.poly[i]));
    ctx.closePath();
    ctx.clip();
  }
  const cx = eye.cx, cy = eye.cy;
  ctx.beginPath();
  ctx.arc(cx, cy, R * 1.2, 0, Math.PI * 2);
  ctx.clip();

  // Color base del lente (rellena los huecos del patrón), ligeramente desaturado.
  let { r: cr, g: cg, b: cb } = opts.color ? hexToRgb(opts.color) : { r: 128, g: 128, b: 128 };
  { const lum = 0.3 * cr + 0.59 * cg + 0.11 * cb, k = 0.28;
    cr = Math.round(cr + (lum - cr) * k); cg = Math.round(cg + (lum - cg) * k); cb = Math.round(cb + (lum - cb) * k); }

  // === Componemos el LENTE REAL en una capa aparte ===
  // Así podemos difuminar su borde exterior y su hueco de pupila con precisión,
  // y luego fusionarlo con la luz del ojo real (que es lo que evita el "pegado").
  const PI2 = Math.PI * 2;
  const pad = Math.ceil(R * 1.3);
  const size = pad * 2;
  if (_layer.width !== size) { _layer.width = size; _layer.height = size; }
  _lx.clearRect(0, 0, size, size);
  const LX = pad, LY = pad;

  // 1) Base de color semitransparente: cubre el iris pero deja ver tu textura real.
  _lx.globalCompositeOperation = 'source-over';
  _lx.globalAlpha = 0.78;
  _lx.fillStyle = `rgb(${cr},${cg},${cb})`;
  _lx.beginPath(); _lx.arc(LX, LY, R * 1.05, 0, PI2); _lx.fill();

  // 2) Imagen REAL del lente encima → patrón e identidad del lente Alcon.
  if (isImg) {
    const Rimg = R / outer;
    _lx.globalAlpha = 1;
    _lx.drawImage(texture, LX - Rimg, LY - Rimg, Rimg * 2, Rimg * 2);
  }

  // 3) Hueco de pupila difuminado (deja ver la pupila real).
  const holeR = isImg ? Math.max(R * 0.30, (info.inner / outer) * R) : R * 0.40;
  _lx.globalCompositeOperation = 'destination-out';
  const hg = _lx.createRadialGradient(LX, LY, 0, LX, LY, holeR);
  hg.addColorStop(0, 'rgba(0,0,0,1)');
  hg.addColorStop(0.6, 'rgba(0,0,0,1)');
  hg.addColorStop(1, 'rgba(0,0,0,0)');
  _lx.fillStyle = hg;
  _lx.beginPath(); _lx.arc(LX, LY, holeR, 0, PI2); _lx.fill();

  // 4) DIFUMINADO del borde exterior → funde el lente con el ojo (sin círculo duro).
  _lx.globalCompositeOperation = 'destination-in';
  const fg = _lx.createRadialGradient(LX, LY, R * 0.5, LX, LY, R * 1.05);
  fg.addColorStop(0, 'rgba(0,0,0,1)');
  fg.addColorStop(0.80, 'rgba(0,0,0,1)');
  fg.addColorStop(1, 'rgba(0,0,0,0)');
  _lx.fillStyle = fg;
  _lx.beginPath(); _lx.arc(LX, LY, R * 1.05, 0, PI2); _lx.fill();

  // 5) Fusiona la capa del lente sobre el iris real, con un DESENFOQUE sutil que
  //    suaviza el patrón y los bordes → mata el aspecto "sticker/dona".
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = blend === 'tint' ? op * 0.6 : op;
  ctx.filter = `blur(${Math.max(0.6, R * 0.07).toFixed(2)}px)`;
  ctx.drawImage(_layer, cx - pad, cy - pad);
  ctx.filter = 'none';

  // 6) Luminancia del ojo real (nítida) → sombra, profundidad, pupila y BRILLO.
  //    Integra el lente con la iluminación real del ojo (clave de la fusión).
  if (source) {
    ctx.globalCompositeOperation = 'luminosity';
    ctx.globalAlpha = blend === 'vivid' ? 0.55 : 0.8;
    // Solo la zona del ojo (no todo el cuadro) → mucho más rápido.
    const bx = Math.max(0, Math.floor(cx - pad)), by = Math.max(0, Math.floor(cy - pad));
    const bw = Math.min(W - bx, size), bh = Math.min(H - by, size);
    if (bw > 0 && bh > 0) ctx.drawImage(source, bx, by, bw, bh, bx, by, bw, bh);
  }

  ctx.restore();
}

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return {
    r: parseInt(h.substring(0, 2), 16),
    g: parseInt(h.substring(2, 4), 16),
    b: parseInt(h.substring(4, 6), 16)
  };
}
