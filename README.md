# AOC — Color de Ojos 👁️

App que cambia el **color de los ojos** simulando lentes de contacto, en tiempo real.

## 🔗 Demo en vivo (ábrela en el celular/iPad o navegador)
### 👉 https://tor8garcia86.github.io/actualiza-color-ojos/
> En iPad/iPhone: ábrela en **Safari**, acepta el permiso de **cámara**, y puedes
> **Compartir → Agregar a inicio** para usarla como app (incluso sin conexión).

---

También hay una versión de **escritorio (Mac/Windows)** con Electron. Funciona
**100% offline** — la detección del iris corre localmente con MediaPipe (WASM),
sin enviar nada a internet.

## Características
- 🎥 **En vivo**: cambia el color en la vista de la cámara en tiempo real.
- 📸 **Foto**: abre una imagen o captura desde la cámara y aplica el lente.
- 🎨 **Catálogo de lentes** con textura de iris (editable).
- 🎚️ Controles de intensidad, tamaño del iris y modo de mezcla.
- 💾 Exporta la imagen resultante como PNG.

## Requisitos
- Node.js 18+ (probado con 20).
- Una cámara web (para el modo en vivo).

## Instalación
```bash
npm install        # instala dependencias y descarga el modelo de IA (solo 1 vez)
npm start          # abre la app
```
> El modelo (`face_landmarker.task`, ~3.6 MB) se descarga automáticamente en la
> instalación y se guarda en `assets/models/`. Después la app ya no necesita internet.
> Si falla la descarga: `npm run fetch-model`.

## Empaquetar como app instalable
```bash
npm run build:mac     # genera un .dmg (macOS)
npm run build:win     # genera un instalador .exe (Windows)
```

## Cómo agregar TUS lentes al catálogo
Edita `assets/lenses/catalog.json`. Cada lente admite:
```json
{ "id": "miel", "name": "Miel", "color": "#a9702f" }
```
- `color`: tono base; la app genera la textura del iris automáticamente.
- `texture` (opcional): ruta a una imagen PNG del iris, p. ej.
  `{ "id": "galaxy", "name": "Galaxy", "texture": "lenses/galaxy.png" }`
  (coloca el PNG en `assets/lenses/`). La imagen del iris debe ser cuadrada y
  centrada; idealmente con fondo transparente fuera del círculo.

## Estructura
```
electron/     proceso principal (ventana + servidor local + guardar/abrir)
src/          interfaz (HTML/CSS) y lógica del renderer
  eyeTracker.js    detección de iris con MediaPipe
  lensRenderer.js  generación de textura y compositing del lente
  app.js           orquestación cámara/foto/UI
assets/
  models/     modelo de MediaPipe (offline)
  lenses/     catálogo de lentes + imágenes
scripts/      descarga del modelo
```
