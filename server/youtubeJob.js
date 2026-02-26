/**
 * YouTube channel data download job using yt-dlp.
 * - No YouTube Data API key required.
 * - Uses local yt-dlp executable to list channel videos and fetch metadata.
 * - Attempts to fetch English subtitles/auto-subs and converts them to plain text.
 */
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const jobs = new Map();

let cachedJsRuntimeArgs = null;
let loggedJsRuntime = false;

// WinGet Deno path (absolute; avoids relying on Windows PATH / setx truncation)
const DENO_WINGET_PATH_WIN =
  'C:\\Users\\glide\\AppData\\Local\\Microsoft\\WinGet\\Packages\\DenoLand.Deno_Microsoft.Winget.Source_8wekyb3d8bbwe\\deno.exe';

/** Returns [] if no runtime found; js runtime is not required for yt-dlp -J to work. */
function getJsRuntimesArgs() {
  if (cachedJsRuntimeArgs !== null) return cachedJsRuntimeArgs;

  const denoExe = path.resolve(DENO_WINGET_PATH_WIN);
  if (process.platform === 'win32' && fs.existsSync(denoExe)) {
    cachedJsRuntimeArgs = ['--js-runtimes', `deno:${denoExe}`];
    if (!loggedJsRuntime) {
      console.log('yt-dlp js runtime: deno (optional)');
      loggedJsRuntime = true;
    }
    return cachedJsRuntimeArgs;
  }

  cachedJsRuntimeArgs = [];
  if (!loggedJsRuntime) {
    console.log('yt-dlp js runtime: none (optional)');
    loggedJsRuntime = true;
  }
  return cachedJsRuntimeArgs;
}

function ensureYtDlpAvailable() {
  getJsRuntimesArgs(); // ensure Node path is resolved and logged
  const res = spawnSync('yt-dlp', ['--version'], { encoding: 'utf8' });
  if (res.error || res.status !== 0) {
    throw new Error(
      'yt-dlp is not installed or not found in PATH. On Windows, run "winget install yt-dlp.yt-dlp". On macOS, use Homebrew: "brew install yt-dlp". Then ensure the "yt-dlp" command works in a terminal.'
    );
  }
}

function runYtDlp(args, options = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn('yt-dlp', args, options);
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    proc.on('error', (err) => reject(err));
    proc.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

/** Normalize channel URL for playlist listing: @handle -> @handle/videos */
function normalizeChannelUrlForListing(channelUrl) {
  const s = (channelUrl || '').trim();
  // https://www.youtube.com/@handle (no /videos) -> add /videos for listing
  if (/youtube\.com\/@[^/]+\/?$/i.test(s)) {
    return s.replace(/\/?$/, '/videos');
  }
  return s;
}

/** List up to candidateLimit video URLs from channel/playlist (flat-playlist). */
async function listChannelVideoUrls(channelUrl, candidateLimit) {
  const limit = Math.min(200, Math.max(1, parseInt(candidateLimit, 10) || 50));
  const args = [
    ...getJsRuntimesArgs(),
    '--no-warnings',
    '-J',
    '--flat-playlist',
    '--playlist-end',
    String(limit),
    channelUrl,
  ];
  const { code, stdout, stderr } = await runYtDlp(args);
  if (code !== 0) {
    throw new Error(
      `yt-dlp failed while listing channel videos. Exit code ${code}. ${stderr || stdout || ''}`.trim()
    );
  }
  let data;
  try {
    data = JSON.parse(stdout);
  } catch (e) {
    throw new Error(`Failed to parse yt-dlp playlist JSON: ${e.message}`);
  }
  const entries = Array.isArray(data.entries) ? data.entries : [];
  const urls = entries
    .slice(0, limit)
    .map((e) => e.url || (e.id ? `https://www.youtube.com/watch?v=${e.id}` : null))
    .filter(Boolean);
  return urls;
}

function toReleaseDate(info) {
  // Prefer upload_date in YYYYMMDD from yt-dlp
  if (info.upload_date && /^\d{8}$/.test(info.upload_date)) {
    const d = info.upload_date;
    return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
  }
  // Fallback to timestamp (seconds since epoch)
  if (info.timestamp) {
    try {
      // Always return YYYY-MM-DD
      return new Date(info.timestamp * 1000).toISOString().slice(0, 10);
    } catch {
      return '';
    }
  }
  return '';
}

function parseVttToText(vtt) {
  const lines = vtt.split(/\r?\n/);
  const out = [];
  const tsRe = /^(\d{2}:)?\d{2}:\d{2}\.\d{3}\s+-->\s+(\d{2}:)?\d{2}:\d{2}\.\d{3}/;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed === 'WEBVTT') continue;
    if (tsRe.test(trimmed)) continue;
    if (/^\d+$/.test(trimmed)) continue;
    out.push(trimmed);
  }
  return out.join(' ').trim();
}

