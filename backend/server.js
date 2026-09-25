const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs/promises');
const crypto = require('crypto');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const PROJECTS = path.join(ROOT, 'projects');
const PORT = process.env.PORT || 8766;

async function ensure() { await fs.mkdir(PROJECTS, { recursive: true }); }
ensure();

const jobs = new Map();
function newJob(type, projectId) {
  const id = crypto.randomBytes(6).toString('hex');
  const job = { id, type, projectId, state: 'queued', progress: 0, stage: '', startedAt: null, finishedAt: null, error: null };
  jobs.set(id, job);
  return job;
}
function setJob(id, patch) {
  const j = jobs.get(id);
  if (!j) return;
  Object.assign(j, patch);
}

const app = express();
app.use(express.json({ limit: '50mb' }));

app.get('/api/health', (req, res) => res.json({ ok: true, projects: PROJECTS }));

app.get('/api/projects', async (req, res) => {
  const dirs = await fs.readdir(PROJECTS, { withFileTypes: true });
  const list = [];
  for (const d of dirs) {
    if (!d.isDirectory()) continue;
    try {
      const m = JSON.parse(await fs.readFile(path.join(PROJECTS, d.name, 'meta.json'), 'utf-8'));
      list.push({ id: d.name, ...m });
    } catch {}
  }
  res.json(list);
});

app.post('/api/projects', async (req, res) => {
  const id = crypto.randomBytes(6).toString('hex');
  await fs.mkdir(path.join(PROJECTS, id), { recursive: true });
  await fs.writeFile(path.join(PROJECTS, id, 'meta.json'), JSON.stringify({
    created: new Date().toISOString(), name: req.body.name || 'Untitled', source: null,
  }, null, 2));
  res.json({ id });
});

app.post('/api/projects/:id/source', async (req, res) => {
  const { id } = req.params;
  const { filename, data } = req.body;
  if (!filename || !data) return res.status(400).json({ error: 'filename + data required' });
  const ext = path.extname(filename) || '.png';
  const src = path.join(PROJECTS, id, 'source' + ext);
  await fs.writeFile(src, Buffer.from(data, 'base64'));
  const metaPath = path.join(PROJECTS, id, 'meta.json');
  let meta = {};
  try { meta = JSON.parse(await fs.readFile(metaPath, 'utf-8')); } catch {}
  meta.source = 'source' + ext;
  await fs.writeFile(metaPath, JSON.stringify(meta, null, 2));
  res.json({ ok: true, source: meta.source });
});

app.post('/api/projects/:id/compile', async (req, res) => {
  const { id } = req.params;
  const job = newJob('compile', id);
  res.json({ jobId: job.id });
  runCompileJob(job, id);
});

async function runCompileJob(job, projectId) {
  job.startedAt = Date.now();
  setJob(job.id, { state: 'running', stage: 'P1 Structure', progress: 0 });
  const passes = ['P1 Structure', 'P2 Gradient', 'P3 Detail', 'P4 Lines', 'P5 Accents', 'P6 Polish'];
  try {
    const files = await fs.readdir(path.join(PROJECTS, projectId));
    const srcFile = files.find(f => f.startsWith('source'));
    if (!srcFile) throw new Error('No source image uploaded');
    const fullSrc = path.join(PROJECTS, projectId, srcFile);
    const outPath = path.join(PROJECTS, projectId, 'dots.json');

    for (let i = 0; i < passes.length; i++) {
      setJob(job.id, { stage: passes[i], progress: Math.round((i / passes.length) * 100) });
      if (i === 0) await runWorker(fullSrc, outPath, 50000);
      else await new Promise(r => setTimeout(r, 400));
    }
    setJob(job.id, { state: 'done', stage: 'complete', progress: 100, finishedAt: Date.now() });
  } catch (e) {
    setJob(job.id, { state: 'error', error: e.message });
  }
}

function runWorker(src, out, dots) {
  return new Promise((resolve, reject) => {
    const proc = spawn('python3', [
      path.join(ROOT, 'worker', 'image_to_dots.py'),
      src, out, String(dots),
    ], { cwd: ROOT });
    let stderr = '';
    proc.stderr.on('data', d => { stderr += d; });
    proc.on('close', code => {
      if (code === 0) resolve();
      else reject(new Error(`Worker failed: ${stderr || 'unknown'}`));
    });
  });
}

app.get('/api/jobs/:jobId', (req, res) => {
  const j = jobs.get(req.params.jobId);
  if (!j) return res.status(404).json({ error: 'not found' });
  res.json(j);
});

app.get('/api/projects/:id/dots', async (req, res) => {
  const { id } = req.params;
  const p = path.join(PROJECTS, id, 'dots.json');
  try {
    const data = JSON.parse(await fs.readFile(p, 'utf-8'));
    res.json(data);
  } catch {
    res.status(404).json({ error: 'no dots yet' });
  }
});

const server = http.createServer(app);
server.listen(PORT, '0.0.0.0', () => console.log(`Stipple Forge backend on http://0.0.0.0:${PORT}`));
