// eyeTracker.js — Envuelve MediaPipe FaceLandmarker (detección de iris offline).
import { FaceLandmarker, FilesetResolver } from
  '../node_modules/@mediapipe/tasks-vision/vision_bundle.mjs';

// Índices de landmarks del iris (malla refinada de 478 puntos)
const LEFT_IRIS = [468, 469, 470, 471, 472];   // centro = 468
const RIGHT_IRIS = [473, 474, 475, 476, 477];  // centro = 473

// Contorno de la abertura de cada ojo (para enmascarar y no pintar el párpado)
const RIGHT_EYE = [33, 246, 161, 160, 159, 158, 157, 173, 133, 155, 154, 153, 145, 144, 163, 7];
const LEFT_EYE  = [362, 398, 384, 385, 386, 387, 388, 466, 263, 249, 390, 373, 374, 380, 381, 382];

let landmarker = null;

export async function initTracker(runningMode = 'VIDEO') {
  const fileset = await FilesetResolver.forVisionTasks(
    '../node_modules/@mediapipe/tasks-vision/wasm'
  );
  landmarker = await FaceLandmarker.createFromOptions(fileset, {
    baseOptions: {
      modelAssetPath: '../assets/models/face_landmarker.task',
      delegate: 'GPU'
    },
    runningMode,
    numFaces: 1,
    minFaceDetectionConfidence: 0.4,
    minTrackingConfidence: 0.4
  });
  return landmarker;
}

export async function setRunningMode(mode) {
  if (landmarker) await landmarker.setOptions({ runningMode: mode });
}

// Devuelve los ojos en píxeles del canvas: [{cx,cy,r,poly}, ...]
export function detect(source, mode, timestampMs, W, H) {
  if (!landmarker) return { eyes: [], landmarks: null };
  let result;
  if (mode === 'VIDEO') {
    result = landmarker.detectForVideo(source, timestampMs);
  } else {
    result = landmarker.detect(source);
  }
  if (!result.faceLandmarks || result.faceLandmarks.length === 0) {
    return { eyes: [], landmarks: null };
  }
  const lm = result.faceLandmarks[0];
  // Emparejamiento correcto: iris 468 va con el contorno [33…] y el 473 con [362…].
  const eyes = [buildEye(lm, LEFT_IRIS, RIGHT_EYE, W, H),
                buildEye(lm, RIGHT_IRIS, LEFT_EYE, W, H)];
  return { eyes, landmarks: lm };
}

function buildEye(lm, irisIdx, eyeIdx, W, H) {
  const center = lm[irisIdx[0]];
  const cx = center.x * W, cy = center.y * H;
  let r = 0;
  for (let i = 1; i < irisIdx.length; i++) {
    const p = lm[irisIdx[i]];
    r += Math.hypot(p.x * W - cx, p.y * H - cy);
  }
  r /= (irisIdx.length - 1);
  const poly = eyeIdx.map((i) => ({ x: lm[i].x * W, y: lm[i].y * H }));

  // Apertura del ojo (para detectar parpadeo): alto/ancho de la abertura.
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of poly) {
    if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
  }
  const open = (maxX - minX) > 1 ? (maxY - minY) / (maxX - minX) : 1;

  return { cx, cy, r, poly, open };
}