async function readTranscriptFromDir(dir) {
  try {
    const files = await fs.promises.readdir(dir);
    const vtts = files.filter((f) => f.toLowerCase().endsWith('.vtt'));
    if (!vtts.length) return '';
    const vttPath = path.join(dir, vtts[0]);
    const raw = await fs.promises.readFile(vttPath, 'utf8');
    return parseVttToText(raw);
  } catch {
    return '';
  }
}

function mapVideoInfo(info, transcript, videoUrlOverride) {
  const videoUrl = videoUrlOverride || info.webpage_url || (info.id ? `https://www.youtube.com/watch?v=${info.id}` : '');
  const thumb =
    info.thumbnail ||
    (Array.isArray(info.thumbnails) && info.thumbnails.length ? info.thumbnails[0].url || info.thumbnails[0] : '');
  return {
    title: info.title || '',
    description: info.description || '',
    transcript: transcript || '',
    duration: typeof info.duration === 'number' ? info.duration : 0,
    release_date: toReleaseDate(info),
    view_count: typeof info.view_count === 'number' ? info.view_count : 0,
    like_count: typeof info.like_count === 'number' ? info.like_count : 0,
    comment_count: typeof info.comment_count === 'number' ? info.comment_count : 0,
    video_url: videoUrl,
    thumbnail_url: thumb || '',
  };
}

function stderrIndicatesSkip(stderr) {
  const s = (stderr || '').toLowerCase();
  return (
    s.includes('unavailable') ||
    s.includes('private video') ||
    s.includes('members-only') ||
    s.includes('sign in to confirm your age') ||
    s.includes('sign-in') ||
    s.includes('age-restricted')
  );
}

/** Step A: metadata only (yt-dlp -J). Do not treat stderr as fatal; fail only if exit !== 0 or stdout not valid JSON. */
async function fetchVideoMetadata(videoUrl) {
  const args = ['-J', videoUrl];
  const { code, stdout, stderr } = await runYtDlp(args);
  if (code !== 0) {
    return { ok: false, skipQuiet: stderrIndicatesSkip(stderr), stderr };
  }
  const raw = (stdout || '').trim();
  if (!raw) return { ok: false, skipQuiet: false, stderr };
  let info;
  try {
    info = JSON.parse(raw);
  } catch {
    return { ok: false, skipQuiet: false, stderr };
  }
  return { ok: true, info };
}

/** Step B: best-effort transcript. On failure, return "" and do not fail the video. */
async function fetchTranscript(videoUrl, outDir) {
  const outTemplate = path.join(outDir, '%(id)s.%(ext)s');
  const args = [
    '--skip-download',
    '--write-auto-subs',
    '--write-subs',
    '--sub-langs',
    'en.*,en',
    '--sub-format',
    'vtt',
    '-o',
    outTemplate,
    videoUrl,
  ];
  const { code } = await runYtDlp(args);
  if (code !== 0) return '';
  return readTranscriptFromDir(outDir);
}

