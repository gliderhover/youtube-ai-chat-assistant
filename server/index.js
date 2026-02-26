require('dotenv').config();
const express = require('express');
const { spawn, spawnSync } = require('child_process');
const { MongoClient, ObjectId } = require('mongodb');
const bcrypt = require('bcryptjs');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Primary SRV URI (mongodb+srv://...) for Atlas
const SRV_URI =
  process.env.REACT_APP_MONGODB_URI || process.env.MONGODB_URI || process.env.REACT_APP_MONGO_URI || '';
// Optional standard (non-SRV) URI for environments where SRV lookups fail
// e.g. mongodb://user:pass@host1,host2,host3/?replicaSet=...
const STANDARD_URI = process.env.MONGODB_URI_STANDARD || process.env.REACT_APP_MONGODB_URI_STANDARD || '';
const DB = 'chatapp';

let db;

async function connect() {
  // Try SRV URI first (mongodb+srv://)
  if (SRV_URI) {
    console.log('MongoDB: attempting SRV URI from REACT_APP_MONGODB_URI/MONGODB_URI/REACT_APP_MONGO_URI');
    try {
      const client = await MongoClient.connect(SRV_URI);
      db = client.db(DB);
      console.log('MongoDB connected via SRV URI');
      return;
    } catch (err) {
      console.error('MongoDB SRV connection failed:', err.message);
    }
  } else {
    console.log('MongoDB: no SRV URI configured (REACT_APP_MONGODB_URI / MONGODB_URI / REACT_APP_MONGO_URI)');
  }

  // Fallback: standard (non-SRV) URI if provided
  if (STANDARD_URI) {
    console.log('MongoDB: attempting fallback via standard URI from MONGODB_URI_STANDARD/REACT_APP_MONGODB_URI_STANDARD');
    try {
      const client = await MongoClient.connect(STANDARD_URI);
      db = client.db(DB);
      console.log('MongoDB connected via standard URI');
      return;
    } catch (err) {
      console.error('MongoDB standard URI connection failed:', err.message);
    }
  } else {
    console.log('MongoDB: no standard URI configured (MONGODB_URI_STANDARD / REACT_APP_MONGODB_URI_STANDARD)');
  }

  console.error('MongoDB unavailable. All configured connection attempts failed.');
}

app.get('/', (req, res) => {
  res.send(`
    <html>
      <body style="font-family:sans-serif;padding:2rem;background:#00356b;color:white;min-height:100vh;display:flex;align-items:center;justify-content:center;margin:0">
        <div style="text-align:center">
          <h1>Chat API Server</h1>
          <p>Backend is running. Use the React app at <a href="http://localhost:3000" style="color:#ffd700">localhost:3000</a></p>
          <p><a href="/api/status" style="color:#ffd700">Check DB status</a></p>
        </div>
      </body>
    </html>
  `);
});

app.get('/api/status', async (req, res) => {
  try {
    const usersCount = await db.collection('users').countDocuments();
    const sessionsCount = await db.collection('sessions').countDocuments();
    res.json({ usersCount, sessionsCount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── YouTube (register early so route exists even if DB not ready) ──────────────

let youtubeJob;
try {
  youtubeJob = require('./youtubeJob');
} catch (e) {
  console.warn('YouTube job module not loaded:', e.message);
  youtubeJob = null;
}

// At startup once: resolve yt-dlp path for debug endpoint
let whichYtdlp = '';
try {
  const whichCmd = process.platform === 'win32' ? 'where' : 'which';
  const whichRes = spawnSync(whichCmd, ['yt-dlp'], { encoding: 'utf8' });
  whichYtdlp = (whichRes.stdout || '').trim() || (whichRes.stderr || '').trim() || '';
  console.log('yt-dlp path (where/which):', whichYtdlp || '(not found)');
} catch (e) {
  console.log('yt-dlp path check failed:', e.message);
}

app.get('/api/youtube', (req, res) => res.json({ ok: true, message: 'YouTube routes loaded' }));

app.post('/api/youtube/start', (req, res) => {
  try {
    if (!youtubeJob) return res.status(503).json({ error: 'YouTube download not available' });
    const { channelUrl, maxVideos: rawMax } = req.body || {};
    if (!channelUrl || typeof channelUrl !== 'string' || !channelUrl.trim()) {
      return res.status(400).json({ error: 'channelUrl is required' });
    }
    const maxVideos = Math.min(100, Math.max(1, parseInt(rawMax, 10) || 10));
    // No API key required: YouTube download uses local yt-dlp
    const jobId = youtubeJob.createJob(channelUrl.trim(), maxVideos);
    res.json({ jobId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/youtube/progress', (req, res) => {
  if (!youtubeJob) return res.status(503).json({ error: 'YouTube download not available' });
  const { jobId } = req.query;
  if (!jobId) return res.status(400).json({ error: 'jobId required' });
  const progress = youtubeJob.getProgress(jobId);
  if (!progress) return res.status(404).json({ error: 'Job not found' });
  const percent = progress.total ? Math.round((100 * progress.done) / progress.total) : 0;
  res.json({ done: progress.done, total: progress.total, status: progress.status, percent });
});

app.get('/api/youtube/result', (req, res) => {
  if (!youtubeJob) return res.status(503).json({ error: 'YouTube download not available' });
  const { jobId } = req.query;
  if (!jobId) return res.status(400).json({ error: 'jobId required' });
  const result = youtubeJob.getResult(jobId);
  if (!result) return res.status(404).json({ error: 'Job not found or not complete' });
  if (!result.success) return res.status(500).json({ error: result.error });
  res.json(result.data);
});

// Temporary debug: prove per-video yt-dlp works from Node (spawn, not exec)
app.get('/api/youtube/debug-one', (req, res) => {
  const url = req.query.url;
  if (!url || typeof url !== 'string' || !url.trim()) {
    return res.status(400).json({ error: 'url query param required' });
  }
  const proc = spawn('yt-dlp', ['-J', url.trim()]);
  let stdout = '';
  let stderr = '';
  const limit = 2000;
  proc.stdout.on('data', (chunk) => {
    if (stdout.length < limit) stdout += chunk.toString();
  });
  proc.stderr.on('data', (chunk) => {
    if (stderr.length < limit) stderr += chunk.toString();
  });
  proc.on('error', (err) => {
    res.json({
      ok: false,
      exitCode: null,
      stdoutPreview: stdout.slice(0, limit),
      stderrPreview: (stderr || err.message).slice(0, limit),
      whichYtdlp,
      nodeVersion: process.version,
    });
  });
  proc.on('close', (code) => {
    res.json({
      ok: code === 0,
      exitCode: code,
      stdoutPreview: stdout.slice(0, limit),
      stderrPreview: stderr.slice(0, limit),
      whichYtdlp,
      nodeVersion: process.version,
    });
  });
});

// ── Users ────────────────────────────────────────────────────────────────────

app.use((req, res, next) => {
  if (db) return next();
  if (['/api/users', '/api/sessions', '/api/messages'].some((p) => req.path.startsWith(p))) {
    return res.status(503).json({ error: 'Database unavailable' });
  }
  next();
});

app.post('/api/users', async (req, res) => {
  try {
    const { username, password, email, firstName, lastName } = req.body;
    if (!username || !password)
      return res.status(400).json({ error: 'Username and password required' });
    const name = String(username).trim().toLowerCase();
    const safeFirst = firstName !== undefined ? String(firstName).trim() : '';
    const safeLast = lastName !== undefined ? String(lastName).trim() : '';
    if (!safeFirst || !safeLast) {
      return res.status(400).json({ error: 'First name and last name are required' });
    }
    const existing = await db.collection('users').findOne({ username: name });
    if (existing) return res.status(400).json({ error: 'Username already exists' });
    const hashed = await bcrypt.hash(password, 10);
    await db.collection('users').insertOne({
      username: name,
      password: hashed,
      email: email ? String(email).trim().toLowerCase() : null,
      firstName: safeFirst,
      lastName: safeLast,
      createdAt: new Date().toISOString(),
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/users/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password)
      return res.status(400).json({ error: 'Username and password required' });
    const name = username.trim().toLowerCase();
    const user = await db.collection('users').findOne({ username: name });
    if (!user) return res.status(401).json({ error: 'User not found' });
    const ok = await bcrypt.compare(password, user.password);
    if (!ok) return res.status(401).json({ error: 'Invalid password' });
    res.json({
      ok: true,
      username: name,
      firstName: user.firstName || null,
      lastName: user.lastName || null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Sessions ─────────────────────────────────────────────────────────────────

app.get('/api/sessions', async (req, res) => {
  try {
    const { username } = req.query;
    if (!username) return res.status(400).json({ error: 'username required' });
    const sessions = await db
      .collection('sessions')
      .find({ username })
      .sort({ createdAt: -1 })
      .toArray();
    res.json(
      sessions.map((s) => ({
        id: s._id.toString(),
        agent: s.agent || null,
        title: s.title || null,
        createdAt: s.createdAt,
        messageCount: (s.messages || []).length,
      }))
    );
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/sessions', async (req, res) => {
  try {
    const { username, agent } = req.body;
    if (!username) return res.status(400).json({ error: 'username required' });
    const { title } = req.body;
    const result = await db.collection('sessions').insertOne({
      username,
      agent: agent || null,
      title: title || null,
      createdAt: new Date().toISOString(),
      messages: [],
    });
    res.json({ id: result.insertedId.toString() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/sessions/:id', async (req, res) => {
  try {
    await db.collection('sessions').deleteOne({ _id: new ObjectId(req.params.id) });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/sessions/:id/title', async (req, res) => {
  try {
    const { title } = req.body;
    await db.collection('sessions').updateOne(
      { _id: new ObjectId(req.params.id) },
      { $set: { title } }
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Messages ─────────────────────────────────────────────────────────────────

app.post('/api/messages', async (req, res) => {
  try {
    const { session_id, role, content, imageData, charts, toolCalls } = req.body;
    if (!session_id || !role || content === undefined)
      return res.status(400).json({ error: 'session_id, role, content required' });
    const msg = {
      role,
      content,
      timestamp: new Date().toISOString(),
      ...(imageData && {
        imageData: Array.isArray(imageData) ? imageData : [imageData],
      }),
      ...(charts?.length && { charts }),
      ...(toolCalls?.length && { toolCalls }),
    };
    await db.collection('sessions').updateOne(
      { _id: new ObjectId(session_id) },
      { $push: { messages: msg } }
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/messages', async (req, res) => {
  try {
    const { session_id } = req.query;
    if (!session_id) return res.status(400).json({ error: 'session_id required' });
    const doc = await db
      .collection('sessions')
      .findOne({ _id: new ObjectId(session_id) });
    const raw = doc?.messages || [];
    const msgs = raw.map((m, i) => {
      const arr = m.imageData
        ? Array.isArray(m.imageData)
          ? m.imageData
          : [m.imageData]
        : [];
      return {
        id: `${doc._id}-${i}`,
        role: m.role,
        content: m.content,
        timestamp: m.timestamp,
        images: arr.length
          ? arr.map((img) => ({ data: img.data, mimeType: img.mimeType }))
          : undefined,
        charts: m.charts?.length ? m.charts : undefined,
        toolCalls: m.toolCalls?.length ? m.toolCalls : undefined,
      };
    });
    res.json(msgs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3001;

// Start server even if MongoDB fails so YouTube and root routes still work
app.listen(PORT, () => {
  console.log(`Server on http://localhost:${PORT}`);
  connect().catch((err) => {
    // connect() already logs detailed errors; this is just a final guard.
    console.error('MongoDB connection attempt threw unexpectedly:', err.message);
  });
});
