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
const app  = express();
const PORT = process.env.PORT || 3001;
const jobs = new Map();

app.use(cors({ origin: '*' }));
app.use(morgan('dev'));
app.use(express.json());

// ── Startup ───────────────────────────────────────────────────────────────────
async function checkTools() {
  for (const cmd of ['yt-dlp --version', 'ffmpeg -version', 'ffprobe -version']) {
    try {
      const { stdout } = await execAsync(cmd + ' 2>&1');
      console.log(`✅ ${cmd.split(' ')[0]}: ${stdout.split('\n')[0].trim()}`);
    } catch {
      console.warn(`⚠️  ${cmd.split(' ')[0]} not found`);
    }
  }
}
checkTools();

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
  if (line.includes('[VideoConvertor]') || line.includes('Recoding')) return { percent: 95, speed: null, eta: null };
  if (line.includes('[Merger]') || line.includes('Merging'))          return { percent: 93, speed: null, eta: null };
  if (line.includes('[ExtractAudio]'))                                return { percent: 96, speed: null, eta: null };
  return null;
}
function notifyClients(job) {
  if (!job.sseClients.length) return;
  const payload = JSON.stringify({ status: job.status, progress: job.progress,
    speed: job.speed, eta: job.eta, error: job.error, filename: job.filename });
  for (const c of job.sseClients) { try { c.write(`data: ${payload}\n\n`); } catch {} }
}

// ─────────────────────────────────────────────────────────────────────────────
// PLATFORM ARGS
//
// KEY DESIGN: infoArgs vs dlArgs are SEPARATE.
// Postprocessing flags (--recode-video, --postprocessor-args) are DOWNLOAD-ONLY
// and must NOT be sent to --dump-json / --flat-playlist commands.
//
// YouTube: po=true is the "proof of origin" token that the new yt-dlp versions
//   use to bypass the bot check on server IPs. Combined with android_testsuite
//   client this is the most reliable combination as of 2026.
//
// TikTok: We tell yt-dlp to use --recode-video only during DOWNLOAD (dlArgs),
//   not during info fetch (infoArgs).
//
// Instagram: use mobile app UA which doesn't require login for public reels.
// ─────────────────────────────────────────────────────────────────────────────

const COMMON_INFO_ARGS = [
  '--retries', '3',
  '--no-check-certificates',
  '--socket-timeout', '30',
];

const COMMON_DL_ARGS = [
  '--retries', '5',
  '--fragment-retries', '5',
  '--no-check-certificates',
  '--socket-timeout', '30',
];

// ── YouTube ───────────────────────────────────────────────────────────────────
// po=true enables the proof-of-origin token (new yt-dlp 2026 feature)
const YT_INFO_ARGS = [
  '--extractor-args', 'youtube:player_client=android_testsuite,tv_embedded,ios;po_token=true',
  '--user-agent', 'com.google.android.youtube/19.29.37 (Linux; U; Android 14) gzip',
  '--add-headers', 'X-YouTube-Client-Name:3',
  '--add-headers', 'X-YouTube-Client-Version:19.29.37',
];
const YT_DL_ARGS = [...YT_INFO_ARGS];

// ── TikTok ────────────────────────────────────────────────────────────────────
// infoArgs: only UA and headers (NO recode flags — invalid for dump-json)
// dlArgs: adds recode-video to force H.264 output
const TIKTOK_INFO_ARGS = [
  '--user-agent', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
  '--add-headers', 'Referer:https://www.tiktok.com/',
  '--add-headers', 'Accept-Language:en-US,en;q=0.9',
];
const TIKTOK_DL_ARGS = [
  ...TIKTOK_INFO_ARGS,
  '--recode-video', 'mp4',
  '--postprocessor-args', 'ffmpeg:-c:v libx264 -preset fast -crf 23 -c:a aac -b:a 192k -movflags +faststart',
];

// ── Instagram ─────────────────────────────────────────────────────────────────
// Instagram public reels work with Instagram mobile app UA
const IG_INFO_ARGS = [
  '--user-agent', 'Instagram 325.0.0.34.90 Android (31/12; 420dpi; 1080x2340; Google/google; Pixel 6; redfin; redfin; en_US; 554993463)',
  '--add-headers', 'Accept-Language:en-US,en;q=0.9',
  '--add-headers', 'X-IG-App-ID:936619743392459',
];
const IG_DL_ARGS = [...IG_INFO_ARGS];

function getPlatformInfoArgs(url) {
  if (/youtu\.?be|youtube\.com/i.test(url)) return YT_INFO_ARGS;
  if (/tiktok\.com/i.test(url))             return TIKTOK_INFO_ARGS;
  if (/instagram\.com/i.test(url))          return IG_INFO_ARGS;
  return [];
}
function getPlatformDlArgs(url) {
  if (/youtu\.?be|youtube\.com/i.test(url)) return YT_DL_ARGS;
  if (/tiktok\.com/i.test(url))             return TIKTOK_DL_ARGS;
  if (/instagram\.com/i.test(url))          return IG_DL_ARGS;
  return [];
}