/** Two-step: metadata (must succeed for most), then transcript (best effort). Skip logic: unavailable/private/age -> null; else log and skip. */
async function fetchVideoWithTranscript(videoUrl, jobTmpRoot) {
  const meta = await fetchVideoMetadata(videoUrl);
  if (!meta.ok) {
    if (meta.skipQuiet) return null;
    console.error('yt-dlp metadata failed for video:', videoUrl, (meta.stderr || '').slice(0, 200));
    return null;
  }
  const videoTmpDir = await fs.promises.mkdtemp(path.join(jobTmpRoot, 'v-'));
  let transcript = '';
  try {
    transcript = await fetchTranscript(videoUrl, videoTmpDir);
  } catch (e) {
    console.warn('Transcript fetch failed for', videoUrl, e.message);
  } finally {
    await fs.promises.rm(videoTmpDir, { recursive: true, force: true }).catch(() => {});
  }
  return mapVideoInfo(meta.info, transcript, videoUrl);
}

function runJob(jobId, channelUrl, maxVideos) {
  const job = jobs.get(jobId);
  if (!job) return;

  const maxV = Math.min(100, Math.max(1, parseInt(maxVideos, 10) || 10));
  const candidateLimit = Math.min(maxV * 5, 200);
  job.maxVideos = maxV;

  (async () => {
    let jobTmpRoot;
    try {
      ensureYtDlpAvailable();
      job.status = 'listing';
      const listingUrl = normalizeChannelUrlForListing(channelUrl);
      const candidates = await listChannelVideoUrls(listingUrl, candidateLimit);
      job.total = candidates.length; // total candidates to attempt
      job.status = 'downloading';
      job.done = 0;
      job.successCount = 0;

      jobTmpRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'yt-job-'));
      const results = [];
      for (let i = 0; i < candidates.length && results.length < maxV; i++) {
        const url = candidates[i];
        try {
          const data = await fetchVideoWithTranscript(url, jobTmpRoot);
          if (data) {
            results.push(data);
            job.successCount = results.length;
          }
        } catch (e) {
          console.error('Error fetching video metadata via yt-dlp:', e.message);
        }
        job.done = i + 1;
      }

      if (results.length === 0) {
        job.status = 'error';
        job.error =
          '0 videos extracted. Per-video yt-dlp extraction failed. Check js runtime/cookies/availability.';
      } else {
        job.status = 'complete';
        job.result = {
          channelUrl,
          fetched_at: new Date().toISOString(),
          video_count: results.length,
          videos: results,
        };
      }
    } catch (err) {
      job.status = 'error';
      job.error = err.message;
    } finally {
      if (jobTmpRoot) {
        await fs.promises.rm(jobTmpRoot, { recursive: true, force: true }).catch(() => {});
      }
    }
  })();
}

function createJob(channelUrl, maxVideos) {
  const jobId = `yt_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  const job = {
    jobId,
    done: 0,
    total: 0,
    status: 'starting',
    result: null,
    error: null,
    successCount: 0,
    maxVideos: Math.min(100, Math.max(1, parseInt(maxVideos, 10) || 10)),
  };
  jobs.set(jobId, job);
  setImmediate(() => runJob(jobId, channelUrl, maxVideos));
  return jobId;
}

function getProgress(jobId) {
  const job = jobs.get(jobId);
  if (!job) return null;
  return {
    done: job.done,
    total: job.total,
    status: job.status,
    successCount: job.successCount || 0,
    maxVideos: job.maxVideos ?? 0,
    error: job.error || null,
  };
}

function getResult(jobId) {
  const job = jobs.get(jobId);
  if (!job) return null;
  if (job.status === 'error') return { success: false, error: job.error };
  if (job.status !== 'complete') return null;
  return { success: true, data: job.result };
}

module.exports = { createJob, getProgress, getResult };
