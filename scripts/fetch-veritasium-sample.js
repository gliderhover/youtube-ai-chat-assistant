/**
 * Regenerate public/veritasium_channel_data_10.json
 * Uses local yt-dlp (no YouTube Data API key needed).
 * Run from project root: node scripts/fetch-veritasium-sample.js
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const fs = require('fs');
const path = require('path');
const youtubeJob = require('../server/youtubeJob');

const CHANNEL_URL = 'https://www.youtube.com/@veritasium';
const MAX_VIDEOS = 10;
const OUT_PATH = path.resolve(__dirname, '../public/veritasium_channel_data_10.json');

async function main() {
  const jobId = youtubeJob.createJob(CHANNEL_URL, MAX_VIDEOS);
  console.log('Job started:', jobId);
  while (true) {
    await new Promise((r) => setTimeout(r, 1000));
    const p = youtubeJob.getProgress(jobId);
    if (!p) {
      console.error('Job not found');
      process.exit(1);
    }
    console.log(`${p.done} / ${p.total} - ${p.status}`);
    if (p.status === 'complete') break;
    if (p.status === 'error') {
      console.error('Error:', p.error);
      process.exit(1);
    }
  }
  const result = youtubeJob.getResult(jobId);
  if (!result || !result.success) {
    console.error('No result');
    process.exit(1);
  }
  fs.writeFileSync(OUT_PATH, JSON.stringify(result.data, null, 2), 'utf8');
  console.log('Written to', OUT_PATH);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