// ── Format selector ───────────────────────────────────────────────────────────
function buildVideoFormatSelector(height, url = '') {
  const h = parseInt(height, 10) || 1080;
  if (/tiktok\.com/i.test(url)) {
    return [
      `bestvideo[height<=${h}][vcodec=h264]+bestaudio`,
      `bestvideo[height<=${h}][vcodec^=avc]+bestaudio`,
      `bestvideo[height<=${h}][vcodec!*=bytevc1][vcodec!*=av01]+bestaudio`,
      `best[height<=${h}]`, 'best',
    ].join('/');
  }
  return [
    `bestvideo[height<=${h}][vcodec^=avc][ext=mp4]+bestaudio[acodec^=mp4a][ext=m4a]`,
    `bestvideo[height<=${h}][vcodec^=avc]+bestaudio[acodec^=mp4a]`,
    `bestvideo[height<=${h}][vcodec^=avc]+bestaudio`,
    `best[height<=${h}][vcodec^=avc]`,
    `bestvideo[height<=${h}]+bestaudio`,
    `best[height<=${h}]`, 'best',
  ].join('/');
}

// ── GET /api/info?url=... ─────────────────────────────────────────────────────
app.get('/api/info', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'Se requiere una URL.' });

  const safeUrl  = url.replace(/["`;]/g, '');
  const isPlaylist =
    /\/playlist\?|\/sets\/|\/album\/|\/collection/.test(safeUrl) ||
    (safeUrl.includes('list=') && !safeUrl.includes('watch?v='));

  // Build args: common + platform-specific INFO args + command flags + url
  const args = [
    ...COMMON_INFO_ARGS,
    ...getPlatformInfoArgs(safeUrl),
    ...(isPlaylist
      ? ['--flat-playlist', '--dump-single-json', '--no-warnings']
      : ['--no-playlist', '--dump-json', '--no-warnings']),
    safeUrl,
  ];

  const cmdStr = `yt-dlp ${args.map(a => `"${a}"`).join(' ')}`;
  console.log(`[info] ${safeUrl.slice(0, 70)}`);

  try {
    const { stdout } = await execAsync(cmdStr, { timeout: 60000 });
    const info = JSON.parse(stdout);

    // Playlist
    if (isPlaylist && (info._type === 'playlist' || Array.isArray(info.entries))) {
      const entries = (info.entries || []).slice(0, 200).map(e => ({
        id: e.id || randomUUID(),
        title: e.title || 'Sin título',
        url: e.webpage_url || e.url
          || (e.ie_key === 'Youtube' ? `https://www.youtube.com/watch?v=${e.id}` : null)
          || safeUrl,
        duration:  e.duration  || null,
        thumbnail: e.thumbnail || e.thumbnails?.[0]?.url || null,
      }));
      return res.json({
        isPlaylist: true, title: info.title || 'Playlist',
        uploader: info.uploader || info.channel || null,
        entryCount: entries.length, entries,
        thumbnail: info.thumbnail || info.thumbnails?.[0]?.url || entries[0]?.thumbnail || null,
      });
    }

    // Single video
    const formats    = info.formats || [];
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
      title:       info.title       || 'Sin título',
      description: info.description ? info.description.substring(0, 350) : null,
      duration:    info.duration    || null,
      thumbnail:   info.thumbnail   || null,
      uploader:    info.uploader    || info.channel || null,
      platform:    info.extractor_key || 'Web',
      isAudioOnly, videoQualities,
      audioExportFormats: isAudioOnly
        ? ['m4a', 'flac', 'wav', 'opus']
        : ['mp3', 'm4a', 'flac', 'wav', 'ogg'],
    });

  } catch (err) {
    const raw = err.message || '';
    console.error('[/api/info]', raw.slice(0, 300));
    const msg =
      /Sign in|bot|confirm|please sign/i.test(raw)
        ? 'YouTube detectó el servidor. Intenta en unos segundos o prueba con otro video.'
      : /Unsupported URL/i.test(raw)   ? 'URL no compatible.'
      : /timeout|timed out/i.test(raw) ? 'Tiempo de espera agotado. Intenta de nuevo.'
      : /[Pp]rivate/i.test(raw)        ? 'Este video es privado.'
      : /[Ll]ogin|auth/i.test(raw)     ? 'Este contenido requiere iniciar sesión.'
      : /Unable to extract/i.test(raw) ? 'No se pudo extraer el video.'
      : 'No se pudo analizar el enlace. Verifica que sea válido y público.';
    res.status(500).json({ error: msg });
  }
});

