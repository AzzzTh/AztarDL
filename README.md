# 🏛️ AztarDL — Descargador de Videos y Audios

Descarga videos y audios de más de 1,000 plataformas (YouTube, TikTok, Instagram, Twitter, Vimeo, SoundCloud y más) de forma gratuita, sin registro y en alta calidad.

---

## 📋 Requisitos previos

Antes de instalar el proyecto asegúrate de tener:

| Herramienta | Versión mínima | Descarga |
|---|---|---|
| **Node.js** | v18+ | https://nodejs.org |
| **npm** | v9+ | Incluido con Node.js |
| **yt-dlp** | Última estable | Ver instrucciones abajo |
| **ffmpeg** | v5+ | Ver instrucciones abajo |

---

## ⚙️ Instalación de dependencias del sistema

### yt-dlp (el motor de descarga)

**Windows:**
```cmd
winget install yt-dlp
```
O descarga el `.exe` desde: https://github.com/yt-dlp/yt-dlp/releases/latest  
Colócalo en una carpeta que esté en tu PATH (ej. `C:\Windows\System32\`).

**macOS:**
```bash
brew install yt-dlp
```

**Linux (Debian/Ubuntu):**
```bash
sudo apt install yt-dlp
# o con pip:
pip install yt-dlp
```

---

### ffmpeg (necesario para mezclar video+audio y convertir formatos)

**Windows:**
```cmd
winget install ffmpeg
```
O descarga desde https://ffmpeg.org/download.html y añade la carpeta `bin` al PATH.

**macOS:**
```bash
brew install ffmpeg
```

**Linux (Debian/Ubuntu):**
```bash
sudo apt install ffmpeg
```

---

## 🚀 Instalación y ejecución del proyecto

### 1. Instalar todas las dependencias (una sola vez)

```cmd
npm run install:all
```

Este comando instala las dependencias de la raíz, del backend y del frontend.

---

### 2. Ejecutar en modo desarrollo (con hot-reload)

```cmd
npm run dev
```

Esto levanta:
- **Backend** → http://localhost:3001
- **Frontend** → http://localhost:5173

Abre **http://localhost:5173** en tu navegador.

---

### 3. Compilar para producción

```cmd
npm run build
```

El frontend queda compilado en `frontend/dist/`.

---

### 4. Ejecutar en modo producción

```cmd
npm start
```

---

## 🗂️ Estructura del proyecto

```
aztardl/
├── package.json              ← Scripts raíz (dev, build, start)
│
├── backend/
│   ├── package.json
│   └── server.js             ← API Express (info + descarga)
│
└── frontend/
    ├── index.html
    ├── vite.config.js
    ├── package.json
    └── src/
        ├── main.jsx
        ├── App.jsx
        ├── index.css
        ├── context/
        │   └── AppContext.jsx    ← Tema + idioma global
        ├── i18n/
        │   └── translations.js  ← ES, EN, PT, FR, DE, JA
        ├── components/
        │   ├── Header.jsx        ← Navbar con idioma/tema/contacto
        │   ├── UrlInput.jsx      ← Campo URL + botones
        │   ├── MediaPanel.jsx    ← Info del video (izquierda)
        │   └── DownloadOptions.jsx ← Calidad y formato (derecha)
        └── pages/
            ├── Home.jsx          ← Página principal
            └── HowTo.jsx         ← Guía de uso
```

---

## 🌐 API del Backend

| Endpoint | Método | Descripción |
|---|---|---|
| `/api/info?url=...` | GET | Obtiene metadatos del video/audio |
| `/api/download?url=...&type=...&quality=...&format=...&title=...` | GET | Descarga el archivo |

### Parámetros de `/api/download`

| Parámetro | Valores | Descripción |
|---|---|---|
| `url` | URL completa | Enlace del video/audio |
| `type` | `video` \| `audio` | Tipo de descarga |
| `quality` | `1080`, `720`, `480`... | Altura en píxeles (solo video) |
| `format` | `mp4`, `webm` (video) / `m4a`, `flac`, `wav`, `opus`, `ogg`, `mp3` (audio) | Formato de salida |
| `title` | Texto | Nombre del archivo a descargar |

---

## 🌍 Idiomas disponibles

| Código | Idioma |
|---|---|
| `es` | Español 🇲🇽 |
| `en` | English 🇺🇸 |
| `pt` | Português 🇧🇷 |
| `fr` | Français 🇫🇷 |
| `de` | Deutsch 🇩🇪 |
| `ja` | 日本語 🇯🇵 |

---

## ✅ Verificación rápida

Para confirmar que yt-dlp y ffmpeg están correctamente instalados:

```cmd
yt-dlp --version
ffmpeg -version
```

Ambos deben mostrar su versión sin errores.

---

## 🎨 Características de la interfaz

- **Tema oscuro/claro** — Toggle en la barra superior
- **6 idiomas** — Selector de idioma con banderas
- **Mini reproductor** — Vista previa integrada (YouTube)
- **Panel dividido** — Info del video (izquierda) + Opciones de descarga (derecha)
- **Formatos de audio** — Sin opción MP3 para contenido nativo de audio (m4a, flac, wav, opus)
- **Atajos de teclado** — `Ctrl+V` para pegar, `Enter` para analizar
- **Auto-limpieza** — El panel desaparece al borrar el URL

---

## 🔧 Variables de entorno (opcionales)

Crea un archivo `.env` en la carpeta `backend/` si deseas cambiar el puerto:

```env
PORT=3001
```

---

## 📝 Notas importantes

- AztarDL utiliza `yt-dlp` para obtener información y descargar contenido. Asegúrate de tener la versión más reciente ejecutando `yt-dlp -U`.
- Videos protegidos por DRM (Netflix, Disney+, etc.) **no son compatibles** por limitaciones técnicas y legales.
- La velocidad de descarga depende de tu conexión a internet y de los servidores de la plataforma origen.
