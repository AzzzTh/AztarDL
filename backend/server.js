import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import { tmpdir } from 'os';
import { join } from 'path';
import { createReadStream, readdirSync, unlinkSync, statSync } from 'fs';
import { randomUUID } from 'crypto';

const execAsync = promisify(exec);
const app = express();
const PORT = process.env.PORT || 3001;

// ── In-memory job store ───────────────────────────────────────────────────────
const jobs = new Map();

app.use(cors({ origin: '*' }));
app.use(morgan('dev'));
app.use(express.json());

async function checkYtdlp() {
  try {
    const { stdout } = await execAsync('yt-dlp --version');
    console.log(`✅ yt-dlp: ${stdout.trim()}`);
  } catch {
    console.warn('⚠️  yt-dlp no encontrado en PATH');
  }
}
checkYtdlp();

// ── Helpers ───────────────────────────────────────────────────────────────────
function formatFileSize(bytes) {
  if (!bytes) return null;
  const units = ['B', 'KB', 'MB', 'GB'];
  let s = bytes, u = 0;
  while (s > 1024 && u < 3) { s /= 1024; u++; }
  return `${s.toFixed(1)} ${units[u]}`;
}

function sanitizeFilename(name = 'video') {
  return name.replace(/[^\w\s\-áéíóúüñÁÉÍÓÚÜÑ]/gi, '_').trim().substring(0, 100);
}

function parseProgress(line) {
  const m = line.match(/\[download\]\s+([\d.]+)%.*?at\s+([\d.]+\s*\w+\/s).*?ETA\s+([\d:]+)/);
  if (m) return { percent: parseFloat(m[1]), speed: m[2].trim(), eta: m[3] };
  if (line.includes('[Merger]') || line.includes('Merging formats')) return { percent: 99, speed: null, eta: '0:01' };
  if (line.includes('[ExtractAudio]')) return { percent: 99, speed: null, eta: '0:01' };
  return null;
}

function notifyClients(job) {
  if (!job.sseClients.length) return;
  const payload = JSON.stringify({
    status: job.status, progress: job.progress,
    speed: job.speed, eta: job.eta,
    error: job.error, filename: job.filename,
  });
  for (const client of job.sseClients) {
    try { client.write(`data: ${payload}\n\n`); } catch {}
  }
}

// Prefer H.264 (avc1) + AAC — universal codecs. Avoids HEVC/AV1/VP9.
function buildVideoFormatSelector(height) {
  const h = parseInt(height, 10) || 1080;
  return [
    `bestvideo[height<=${h}][vcodec^=avc][ext=mp4]+bestaudio[acodec^=mp4a][ext=m4a]`,
    `bestvideo[height<=${h}][vcodec^=avc]+bestaudio[acodec^=mp4a]`,
    `bestvideo[height<=${h}][vcodec^=avc]+bestaudio`,
    `bestvideo[height<=${h}][vcodec!*=av01][vcodec!*=vp09][vcodec!*=hvc1][vcodec!*=hev1]+bestaudio`,
    `best[height<=${h}][vcodec^=avc]`,
    `best[height<=${h}]`,
    'best',
  ].join('/');
}

// ── GET /api/info?url=... ─────────────────────────────────────────────────────
app.get('/api/info', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'Se requiere una URL.' });

  const safeUrl = url.replace(/"/g, '');
  const looksLikePlaylist =
    safeUrl.includes('/playlist?') ||
    safeUrl.includes('/sets/') ||
    safeUrl.includes('/album/') ||
    safeUrl.includes('/collection') ||
    (safeUrl.includes('list=') && !safeUrl.includes('watch?v='));

  try {
    if (looksLikePlaylist) {
      const { stdout } = await execAsync(
        `yt-dlp --flat-playlist --dump-single-json --no-warnings "${safeUrl}"`,
        { timeout: 40000 }
      );
      const info = JSON.parse(stdout);

      if (info._type === 'playlist' || Array.isArray(info.entries)) {
        const entries = (info.entries || []).slice(0, 200).map(e => ({
          id: e.id || randomUUID(),
          title: e.title || 'Sin título',
          url: e.webpage_url || e.url
            || (e.ie_key === 'Youtube' ? `https://www.youtube.com/watch?v=${e.id}` : null)
            || safeUrl,
          duration: e.duration || null,
          thumbnail: e.thumbnail || e.thumbnails?.[0]?.url || null,
        }));

        return res.json({
          isPlaylist: true,
          title: info.title || 'Playlist',
          uploader: info.uploader || info.channel || null,
          entryCount: entries.length,
          entries,
          thumbnail: info.thumbnail || info.thumbnails?.[0]?.url || entries[0]?.thumbnail || null,
        });
      }
    }

    // Single video/audio
    const { stdout } = await execAsync(
      `yt-dlp --no-playlist --dump-json --no-warnings "${safeUrl}"`,
      { timeout: 30000 }
    );
    const info = JSON.parse(stdout);
    const formats = info.formats || [];

    const heightSeen = new Set();
    const videoQualities = formats
      .filter(f => f.vcodec && f.vcodec !== 'none' && f.height)
      .sort((a, b) => (b.height || 0) - (a.height || 0))
      .filter(f => { if (heightSeen.has(f.height)) return false; heightSeen.add(f.height); return true; })
      .map(f => ({
        height: f.height,
        label: `${f.height}p${f.fps && f.fps > 30 ? Math.round(f.fps) : ''}`,
        filesize: formatFileSize(f.filesize || f.filesize_approx),
      }));

    const isAudioOnly = videoQualities.length === 0;

    res.json({
      isPlaylist: false,
      title: info.title || 'Sin título',
      description: info.description ? info.description.substring(0, 350) : null,
      duration: info.duration || null,
      thumbnail: info.thumbnail || null,
      uploader: info.uploader || info.channel || null,
      platform: info.extractor_key || 'Web',
      isAudioOnly,
      videoQualities,
      audioExportFormats: isAudioOnly
        ? ['m4a', 'flac', 'wav', 'opus']
        : ['mp3', 'm4a', 'flac', 'wav', 'ogg'],
    });

  } catch (err) {
    console.error('[/api/info]', err.message?.slice(0, 300));
    const msg =
      err.message?.includes('Unsupported URL') ? 'URL no compatible o no encontrada.' :
      err.message?.includes('timeout') ? 'Tiempo de espera agotado.' :
      err.message?.includes('Private') ? 'Este video es privado.' :
      'No se pudo analizar el enlace. Verifica que sea válido y público.';
    res.status(500).json({ error: msg });
  }
});

