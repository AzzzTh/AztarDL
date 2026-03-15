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

// ── Startup: verify yt-dlp + ffmpeg ──────────────────────────────────────────
async function checkTools() {
  for (const cmd of ['yt-dlp --version', 'ffmpeg -version', 'ffprobe -version']) {
    try {
      const { stdout } = await execAsync(cmd + ' 2>&1');
      console.log(`✅ ${cmd.split(' ')[0]}: ${stdout.split('\n')[0].trim()}`);
    } catch (e) {
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
  if (line.includes('[Merger]') || line.includes('Merging')) return { percent: 95, speed: null, eta: '0:05' };
  if (line.includes('[ExtractAudio]'))                         return { percent: 97, speed: null, eta: '0:02' };
  if (line.includes('ffmpeg') && line.includes('frame='))     return { percent: 98, speed: null, eta: '0:10' };
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

// ── Detect codec via ffprobe (robust) ─────────────────────────────────────────
async function getVideoCodec(filePath) {
  // Run ffprobe with full path fallback
  const cmds = [
    `ffprobe -v error -select_streams v:0 -show_entries stream=codec_name -of csv=p=0 "${filePath}" 2>&1`,
    `ffprobe -v quiet -print_format json -show_streams "${filePath}" 2>&1`,
  ];
  for (const cmd of cmds) {
    try {
      const { stdout } = await execAsync(cmd, { timeout: 15000 });
      const text = stdout.trim();
      if (!text || text.includes('error')) continue;

      // First command: plain codec name
      if (!text.startsWith('{')) {
        const codec = text.split('\n')[0].trim().toLowerCase();
        if (codec) return codec;
        continue;
      }

      // Second command: JSON
      const json = JSON.parse(text);
      const vStream = (json.streams || []).find(s => s.codec_type === 'video');
      if (vStream?.codec_name) return vStream.codec_name.toLowerCase();
    } catch {}
  }
  return null;
}

// ── Re-encode to H.264 + AAC using ffmpeg ─────────────────────────────────────
async function reencodeToH264(inputPath) {
  const outPath = inputPath.replace(/\.[^.]+$/, '_h264.mp4');
  console.log(`[re-encode] ${inputPath} → ${outPath}`);

  await new Promise((resolve, reject) => {
    const ff = spawn('ffmpeg', [
      '-i',  inputPath,
      '-c:v', 'libx264',
      '-preset', 'fast',
      '-crf', '23',
      '-c:a', 'aac',
      '-b:a', '192k',
      '-movflags', '+faststart',
      '-y', outPath,
    ]);

    let errBuf = '';
    ff.stderr.on('data', d => { errBuf += d.toString(); });
    ff.on('close', code => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg code ${code}: ${errBuf.slice(-300)}`));
    });
    ff.on('error', reject);
  });

  try { unlinkSync(inputPath); } catch {}
  return outPath;
}

// ─────────────────────────────────────────────────────────────────────────────
// YOUTUBE FIX: try several player clients in sequence until one works.
// mweb → uses m.youtube.com endpoint, lighter bot-check than desktop/android.
// ios  → Apple client, different auth path.
// tv   → Smart TV, no CAPTCHA enforcement.
// web_creator → Creator Studio client, rarely blocked.
// We also skip signature checks and add sleep to avoid rate limits.
// ─────────────────────────────────────────────────────────────────────────────
const YT_CLIENT_ORDER = 'mweb,ios,tv,web_creator,android_vr';

// Common flags for all platforms
const COMMON_ARGS = [
  '--retries', '5',
  '--fragment-retries', '5',
  '--sleep-requests', '1',
  '--no-check-certificates',
  '--add-headers', 'Accept-Language:en-US,en;q=0.9',
];

// YouTube-specific flags (appended when URL is YouTube)
const YT_ARGS = [
  '--extractor-args', `youtube:player_client=${YT_CLIENT_ORDER}`,
  '--extractor-args', 'youtube:skip=hls',          // avoid HLS-only formats that need auth
  '--user-agent', 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
];

// TikTok-specific flags
const TIKTOK_ARGS = [
  '--user-agent', 'TikTok/26.2.0 (iPhone; iOS 17.0; Scale/3.00)',
  '--add-headers', 'Referer:https://www.tiktok.com/',
];

function getExtraArgs(url) {
  if (/youtu\.?be|youtube\.com/i.test(url)) return YT_ARGS;
  if (/tiktok\.com/i.test(url))             return TIKTOK_ARGS;
  return [];
}

// ── H.264-preferred format selector ──────────────────────────────────────────
function buildVideoFormatSelector(height) {
  const h = parseInt(height, 10) || 1080;
  return [
    `bestvideo[height<=${h}][vcodec^=avc][ext=mp4]+bestaudio[acodec^=mp4a][ext=m4a]`,
    `bestvideo[height<=${h}][vcodec^=avc][ext=mp4]+bestaudio`,
    `bestvideo[height<=${h}][vcodec^=avc]+bestaudio[acodec^=mp4a]`,
    `bestvideo[height<=${h}][vcodec^=avc]+bestaudio`,
    `best[height<=${h}][vcodec^=avc][ext=mp4]`,
    `best[height<=${h}][vcodec^=avc]`,
    // Fallback: any format — post-download re-encode will fix the codec
    `bestvideo[height<=${h}]+bestaudio`,
    `best[height<=${h}]`,
    'best',
  ].join('/');
}

// ── Build arg array ───────────────────────────────────────────────────────────
function buildArgs(url, baseArgs, extraArgs = []) {
  return [...COMMON_ARGS, ...getExtraArgs(url), ...extraArgs, ...baseArgs, url];
}

// ── GET /api/info?url=... ─────────────────────────────────────────────────────
app.get('/api/info', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'Se requiere una URL.' });

  const safeUrl = url.replace(/"/g, '').replace(/`/g, '');
  const looksLikePlaylist =
    /\/playlist\?|\/sets\/|\/album\/|\/collection/.test(safeUrl) ||
    (safeUrl.includes('list=') && !safeUrl.includes('watch?v='));

  const baseFlags = ['--no-warnings'];
  const args = buildArgs(safeUrl,
    looksLikePlaylist
      ? ['--flat-playlist', '--dump-single-json', ...baseFlags]
      : ['--no-playlist', '--dump-json', ...baseFlags]
  );

  try {
    const { stdout } = await execAsync(
      `yt-dlp ${args.map(a => `"${a}"`).join(' ')}`,
      { timeout: 55000 }
    );
    const info = JSON.parse(stdout);

    // ── Playlist ──
    if (looksLikePlaylist && (info._type === 'playlist' || Array.isArray(info.entries))) {
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

    // ── Single video ──
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
    console.error('[/api/info]', err.message?.slice(0, 400));
    const msg =
      /Sign in|bot|confirm/.test(err.message)
        ? 'YouTube bloqueó la petición en este intento. Intenta de nuevo en unos segundos.'
        : /Unsupported URL/.test(err.message)  ? 'URL no compatible o no encontrada.'
        : /timeout/.test(err.message)          ? 'Tiempo de espera agotado. Intenta de nuevo.'
        : /Private|private/.test(err.message)  ? 'Este video es privado.'
        : /Unable to extract/.test(err.message)? 'No se pudo extraer. La plataforma puede bloquear servidores.'
        : 'No se pudo analizar el enlace. Verifica que sea válido y público.';
    res.status(500).json({ error: msg });
  }
});

// ── POST /api/jobs ────────────────────────────────────────────────────────────
app.post('/api/jobs', (req, res) => {
  const { url, type = 'video', quality = '1080', format = 'mp4', title = 'video' } = req.body;
  if (!url) return res.status(400).json({ error: 'Falta la URL.' });

  const jobId  = randomUUID();
  const tempId = randomUUID();
  const tempTpl = join(tmpdir(), `aztardl_${tempId}.%(ext)s`);
  const safeTitle = sanitizeFilename(title);

  const job = {
    id: jobId, tempId, status: 'running',
    progress: 0, speed: null, eta: null,
    filePath: null, ext: null, filename: null, error: null,
    sseClients: [],
  };
  jobs.set(jobId, job);

  const dlArgs = type === 'audio'
    ? ['-f', 'bestaudio/best', '-x', '--audio-format', format, '--audio-quality', '0',
       '-o', tempTpl, '--no-playlist', '--no-warnings']
    : ['-f', buildVideoFormatSelector(quality), '--merge-output-format', 'mp4',
       '-o', tempTpl, '--no-playlist', '--no-warnings'];

  const args = buildArgs(url, dlArgs);
  console.log(`[job ${jobId}] yt-dlp`, args.slice(-3).join(' '));

  const ytdlp = spawn('yt-dlp', args);

  const onLine = (line) => {
    const p = parseProgress(line);
    if (p) { job.progress = p.percent; job.speed = p.speed; job.eta = p.eta; notifyClients(job); }
  };

  ytdlp.stdout.on('data', d => d.toString().split('\n').forEach(onLine));
  ytdlp.stderr.on('data', d => d.toString().split('\n').forEach(onLine));

  ytdlp.on('close', async (code) => {
    const files = readdirSync(tmpdir())
      .filter(f => f.startsWith(`aztardl_${tempId}`) && !f.endsWith('.part') && !f.endsWith('.ytdl'));

    if (code !== 0 || !files.length) {
      job.status = 'error';
      job.error  = 'La descarga falló. Prueba otra calidad o formato.';
      notifyClients(job);
      job.sseClients.forEach(c => { try { c.end(); } catch {} });
      job.sseClients = [];
      return;
    }

    let outFile = join(tmpdir(), files[0]);
    let ext     = files[0].split('.').pop().toLowerCase();

    // ── Post-download codec fix: re-encode HEVC/AV1/VP9 → H.264 ─────────────
    if (type === 'video' && ['mp4', 'mkv', 'mov', 'webm', 'ts'].includes(ext)) {
      try {
        const codec = await getVideoCodec(outFile);
        console.log(`[codec] ${files[0]} → "${codec}"`);

        const nonUniversal = codec && (
          codec.includes('hevc') || codec.includes('hev') || codec.includes('hvc') ||
          codec === 'av1' || codec === 'av01' ||
          codec === 'vp9' || codec === 'vp8'
        );

        if (nonUniversal) {
          job.eta = 'Convirtiendo a H.264…';
          notifyClients(job);
          outFile = await reencodeToH264(outFile);
          ext     = 'mp4';
          console.log(`[codec] ✅ Re-encoded → H.264`);
        } else {
          console.log(`[codec] ✅ Already H.264 — no re-encode needed`);
        }
      } catch (err) {
        console.error('[codec fix]', err.message);
        // Continue with original file — better than failing
      }
    }

    job.filePath = outFile;
    job.ext      = ext;
    job.filename = `${safeTitle}.${ext}`;
    job.progress = 100;
    job.eta      = null;
    job.status   = 'done';

    notifyClients(job);
    job.sseClients.forEach(c => { try { c.end(); } catch {} });
    job.sseClients = [];

    setTimeout(() => {
      if (job.filePath) { try { unlinkSync(job.filePath); } catch {} }
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

  res.write(`data: ${JSON.stringify({ status: job.status, progress: job.progress, speed: job.speed, eta: job.eta, error: job.error, filename: job.filename })}\n\n`);
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
    mp4:'video/mp4', webm:'video/webm', mkv:'video/x-matroska',
    mp3:'audio/mpeg', m4a:'audio/mp4', flac:'audio/flac',
    wav:'audio/wav', ogg:'audio/ogg', opus:'audio/opus',
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

app.listen(PORT, () => console.log(`\n🏛️  AztarDL → http://localhost:${PORT}\n`));
