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

// ── Startup checks ────────────────────────────────────────────────────────────
async function checkTools() {
  for (const cmd of [
    'yt-dlp --version',
    'ffmpeg -version',
    'ffprobe -version',
  ]) {
    try {
      const { stdout } = await execAsync(cmd + ' 2>&1');
      console.log(`✅ ${cmd.split(' ')[0]}: ${stdout.split('\n')[0].trim()}`);
    } catch {
      console.warn(`⚠️  ${cmd.split(' ')[0]} no encontrado`);
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
  // ffmpeg re-encode progress
  if (line.includes('[VideoConvertor]') || line.includes('Recoding video')) return { percent: 95, speed: null, eta: null };
  if (line.includes('[Merger]') || line.includes('Merging'))  return { percent: 93, speed: null, eta: null };
  if (line.includes('[ExtractAudio]'))                        return { percent: 96, speed: null, eta: null };
  return null;
}

function notifyClients(job) {
  if (!job.sseClients.length) return;
  const payload = JSON.stringify({
    status: job.status, progress: job.progress,
    speed: job.speed, eta: job.eta,
    error: job.error, filename: job.filename,
  });
  for (const c of job.sseClients) {
    try { c.write(`data: ${payload}\n\n`); } catch {}
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PLATFORM CLIENTS
//
// YouTube: tv_embedded is the YouTube embedded player used by third-party
//   websites. Unlike the web/android/iOS clients, it does NOT require
//   signature decryption challenges when accessed from datacenter IPs.
//   It's the most reliable option for server environments in 2025.
//   We add ios and web_creator as automatic fallbacks.
//
// TikTok: We force H.264 download by:
//   1. Format selector explicitly rejecting HEVC (bytevc1) and AV1
//   2. yt-dlp --recode-video mp4 with --postprocessor-args to re-encode
//      via ffmpeg IN-PROCESS (not a separate step), converting to H.264
//      during the existing download pipeline — no extra wait time.
// ─────────────────────────────────────────────────────────────────────────────

// Common args — all platforms
const COMMON_ARGS = [
  '--retries', '5',
  '--fragment-retries', '5',
  '--no-check-certificates',
  '--add-headers', 'Accept-Language:en-US,en;q=0.9',
];

// YouTube — tv_embedded client (works from servers, no CAPTCHA)
const YT_ARGS = [
  '--extractor-args', 'youtube:player_client=tv_embedded,ios,web_creator',
  '--user-agent',
  'Mozilla/5.0 (SMART-TV; Linux; Tizen 6.0) AppleWebKit/538.1 (KHTML, like Gecko) Version/6.0 TV Safari/538.1',
];

// TikTok — mobile UA + no HEVC/AV1 formats + force re-encode via yt-dlp postprocessor
// bytevc1 = TikTok's internal name for HEVC
const TIKTOK_ARGS = [
  '--user-agent', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  '--add-headers', 'Referer:https://www.tiktok.com/',
  // Force H.264 output: re-encode anything that isn't H.264 through ffmpeg
  '--recode-video', 'mp4',
  '--postprocessor-args', 'ffmpeg:-c:v libx264 -preset fast -crf 23 -c:a aac -b:a 192k -movflags +faststart',
];

function getExtraArgs(url) {
  if (/youtu\.?be|youtube\.com/i.test(url)) return YT_ARGS;
  if (/tiktok\.com/i.test(url))             return TIKTOK_ARGS;
  return [];
}

// ── Format selector: prefer H.264 (avc) ──────────────────────────────────────
// For TikTok, TIKTOK_ARGS handles the re-encode fallback so we only need
// the format selector to try H.264 first.
function buildVideoFormatSelector(height, url = '') {
  const h = parseInt(height, 10) || 1080;

  // TikTok: their H.264 is labeled "h264", not "avc"
  if (/tiktok\.com/i.test(url)) {
    return [
      `bestvideo[height<=${h}][vcodec=h264]+bestaudio`,
      `bestvideo[height<=${h}][vcodec^=avc]+bestaudio`,
      `bestvideo[height<=${h}][vcodec!*=bytevc1][vcodec!*=av01]+bestaudio`,
      `best[height<=${h}][vcodec=h264]`,
      `best[height<=${h}]`,
      'best',
    ].join('/');
  }

  // All other platforms
  return [
    `bestvideo[height<=${h}][vcodec^=avc][ext=mp4]+bestaudio[acodec^=mp4a][ext=m4a]`,
    `bestvideo[height<=${h}][vcodec^=avc][ext=mp4]+bestaudio`,
    `bestvideo[height<=${h}][vcodec^=avc]+bestaudio[acodec^=mp4a]`,
    `bestvideo[height<=${h}][vcodec^=avc]+bestaudio`,
    `best[height<=${h}][vcodec^=avc][ext=mp4]`,
    `best[height<=${h}][vcodec^=avc]`,
    `bestvideo[height<=${h}]+bestaudio`,
    `best[height<=${h}]`,
    'best',
  ].join('/');
}

function buildArgs(url, baseArgs) {
  return [...COMMON_ARGS, ...getExtraArgs(url), ...baseArgs, url];
}

// ── GET /api/info?url=... ─────────────────────────────────────────────────────
app.get('/api/info', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'Se requiere una URL.' });

  const safeUrl = url.replace(/["`;]/g, '');
  const isPlaylist =
    /\/playlist\?|\/sets\/|\/album\/|\/collection/.test(safeUrl) ||
    (safeUrl.includes('list=') && !safeUrl.includes('watch?v='));

  const cmd_args = isPlaylist
    ? ['--flat-playlist', '--dump-single-json', '--no-warnings']
    : ['--no-playlist', '--dump-json', '--no-warnings'];

  const args = buildArgs(safeUrl, cmd_args);

  try {
    const { stdout } = await execAsync(
      `yt-dlp ${args.map(a => `"${a}"`).join(' ')}`,
      { timeout: 55000 }
    );
    const info = JSON.parse(stdout);

    // ── Playlist response ──────────────────────────────────────────────────
    if (isPlaylist && (info._type === 'playlist' || Array.isArray(info.entries))) {
      const entries = (info.entries || []).slice(0, 200).map(e => ({
        id:        e.id || randomUUID(),
        title:     e.title || 'Sin título',
        url:       e.webpage_url || e.url
                   || (e.ie_key === 'Youtube' ? `https://www.youtube.com/watch?v=${e.id}` : null)
                   || safeUrl,
        duration:  e.duration  || null,
        thumbnail: e.thumbnail || e.thumbnails?.[0]?.url || null,
      }));
      return res.json({
        isPlaylist: true,
        title:      info.title    || 'Playlist',
        uploader:   info.uploader || info.channel || null,
        entryCount: entries.length,
        entries,
        thumbnail:  info.thumbnail || info.thumbnails?.[0]?.url || entries[0]?.thumbnail || null,
      });
    }

    // ── Single video response ──────────────────────────────────────────────
    const formats    = info.formats || [];
    const heightSeen = new Set();
    const videoQualities = formats
      .filter(f => f.vcodec && f.vcodec !== 'none' && f.height)
      .sort((a, b) => (b.height || 0) - (a.height || 0))
      .filter(f => { if (heightSeen.has(f.height)) return false; heightSeen.add(f.height); return true; })
      .map(f => ({
        height:   f.height,
        label:    `${f.height}p${f.fps && f.fps > 30 ? Math.round(f.fps) : ''}`,
        filesize: formatFileSize(f.filesize || f.filesize_approx),
      }));

    const isAudioOnly = videoQualities.length === 0;

    res.json({
      isPlaylist:   false,
      title:        info.title       || 'Sin título',
      description:  info.description ? info.description.substring(0, 350) : null,
      duration:     info.duration    || null,
      thumbnail:    info.thumbnail   || null,
      uploader:     info.uploader    || info.channel || null,
      platform:     info.extractor_key || 'Web',
      isAudioOnly,
      videoQualities,
      audioExportFormats: isAudioOnly
        ? ['m4a', 'flac', 'wav', 'opus']
        : ['mp3', 'm4a', 'flac', 'wav', 'ogg'],
    });

  } catch (err) {
    console.error('[/api/info]', err.message?.slice(0, 400));
    const msg =
      /Sign in|bot|confirm|please sign/i.test(err.message)
        ? 'YouTube bloqueó la petición. Intenta de nuevo en unos segundos.'
      : /Unsupported URL/i.test(err.message)
        ? 'URL no compatible o no encontrada.'
      : /timeout/i.test(err.message)
        ? 'Tiempo de espera agotado. Intenta de nuevo.'
      : /Private|private/i.test(err.message)
        ? 'Este video es privado.'
      : /Unable to extract/i.test(err.message)
        ? 'No se pudo extraer el video. La plataforma puede estar bloqueando servidores.'
      : 'No se pudo analizar el enlace. Verifica que sea válido y público.';
    res.status(500).json({ error: msg });
  }
});

// ── POST /api/jobs ────────────────────────────────────────────────────────────
app.post('/api/jobs', (req, res) => {
  const {
    url, type = 'video', quality = '1080',
    format = 'mp4', title = 'video',
  } = req.body;
  if (!url) return res.status(400).json({ error: 'Falta la URL.' });

  const jobId     = randomUUID();
  const tempId    = randomUUID();
  const tempTpl   = join(tmpdir(), `aztardl_${tempId}.%(ext)s`);
  const safeTitle = sanitizeFilename(title);

  const job = {
    id: jobId, tempId, status: 'running',
    progress: 0, speed: null, eta: null,
    filePath: null, ext: null, filename: null, error: null,
    sseClients: [],
  };
  jobs.set(jobId, job);

  // Build yt-dlp args
  const dlBaseArgs = type === 'audio'
    ? [
        '-f', 'bestaudio/best',
        '-x', '--audio-format', format, '--audio-quality', '0',
        '-o', tempTpl, '--no-playlist', '--no-warnings',
      ]
    : [
        '-f', buildVideoFormatSelector(quality, url),
        '--merge-output-format', 'mp4',
        '-o', tempTpl, '--no-playlist', '--no-warnings',
      ];

  const args = buildArgs(url, dlBaseArgs);
  console.log(`[job ${jobId.slice(0, 8)}] yt-dlp ${args.slice(-4).join(' ')}`);

  const ytdlp = spawn('yt-dlp', args);

  const onLine = (line) => {
    const p = parseProgress(line);
    if (p) {
      job.progress = p.percent;
      job.speed    = p.speed;
      job.eta      = p.eta;
      notifyClients(job);
    }
  };

  ytdlp.stdout.on('data', d => d.toString().split('\n').forEach(onLine));
  ytdlp.stderr.on('data', d => d.toString().split('\n').forEach(onLine));

  ytdlp.on('close', (code) => {
    // yt-dlp (with --recode-video) may change the extension — find any output file
    const files = readdirSync(tmpdir()).filter(f =>
      f.startsWith(`aztardl_${tempId}`) &&
      !f.endsWith('.part') &&
      !f.endsWith('.ytdl') &&
      !f.endsWith('.json')
    );

    if (code !== 0 || !files.length) {
      job.status = 'error';
      job.error  = 'La descarga falló. Prueba otra calidad o formato.';
      notifyClients(job);
      job.sseClients.forEach(c => { try { c.end(); } catch {} });
      job.sseClients = [];
      return;
    }

    // Prefer .mp4 if multiple files exist (e.g. after re-encode)
    const chosen = files.find(f => f.endsWith('.mp4')) || files[0];
    const ext    = chosen.split('.').pop().toLowerCase();

    job.filePath = join(tmpdir(), chosen);
    job.ext      = ext;
    job.filename = `${safeTitle}.${ext}`;
    job.progress = 100;
    job.eta      = null;
    job.status   = 'done';

    console.log(`[job ${jobId.slice(0, 8)}] ✅ done → ${chosen}`);

    notifyClients(job);
    job.sseClients.forEach(c => { try { c.end(); } catch {} });
    job.sseClients = [];

    // Auto-delete after 10 minutes
    setTimeout(() => {
      files.forEach(f => { try { unlinkSync(join(tmpdir(), f)); } catch {} });
      jobs.delete(jobId);
    }, 10 * 60 * 1000);
  });

  ytdlp.on('error', (err) => {
    job.status = 'error';
    job.error  = `Error al iniciar yt-dlp: ${err.message}`;
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

  res.write(`data: ${JSON.stringify({
    status: job.status, progress: job.progress,
    speed: job.speed, eta: job.eta,
    error: job.error, filename: job.filename,
  })}\n\n`);

  if (job.status === 'done' || job.status === 'error') { res.end(); return; }

  job.sseClients.push(res);
  req.on('close', () => { job.sseClients = job.sseClients.filter(c => c !== res); });
});

// ── GET /api/jobs/:id/file ────────────────────────────────────────────────────
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
    res.setHeader('Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(job.filename || 'video')}`);
    createReadStream(job.filePath).pipe(res);
  } catch {
    res.status(500).json({ error: 'No se pudo leer el archivo.' });
  }
});

app.listen(PORT, () => console.log(`\n🏛️  AztarDL → http://localhost:${PORT}\n`));
