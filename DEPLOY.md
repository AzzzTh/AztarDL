# 🚀 Guía de Despliegue — GitHub Pages + Railway

Este documento explica cómo subir AztarDL a GitHub Pages (frontend) y Railway (backend)
para que todo funcione en producción desde internet.

---

## Arquitectura en producción

```
Usuario
  │
  ├─► GitHub Pages  (frontend React)
  │       https://tuusuario.github.io/aztardl/
  │
  └─► Railway       (backend Express + yt-dlp)
          https://aztardl-backend.up.railway.app
```

El frontend habla con el backend a través de la variable `VITE_API_URL`.

---

## PARTE 1 — Subir el código a GitHub

### 1.1 Crear el repositorio

1. Ve a https://github.com/new
2. Nombre del repositorio: `aztardl` (o el que prefieras)
3. Déjalo en **Public** (requerido para GitHub Pages gratuito)
4. **No** marques "Initialize this repository" — ya tienes archivos
5. Clic en **Create repository**

### 1.2 Conectar tu carpeta local con GitHub

Abre CMD dentro de la carpeta `aztardl/` y ejecuta:

```cmd
git init
git add .
git commit -m "Initial commit: AztarDL v2"
git branch -M main
git remote add origin https://github.com/TUUSUARIO/aztardl.git
git push -u origin main
```

> Reemplaza `TUUSUARIO` con tu nombre de usuario de GitHub.

---

## PARTE 2 — Desplegar el backend en Railway

Railway te da un servidor Linux con yt-dlp y ffmpeg instalados automáticamente.

### 2.1 Crear cuenta y proyecto

1. Ve a https://railway.app y crea una cuenta (puedes usar tu cuenta de GitHub)
2. Haz clic en **New Project → Deploy from GitHub repo**
3. Selecciona tu repositorio `aztardl`
4. Railway detectará múltiples carpetas. Haz clic en **Add Service → GitHub Repo**
5. En la configuración del servicio, establece:
   - **Root Directory:** `backend`
   - Railway leerá el `nixpacks.toml` e instalará yt-dlp + ffmpeg automáticamente

### 2.2 Variables de entorno en Railway

En el panel de Railway, ve a tu servicio → **Variables** y agrega:

| Variable | Valor |
|---|---|
| `PORT` | `3001` |

### 2.3 Obtener la URL del backend

Una vez desplegado, Railway te dará una URL similar a:
```
https://aztardl-backend-production.up.railway.app
```

**Cópiala**, la necesitarás en el siguiente paso.

---

## PARTE 3 — Configurar GitHub Pages + el Secret de la API

### 3.1 Agregar el Secret en GitHub

1. Ve a tu repositorio en GitHub
2. Haz clic en **Settings → Secrets and variables → Actions**
3. Haz clic en **New repository secret**
4. Agrega:
   - **Name:** `VITE_API_URL`
   - **Value:** `https://aztardl-backend-production.up.railway.app` (la URL de Railway)
5. Clic en **Add secret**

### 3.2 Activar GitHub Pages

1. En tu repositorio GitHub, ve a **Settings → Pages**
2. En **Source**, selecciona **GitHub Actions**
3. Guarda los cambios

### 3.3 Ejecutar el workflow

GitHub Actions correrá automáticamente cada vez que hagas `git push` a `main`.
Para ejecutarlo manualmente la primera vez:

1. Ve a tu repositorio → pestaña **Actions**
2. Selecciona el workflow **"Deploy AztarDL to GitHub Pages"**
3. Haz clic en **Run workflow → Run workflow**

Espera ~1-2 minutos. Verás una palomita verde ✅ cuando termine.

### 3.4 Acceder a tu sitio

Tu frontend estará disponible en:
```
https://TUUSUARIO.github.io/aztardl/
```

---

## PARTE 4 — Actualizar el proyecto en el futuro

Cada vez que modifiques el código:

```cmd
git add .
git commit -m "descripción del cambio"
git push
```

GitHub Actions reconstruirá y desplegará automáticamente en ~1 minuto.

Para actualizar solo el backend, Railway también redesplegará automáticamente
al detectar cambios en la carpeta `backend/`.

---

## ⚠️ Notas importantes

| Tema | Detalle |
|---|---|
| **GitHub Pages es solo frontend** | El HTML/CSS/JS estático se sirve gratis. El backend necesita Railway (u otro server). |
| **Railway plan gratuito** | Incluye $5/mes de crédito. AztarDL con uso moderado entra fácilmente. |
| **yt-dlp en Railway** | Instalado automáticamente vía `nixpacks.toml`. Sin configuración adicional. |
| **Archivos temporales** | Los archivos descargados se guardan en `/tmp` del servidor Railway y se eliminan a los 10 min. |
| **CORS** | El backend ya tiene CORS abierto (`origin: '*'`). Si quieres restringirlo, cambia esa línea en `server.js`. |

---

## Flujo completo resumido

```
1. git push → main
      ↓
2. GitHub Actions corre
      ↓
3. npm run build (con VITE_API_URL=https://tu-backend.railway.app)
      ↓
4. frontend/dist/ → GitHub Pages
      ↓
5. Usuario visita https://TUUSUARIO.github.io/aztardl/
      ↓
6. Frontend hace fetch a Railway para analizar/descargar
```
