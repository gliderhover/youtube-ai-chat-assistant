require('dotenv').config();
const express = require('express');
const { MongoClient, ObjectId } = require('mongodb');
const bcrypt = require('bcryptjs');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

const URI = process.env.REACT_APP_MONGODB_URI || process.env.MONGODB_URI || process.env.REACT_APP_MONGO_URI;
const DB = 'chatapp';

let db;

async function connect() {
  const client = await MongoClient.connect(URI);
  db = client.db(DB);
  console.log('MongoDB connected');
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
  res.json({ done: progress.done, total: progress.total, status: progress.status, percent, error: progress.error || null });
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

// ── Users ────────────────────────────────────────────────────────────────────

app.use((req, res, next) => {
  if (db) return next();
  if (['/api/users', '/api/sessions', '/api/messages'].some((p) => req.path.startsWith(p))) {
    return res.status(503).json({ error: 'Database not connected' });
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
  connect()
    .then(() => console.log('MongoDB connected'))
    .catch((err) => console.error('MongoDB connection failed:', err.message));
});