// ── POST /api/jobs ────────────────────────────────────────────────────────────
app.post('/api/jobs', (req, res) => {
  const { url, type = 'video', quality = '1080', format = 'mp4', title = 'video' } = req.body;
  if (!url) return res.status(400).json({ error: 'Falta la URL.' });

  const jobId     = randomUUID();
  const tempId    = randomUUID();
  const tempTpl   = join(tmpdir(), `aztardl_${tempId}.%(ext)s`);
  const safeTitle = sanitizeFilename(title);

  const job = { id: jobId, tempId, status: 'running', progress: 0,
    speed: null, eta: null, filePath: null, ext: null,
    filename: null, error: null, sseClients: [] };
  jobs.set(jobId, job);

  const dlBaseArgs = type === 'audio'
    ? ['-f', 'bestaudio/best', '-x', '--audio-format', format,
       '--audio-quality', '0', '-o', tempTpl, '--no-playlist', '--no-warnings']
    : ['-f', buildVideoFormatSelector(quality, url), '--merge-output-format', 'mp4',
       '-o', tempTpl, '--no-playlist', '--no-warnings'];

  const args = [
    ...COMMON_DL_ARGS,
    ...getPlatformDlArgs(url),
    ...dlBaseArgs,
    url,
  ];

  const ytdlp = spawn('yt-dlp', args);

  const onLine = (line) => {
    const p = parseProgress(line);
    if (p) { job.progress = p.percent; job.speed = p.speed; job.eta = p.eta; notifyClients(job); }
  };
  ytdlp.stdout.on('data', d => d.toString().split('\n').forEach(onLine));
  ytdlp.stderr.on('data', d => d.toString().split('\n').forEach(onLine));

  ytdlp.on('close', (code) => {
    const files = readdirSync(tmpdir()).filter(f =>
      f.startsWith(`aztardl_${tempId}`) &&
      !f.endsWith('.part') && !f.endsWith('.ytdl') && !f.endsWith('.json')
    );
    if (code !== 0 || !files.length) {
      job.status = 'error'; job.error = 'La descarga falló. Prueba otra calidad o formato.';
      notifyClients(job);
      job.sseClients.forEach(c => { try { c.end(); } catch {} });
      job.sseClients = [];
      return;
    }
    const chosen   = files.find(f => f.endsWith('.mp4')) || files[0];
    job.filePath   = join(tmpdir(), chosen);
    job.ext        = chosen.split('.').pop().toLowerCase();
    job.filename   = `${safeTitle}.${job.ext}`;
    job.progress   = 100; job.eta = null; job.status = 'done';
    notifyClients(job);
    job.sseClients.forEach(c => { try { c.end(); } catch {} });
    job.sseClients = [];
    setTimeout(() => {
      files.forEach(f => { try { unlinkSync(join(tmpdir(), f)); } catch {} });
      jobs.delete(jobId);
    }, 10 * 60 * 1000);
  });

  ytdlp.on('error', (err) => {
    job.status = 'error'; job.error = `Error: ${err.message}`;
    notifyClients(job);
    job.sseClients.forEach(c => { try { c.end(); } catch {} });
    job.sseClients = [];
  });

  res.json({ jobId });
});

// ── GET /api/jobs/:id/progress ────────────────────────────────────────────────
app.get('/api/jobs/:id/progress', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job no encontrado.' });
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  res.write(`data: ${JSON.stringify({ status: job.status, progress: job.progress,
    speed: job.speed, eta: job.eta, error: job.error, filename: job.filename })}\n\n`);
  if (job.status === 'done' || job.status === 'error') { res.end(); return; }
  job.sseClients.push(res);
  req.on('close', () => { job.sseClients = job.sseClients.filter(c => c !== res); });
});

// ── GET /api/jobs/:id/file ────────────────────────────────────────────────────
app.get('/api/jobs/:id/file', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job || job.status !== 'done' || !job.filePath)
    return res.status(404).json({ error: 'Archivo no disponible o expirado.' });
  const mime = { mp4:'video/mp4', webm:'video/webm', mkv:'video/x-matroska',
    mp3:'audio/mpeg', m4a:'audio/mp4', flac:'audio/flac',
    wav:'audio/wav', ogg:'audio/ogg', opus:'audio/opus' };
  try {
    const size = statSync(job.filePath).size;
    res.setHeader('Content-Type', mime[job.ext] || 'application/octet-stream');
    res.setHeader('Content-Length', size);
    res.setHeader('Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(job.filename || 'video')}`);
    createReadStream(job.filePath).pipe(res);
  } catch { res.status(500).json({ error: 'No se pudo leer el archivo.' }); }
});

app.listen(PORT, () => console.log(`\n🏛️  AztarDL → http://localhost:${PORT}\n`));
