# AOC Web / PWA — para iPad (y cualquier navegador)

Versión web de la app AOC (color de ojos). Funciona en **Safari del iPad**, con
cámara, touch y **offline** (se instala como app con "Agregar a inicio").

Todo lo necesario está dentro de esta carpeta `web/` (motor, MediaPipe, modelo,
lentes, logo, íconos). Es un sitio estático: se publica tal cual.

---

## 1) Probarla en tu Mac (rápido)
```bash
node web/serve.js
```
Abre **http://localhost:8100** en Safari/Chrome del Mac. En `localhost` la cámara
funciona sin necesidad de HTTPS.

## 2) Publicarla para abrirla en el iPad
La cámara en iPad **requiere HTTPS**, así que hay que subir la carpeta a un hosting.
La forma más fácil (gratis, sin cuenta técnica):

**Netlify Drop**
1. Entra a **https://app.netlify.com/drop**
2. **Arrastra la carpeta `web/`** completa a la página.
3. Te da una URL `https://...netlify.app` → ábrela en el **iPad**.

(También sirve Vercel, Cloudflare Pages o GitHub Pages: sube el contenido de `web/`.)

## 3) Instalarla en el iPad como app
1. Abre la URL en **Safari** (iPad).
2. Toca **Compartir** → **"Agregar a inicio"**.
3. Ábrela desde el ícono: se ve a **pantalla completa**, como una app.
4. La primera vez, Safari pedirá **permiso de cámara** → Permitir.
5. Tras cargarla una vez con internet, funciona **offline**.

---

### Notas
- El archivo `_headers` (para Netlify) activa el modo rápido de MediaPipe.
- Para actualizar la app publicada, vuelve a arrastrar la carpeta `web/` a Netlify
  (o re-despliega); el service worker toma la versión nueva al recargar.
- `serve.js` es solo para pruebas locales; no se necesita en el hosting.
