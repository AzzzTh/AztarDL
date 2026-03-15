import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import { exec, execFile, spawn } from 'child_process';
import { promisify } from 'util';
import { tmpdir } from 'os';
import { join, basename } from 'path';
import { createReadStream, readdirSync, unlinkSync, statSync, renameSync } from 'fs';
import { randomUUID } from 'crypto';

const execAsync     = promisify(exec);
const execFileAsync = promisify(execFile);
const app  = express();
const PORT = process.env.PORT || 3001;
const jobs = new Map();

app.use(cors({ origin: '*' }));
app.use(morgan('dev'));
app.use(express.json());

// ── Startup checks ────────────────────────────────────────────────────────────
async function checkTools() {
  for (const tool of ['yt-dlp', 'ffmpeg', 'ffprobe']) {
    try {
      const { stdout } = await execAsync(`${tool} --version 2>&1 || ${tool} -version 2>&1`);
      console.log(`✅ ${tool}: ${stdout.split('\n')[0].trim()}`);
    } catch {
      console.warn(`⚠️  ${tool} no encontrado en PATH`);
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
  if (line.includes('[Merger]') || line.includes('Merging formats')) return { percent: 95, speed: null, eta: '0:05' };
  if (line.includes('[ExtractAudio]') || line.includes('Destination:')) return { percent: 97, speed: null, eta: '0:03' };
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

// ── Detect video codec with ffprobe ──────────────────────────────────────────
async function getVideoCodec(filePath) {
  try {
    const { stdout } = await execAsync(
      `ffprobe -v error -select_streams v:0 -show_entries stream=codec_name -of default=noprint_wrappers=1:nokey=1 "${filePath}"`
    );
    return stdout.trim().toLowerCase(); // e.g. "hevc", "h264", "av1", "vp9"
  } catch {
    return null;
  }
}

// ── Re-encode HEVC/AV1/VP9 → H.264 with ffmpeg ───────────────────────────────
// Returns path to the new H.264 file (replaces original).
async function reencodeToH264(inputPath, onProgress) {
  const ext = inputPath.split('.').pop();
  const outPath = inputPath.replace(`.${ext}`, `_h264.mp4`);

  await new Promise((resolve, reject) => {
    const ff = spawn('ffmpeg', [
      '-i', inputPath,
      '-c:v', 'libx264',
      '-preset', 'fast',     // fast encode, good quality
      '-crf', '23',          // quality factor (18=best, 28=worst, 23=balanced)
      '-c:a', 'aac',
      '-b:a', '192k',
      '-movflags', '+faststart',
      '-y',                  // overwrite output
      outPath,
    ]);

    ff.stderr.on('data', (d) => {
      const line = d.toString();
      // Parse ffmpeg progress: "frame= 123 fps= 30 ... time=00:00:05"
      const t = line.match(/time=(\d+):(\d+):(\d+)/);
      if (t && onProgress) onProgress(t[0]);
    });

    ff.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited with code ${code}`));
    });
    ff.on('error', reject);
  });

  // Delete original, keep H.264 version
  try { unlinkSync(inputPath); } catch {}
  return outPath;
}

// ── Anti-bot bypass args ──────────────────────────────────────────────────────
// KEY FIX: Use "tv" player client for YouTube.
// The Smart TV client bypasses YouTube's datacenter IP bot-checks that
// block "android" and "web" clients since early 2025.
const BYPASS_ARGS = [
  '--extractor-args', 'youtube:player_client=tv,ios',
  '--user-agent', 'Mozilla/5.0 (SMART-TV; Linux; Tizen 5.0) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/2.1 Chrome/56.0.2924.0 TV Safari/537.36',
  '--add-headers', 'Accept-Language:en-US,en;q=0.9',
  '--retries', '4',
  '--fragment-retries', '4',
  '--sleep-requests', '1',
  '--no-check-certificates',
];

// ── H.264 format selector (aggressive) ───────────────────────────────────────
// Tries hard to get H.264. If nothing found, falls back to "best" and
// the re-encode step will convert it to H.264 afterwards.
function buildVideoFormatSelector(height) {
  const h = parseInt(height, 10) || 1080;
  return [
    // Exact H.264 in MP4 container — best case
    `bestvideo[height<=${h}][vcodec^=avc][ext=mp4]+bestaudio[acodec^=mp4a][ext=m4a]`,
    `bestvideo[height<=${h}][vcodec^=avc][ext=mp4]+bestaudio`,
    // H.264 any container
    `bestvideo[height<=${h}][vcodec^=avc]+bestaudio[acodec^=mp4a]`,
    `bestvideo[height<=${h}][vcodec^=avc]+bestaudio`,
    // H.264 in single-stream format
    `best[height<=${h}][vcodec^=avc][ext=mp4]`,
    `best[height<=${h}][vcodec^=avc]`,
    // No HEVC/AV1 — accept VP9 (better than HEVC compatibility-wise)
    `bestvideo[height<=${h}][vcodec!*=hvc1][vcodec!*=hev1][vcodec!*=av01]+bestaudio`,
    // Last resort — any quality, re-encode will fix the codec
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

  const bypassStr = BYPASS_ARGS.map(a => `"${a}"`).join(' ');

  try {
    if (looksLikePlaylist) {
      const { stdout } = await execAsync(
        `yt-dlp --flat-playlist --dump-single-json --no-warnings ${bypassStr} "${safeUrl}"`,
        { timeout: 60000 }
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
      `yt-dlp --no-playlist --dump-json --no-warnings ${bypassStr} "${safeUrl}"`,
      { timeout: 50000 }
    );
    const info    = JSON.parse(stdout);
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
      err.message?.includes('Sign in') || err.message?.includes('bot')
        ? 'YouTube detectó el servidor. Espera unos minutos e intenta de nuevo.'
        : err.message?.includes('Unsupported URL')  ? 'URL no compatible o no encontrada.'
        : err.message?.includes('timeout')          ? 'Tiempo de espera agotado. Intenta de nuevo.'
        : err.message?.includes('Private')          ? 'Este video es privado.'
        : err.message?.includes('Unable to extract')? 'No se pudo extraer el video de esta plataforma.'
        : 'No se pudo analizar el enlace. Verifica que sea válido y público.';
    res.status(500).json({ error: msg });
  }
});

// ── POST /api/jobs — iniciar descarga en background ──────────────────────────
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
      ...BYPASS_ARGS,
      '-f', 'bestaudio/best',
      '-x', '--audio-format', format,
      '--audio-quality', '0',
      '-o', tempTemplate,
      '--no-playlist', '--no-warnings', url,
    ];
  } else {
    args = [
      ...BYPASS_ARGS,
      '-f', buildVideoFormatSelector(quality),
      '--merge-output-format', 'mp4',
      '-o', tempTemplate,
      '--no-playlist', '--no-warnings', url,
    ];
  }

  // Run yt-dlp as child process
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

    // ── Re-encode to H.264 if video is HEVC/AV1/VP9 ──────────────────────
    if (type === 'video' && ['mp4','mkv','webm','mov'].includes(ext)) {
      try {
        const codec = await getVideoCodec(outFile);
        console.log(`[codec check] ${files[0]} → ${codec}`);

        const needsReencode = codec && ['hevc','hev1','hvc1','av1','vp9','vp8'].includes(codec);
        if (needsReencode) {
          console.log(`[re-encode] ${codec} → H.264 ...`);
          job.eta = 'convirtiendo…';
          notifyClients(job);

          outFile = await reencodeToH264(outFile, () => {});
          ext = 'mp4';
          console.log(`[re-encode] ✅ done → ${basename(outFile)}`);
        }
      } catch (encErr) {
        console.error('[re-encode] failed:', encErr.message);
        // Continue with original file even if re-encode failed
      }
    }

    job.filePath = outFile;
    job.ext      = ext;
    job.filename = `${safeTitle}.${ext}`;
    job.progress = 100;
    job.status   = 'done';
    job.eta      = null;

    notifyClients(job);
    job.sseClients.forEach(c => { try { c.end(); } catch {} });
    job.sseClients = [];

    // Auto-delete after 10 minutes
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

// ── GET /api/jobs/:id/progress ────────────────────────────────────────────────
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
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(job.filename || 'video')}`);
    createReadStream(job.filePath).pipe(res);
  } catch {
    res.status(500).json({ error: 'No se pudo leer el archivo.' });
  }
});

app.listen(PORT, () => {
  console.log(`\n🏛️  AztarDL Backend → http://localhost:${PORT}\n`);
});