// ── POST /api/jobs — crear y ejecutar una descarga en background ──────────────
app.post('/api/jobs', (req, res) => {
  const { url, type = 'video', quality = '1080', format = 'mp4', title = 'video' } = req.body;
  if (!url) return res.status(400).json({ error: 'Falta la URL.' });

  const jobId  = randomUUID();
  const tempId = randomUUID();
  const tempTemplate = join(tmpdir(), `aztardl_${tempId}.%(ext)s`);
  const safeTitle = sanitizeFilename(title);

  const job = {
    id: jobId, tempId, status: 'running',
    progress: 0, speed: null, eta: null,
    filePath: null, ext: null, filename: null, error: null,
    sseClients: [],
  };
  jobs.set(jobId, job);

  let args;
  if (type === 'audio') {
    args = [
      '-f', 'bestaudio/best',
      '-x', '--audio-format', format,
      '--audio-quality', '0',
      '-o', tempTemplate,
      '--no-playlist', '--no-warnings', url,
    ];
  } else {
    args = [
      '-f', buildVideoFormatSelector(quality),
      '--merge-output-format', format === 'webm' ? 'webm' : 'mp4',
      '-o', tempTemplate,
      '--no-playlist', '--no-warnings', url,
    ];
  }

  const ytdlp = spawn('yt-dlp', args);

  const handleLine = (line) => {
    const p = parseProgress(line);
    if (p) {
      job.progress = p.percent;
      job.speed    = p.speed;
      job.eta      = p.eta;
      notifyClients(job);
    }
  };

  ytdlp.stdout.on('data', d => d.toString().split('\n').forEach(handleLine));
  ytdlp.stderr.on('data', d => d.toString().split('\n').forEach(handleLine));

  ytdlp.on('close', (code) => {
    const files = readdirSync(tmpdir()).filter(f => f.startsWith(`aztardl_${tempId}`) && !f.endsWith('.part'));

    if (code === 0 && files.length) {
      const outFile  = files[0];
      job.filePath   = join(tmpdir(), outFile);
      job.ext        = outFile.split('.').pop();
      job.filename   = `${safeTitle}.${job.ext}`;
      job.progress   = 100;
      job.status     = 'done';
    } else {
      job.status = 'error';
      job.error  = 'La descarga falló. Prueba otra calidad o formato.';
      files.forEach(f => { try { unlinkSync(join(tmpdir(), f)); } catch {} });
    }

    notifyClients(job);
    job.sseClients.forEach(c => { try { c.end(); } catch {} });
    job.sseClients = [];

    // Auto-eliminar archivo después de 10 min
    setTimeout(() => {
      if (job.filePath) { try { unlinkSync(job.filePath); } catch {} }
      jobs.delete(jobId);
    }, 10 * 60 * 1000);
  });

  ytdlp.on('error', (err) => {
    job.status = 'error';
    job.error  = `yt-dlp no encontrado: ${err.message}`;
    notifyClients(job);
    job.sseClients.forEach(c => { try { c.end(); } catch {} });
    job.sseClients = [];
  });

  res.json({ jobId });
});

// ── GET /api/jobs/:id/progress — SSE de progreso ─────────────────────────────
app.get('/api/jobs/:id/progress', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job no encontrado.' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const payload = JSON.stringify({ status: job.status, progress: job.progress, speed: job.speed, eta: job.eta, error: job.error, filename: job.filename });
  res.write(`data: ${payload}\n\n`);

  if (job.status === 'done' || job.status === 'error') { res.end(); return; }

  job.sseClients.push(res);
  req.on('close', () => { job.sseClients = job.sseClients.filter(c => c !== res); });
});

// ── GET /api/jobs/:id/file — stream del archivo completado ───────────────────
app.get('/api/jobs/:id/file', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job || job.status !== 'done' || !job.filePath) {
    return res.status(404).json({ error: 'Archivo no disponible o expirado.' });
  }

  const mime = {
    mp4: 'video/mp4', webm: 'video/webm', mkv: 'video/x-matroska',
    mp3: 'audio/mpeg', m4a: 'audio/mp4', flac: 'audio/flac',
    wav: 'audio/wav', ogg: 'audio/ogg', opus: 'audio/opus',
  };

  try {
    const size = statSync(job.filePath).size;
    res.setHeader('Content-Type', mime[job.ext] || 'application/octet-stream');
    res.setHeader('Content-Length', size);
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(job.filename || 'video')}`);
    createReadStream(job.filePath).pipe(res);
  } catch {
    res.status(500).json({ error: 'No se pudo leer el archivo.' });
  }
});

app.listen(PORT, () => {
  console.log(`\n🏛️  AztarDL Backend → http://localhost:${PORT}\n`);
});
