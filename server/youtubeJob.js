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

function ensureYtDlpAvailable() {
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

async function listChannelVideoUrls(channelUrl, maxVideos) {
  const safeMax = Math.min(100, Math.max(1, parseInt(maxVideos, 10) || 10));
  const args = ['-J', '--flat-playlist', '--playlist-end', String(safeMax), channelUrl];
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
    .slice(0, safeMax)
    .map((e) => e.url || (e.id ? `https://www.youtube.com/watch?v=${e.id}` : null))
    .filter(Boolean);
  return urls;
}

function parseVttToText(vtt) {
  const lines = vtt.split(/\r?\n/);
  const out = [];
  const tsRe =
    /^(\d{2}:)?\d{2}:\d{2}\.\d{3}\s+-->\s+(\d{2}:)?\d{2}:\d{2}\.\d{3}/;
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

function toReleaseDate(info) {
  if (info.upload_date && /^\d{8}$/.test(info.upload_date)) {
    const d = info.upload_date;
    return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
  }
  if (info.timestamp) {
    try {
      return new Date(info.timestamp * 1000).toISOString();
    } catch {
      return '';
    }
  }
  return '';
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

async function fetchVideoWithTranscript(videoUrl, jobTmpRoot) {
  const videoTmpDir = await fs.promises.mkdtemp(path.join(jobTmpRoot, 'v-'));
  const outTemplate = path.join(videoTmpDir, '%(id)s.%(ext)s');
  const args = [
    '-J',
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
  try {
    const { code, stdout, stderr } = await runYtDlp(args);
    if (code !== 0) {
      throw new Error(
        `yt-dlp failed for video ${videoUrl}. Exit code ${code}. ${stderr || stdout || ''}`.trim()
      );
    }
    const jsonLine = stdout
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .pop();
    if (!jsonLine) {
      throw new Error('yt-dlp returned no JSON metadata');
    }
    let info;
    try {
      info = JSON.parse(jsonLine);
    } catch (e) {
      throw new Error(`Failed to parse yt-dlp video JSON: ${e.message}`);
    }
    const transcript = await readTranscriptFromDir(videoTmpDir);
    return mapVideoInfo(info, transcript, videoUrl);
  } finally {
    await fs.promises.rm(videoTmpDir, { recursive: true, force: true });
  }
}

function runJob(jobId, channelUrl, maxVideos) {
  const job = jobs.get(jobId);
  if (!job) return;

  (async () => {
    let jobTmpRoot;
    try {
      ensureYtDlpAvailable();
      job.status = 'listing';
      const urls = await listChannelVideoUrls(channelUrl, maxVideos);
      job.total = urls.length;
      job.status = 'downloading';
      job.done = 0;

      jobTmpRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'yt-job-'));
      const results = [];
      for (let i = 0; i < urls.length; i++) {
        const url = urls[i];
        try {
          const data = await fetchVideoWithTranscript(url, jobTmpRoot);
          results.push(data);
        } catch (e) {
          // Fail the whole job on hard errors from yt-dlp; transcripts are already optional.
          throw e;
        }
        job.done = i + 1;
      }
      job.status = 'complete';
      job.result = { videos: results, channelUrl, maxVideos };
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
  const job = { jobId, done: 0, total: 0, status: 'starting', result: null, error: null };
  jobs.set(jobId, job);
  setImmediate(() => runJob(jobId, channelUrl, maxVideos));
  return jobId;
}

function getProgress(jobId) {
  const job = jobs.get(jobId);
  if (!job) return null;
  return { done: job.done, total: job.total, status: job.status, error: job.error || null };
}

function getResult(jobId) {
  const job = jobs.get(jobId);
  if (!job) return null;
  if (job.status === 'error') return { success: false, error: job.error };
  if (job.status !== 'complete') return null;
  return { success: true, data: job.result };
}

module.exports = { createJob, getProgress, getResult };
