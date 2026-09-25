import React, { useState, useEffect, useCallback, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import DotPreview3D from './DotPreview3D.jsx';

const API = '';

function useProjects() {
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(async () => {
    setLoading(true);
    try { const r = await fetch(`${API}/api/projects`); setProjects(await r.json()); } catch {}
    setLoading(false);
  }, []);
  useEffect(() => { refresh(); }, [refresh]);
  const createProject = async (name) => { const r = await fetch(`${API}/api/projects`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) }); const p = await r.json(); refresh(); return p; };
  const uploadSource = async (id, file) => { const buf = await file.arrayBuffer(); let b = ''; const u = new Uint8Array(buf); for (let i = 0; i < u.length; i++) b += String.fromCharCode(u[i]); await fetch(`${API}/api/projects/${id}/source`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ filename: file.name, data: btoa(b) }) }); refresh(); };
  const deleteProject = async (id) => { if (!confirm('Delete this project?')) return; await fetch(`${API}/api/projects/${id}`, { method: 'DELETE' }); refresh(); };
  const startCompile = async (id, dotDensity = 50000) => { const r = await fetch(`${API}/api/projects/${id}/compile`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dotDensity }) }); return (await r.json()).jobId; };
  const getDots = async (id) => { const r = await fetch(`${API}/api/projects/${id}/dots`); return r.ok ? await r.json() : null; };
  return { projects, loading, refresh, createProject, uploadSource, deleteProject, startCompile, getDots };
}

function DotPreview({ dots, width, height }) {
  const canvasRef = useRef(null);
  useEffect(() => {
    if (!dots || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#0e1116';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Find bounds
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const d of dots) { if (d[0] < minX) minX = d[0]; if (d[0] > maxX) maxX = d[0]; if (d[1] < minZ) minZ = d[1]; if (d[1] > maxZ) maxZ = d[1]; }
    const rangeX = maxX - minX || 1;
    const rangeZ = maxZ - minZ || 1;
    const scale = Math.min((canvas.width - 40) / rangeX, (canvas.height - 40) / rangeZ);
    const offX = (canvas.width - rangeX * scale) / 2;
    const offY = (canvas.height - rangeZ * scale) / 2;

    // Draw dots
    for (const d of dots) {
      const x = offX + (d[0] - minX) * scale;
      const y = offY + (d[1] - minZ) * scale;
      const r = d[2], g = d[3], b = d[4];
      ctx.fillStyle = `rgb(${Math.round(r*255)},${Math.round(g*255)},${Math.round(b*255)})`;
      ctx.beginPath();
      ctx.arc(x, y, Math.max(0.5, d[5] * 0.6), 0, Math.PI * 2);
      ctx.fill();
    }
  }, [dots, width, height]);

  return <canvas ref={canvasRef} width={600} height={400} style={{ width: '100%', height: 'auto', border: '1px solid var(--line)' }} />;
}

// Preset model configs
const PRESETS = [
  { label: 'OpenRouter (free)', endpoint: 'https://openrouter.ai/api/v1', model: 'mistralai/mixtral-8x7b-instruct', free: true, desc: 'Free tier, diverse models' },
  { label: 'Nous (free)', endpoint: 'https://api.nous.xyz/v1', model: 'inclusionai/ling-3.0-flash-sante', free: true, desc: 'Ling flash, fast and capable' },
  { label: 'Gemini', endpoint: 'https://generativelanguage.googleapis.com/v1', model: 'gemini-2.0-flash', free: true, desc: 'Google, free tier' },
  { label: 'Ollama (local)', endpoint: 'http://localhost:11434/v1', model: 'llama3.1', free: true, desc: 'Local, no API key needed' },
  { label: 'Mistral', endpoint: 'https://api.mistral.ai/v1', model: 'mistral-small-latest', free: false, desc: 'Paid, high quality' },
  { label: 'Groq', endpoint: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile', free: false, desc: 'Fast inference' },
  { label: 'Anthropic', endpoint: 'https://api.anthropic.com/v1', model: 'claude-3-5-sonnet-20241022', free: false, desc: 'Claude 3.5 Sonnet' },
  { label: 'Silicon Flow', endpoint: 'https://api.siliconflow.cn/v1', model: 'meta-llama/llama-3.1-8b-instruct', free: false, desc: 'SiliconFlow API' },
  { label: 'Cloudflare', endpoint: 'https://api.cloudflare.com/client/v4', model: '@cf/meta/llama-3.1-8b-instruct', free: false, desc: 'Cloudflare Workers AI' },
  { label: 'Moonshot (Kimi)', endpoint: 'https://api.moonshot.cn/v1', model: 'moonshotai/kimi-k2-instruct', free: false, desc: 'Kimi K2' },
  { label: 'Tavily', endpoint: 'https://api.tavily.com/v1', model: 'tavily-research', free: false, desc: 'Tavily research' },
];

const DOT_PRESETS = [
  { label: 'Draft', dots: 10000, desc: 'Fast preview, low detail' },
  { label: 'Standard', dots: 50000, desc: 'Balanced detail and speed' },
  { label: 'High', dots: 200000, desc: 'Detailed, slower' },
  { label: 'Ultra', dots: 500000, desc: 'Near-photographic' },
  { label: 'Max', dots: 1000000, desc: 'Maximum detail, slow' },
];

function SettingsPanel({ settings, onSave, onClose }) {
  const [models, setModels] = useState(settings?.models || []);
  const [selectedId, setSelectedId] = useState(settings?.selectedModelId || null);
  const [newModel, setNewModel] = useState({ label: '', endpoint: '', apiKey: '', model: '' });
  const [testing, setTesting] = useState(null);
  const [testResult, setTestResult] = useState(null);
  const [activeTab, setActiveTab] = useState('presets');

  const addPreset = (preset) => {
    const m = { ...preset, id: Date.now(), apiKey: '' };
    setModels([...models, m]);
    if (!selectedId) setSelectedId(m.id);
  };
  const removeModel = (id) => {
    setModels(models.filter(m => m.id !== id));
    if (selectedId === id) setSelectedId(models[0]?.id || null);
  };
  const selectModel = (id) => setSelectedId(id);
  const addCustom = () => {
    if (!newModel.label || !newModel.endpoint) return;
    const m = { ...newModel, id: Date.now(), free: false };
    setModels([...models, m]);
    setNewModel({ label: '', endpoint: '', apiKey: '', model: '' });
  };

  const testApiKey = async (m) => {
    setTesting(m.id);
    setTestResult(null);
    try {
      const resp = await fetch(`${m.endpoint}/models`, {
        headers: { 'Authorization': `Bearer ${m.apiKey}`, 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(10000)
      });
      if (resp.ok) {
        setTestResult({ ok: true, msg: 'Connection successful' });
      } else {
        setTestResult({ ok: false, msg: `HTTP ${resp.status}: ${resp.statusText}` });
      }
    } catch (e) {
      setTestResult({ ok: false, msg: e.message });
    }
    setTesting(null);
  };

  const handleSave = () => {
    onSave({ ...settings, models, selectedModelId: selectedId });
  };

  // Select model by clicking anywhere on the row
  const selectModelRow = (id) => setSelectedId(id);

  return (
    <div className="panel" style={{ top: 80, right: 20, width: 480, maxHeight: '85vh', overflow: 'auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h2 style={{ fontSize: 16, margin: 0 }}>⚙ Settings</h2>
        <button className="btn" onClick={onClose}>✕</button>
      </div>

      <div style={{ display: 'flex', gap: 4, marginBottom: 12 }}>
        <button className={`btn ${activeTab === 'presets' ? 'btn-primary' : ''}`} onClick={() => setActiveTab('presets')}>Presets</button>
        <button className={`btn ${activeTab === 'custom' ? 'btn-primary' : ''}`} onClick={() => setActiveTab('custom')}>Custom</button>
      </div>

      {activeTab === 'presets' && (
        <div>
          <h3 style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 8 }}>Quick Add — Free Models</h3>
          {PRESETS.filter(p => p.free).map(p => (
            <div key={p.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 8px', background: 'var(--surface)', borderRadius: 6, marginBottom: 4 }}>
              <div>
                <strong>{p.label}</strong>
                <div style={{ fontSize: 10, color: 'var(--muted)' }}>{p.desc}</div>
                <div style={{ fontSize: 9, color: 'var(--muted)' }}>{p.endpoint} / {p.model}</div>
              </div>
              <button className="btn btn-primary" style={{ fontSize: 10, padding: '2px 8px' }} onClick={() => addPreset(p)}>+ Add</button>
            </div>
          ))}
          <h3 style={{ fontSize: 13, color: 'var(--muted)', marginTop: 16, marginBottom: 8 }}>Paid Options</h3>
          {PRESETS.filter(p => !p.free).map(p => (
            <div key={p.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 8px', background: 'var(--surface)', borderRadius: 6, marginBottom: 4 }}>
              <div>
                <strong>{p.label}</strong>
                <div style={{ fontSize: 10, color: 'var(--muted)' }}>{p.desc}</div>
                <div style={{ fontSize: 9, color: 'var(--muted)' }}>{p.endpoint} / {p.model}</div>
              </div>
              <button className="btn" style={{ fontSize: 10, padding: '2px 8px' }} onClick={() => addPreset(p)}>+ Add</button>
            </div>
          ))}
        </div>
      )}

      {activeTab === 'custom' && (
        <div style={{ padding: 8, background: 'var(--surface)', borderRadius: 6 }}>
          <input placeholder="Label" value={newModel.label} onChange={(e) => setNewModel({ ...newModel, label: e.target.value })} style={{ width: '100%', marginBottom: 4, padding: 4 }} />
          <input placeholder="Endpoint (e.g. https://api.openrouter.ai/api/v1)" value={newModel.endpoint} onChange={(e) => setNewModel({ ...newModel, endpoint: e.target.value })} style={{ width: '100%', marginBottom: 4, padding: 4 }} />
          <input placeholder="Model (e.g. mistralai/mistral-small)" value={newModel.model} onChange={(e) => setNewModel({ ...newModel, model: e.target.value })} style={{ width: '100%', marginBottom: 4, padding: 4 }} />
          <input placeholder="API Key" value={newModel.apiKey} onChange={(e) => setNewModel({ ...newModel, apiKey: e.target.value })} style={{ width: '100%', marginBottom: 4, padding: 4 }} />
          <button className="btn btn-primary" onClick={addCustom} style={{ width: '100%' }}>Add Custom Model</button>
        </div>
      )}

      <h3 style={{ fontSize: 13, color: 'var(--muted)', marginTop: 16, marginBottom: 8 }}>Configured Models</h3>
      {models.length === 0 && <div style={{ fontSize: 11, color: 'var(--muted)', padding: '8px 0' }}>No models yet. Add a preset above or enter a custom model.</div>}
      {models.map(m => (
        <div key={m.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 8px', background: selectedId === m.id ? 'var(--accent)' : 'var(--surface)', borderRadius: 6, marginBottom: 4, opacity: selectedId === m.id ? 1 : 0.85, border: selectedId === m.id ? '2px solid var(--accent)' : '2px solid transparent', cursor: 'pointer' }} onClick={() => selectModelRow(m.id)}>
          <div style={{ flex: 1 }}>
            <strong>{m.label}</strong> {m.free && <span style={{ fontSize: 9, background: 'var(--accent)', padding: '1px 4px', borderRadius: 3 }}>FREE</span>}
            {selectedId === m.id && <span style={{ fontSize: 9, background: 'var(--surface)', padding: '1px 4px', borderRadius: 3, marginLeft: 4 }}>✓ SELECTED</span>}
            <div style={{ fontSize: 10, color: 'var(--muted)' }}>{m.endpoint} / {m.model}</div>
          </div>
          <div style={{ display: 'flex', gap: 4 }}>
            <input placeholder="API key" type="password" value={m.apiKey} onChange={(e) => {
              const updated = models.map(x => x.id === m.id ? { ...x, apiKey: e.target.value } : x);
              setModels(updated);
            }} style={{ width: 100, fontSize: 10, padding: 2 }} />
            <button className="btn" style={{ fontSize: 9, padding: '2px 6px' }} onClick={() => testApiKey(m)} disabled={testing === m.id}>
              {testing === m.id ? '…' : 'Test'}
            </button>
            <button className="btn" style={{ fontSize: 9, padding: '2px 6px', color: 'var(--warn)' }} onClick={() => removeModel(m.id)}>✕</button>
          </div>
        </div>
      ))}

      {testResult && (
        <div style={{ marginTop: 8, padding: 6, background: testResult.ok ? 'var(--accent)' : 'var(--warn)', borderRadius: 4, fontSize: 11 }}>
          {testResult.msg}
        </div>
      )}

      <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
        <button className="btn btn-primary" onClick={handleSave} style={{ flex: 1 }}>Save Settings</button>
        <button className="btn" onClick={onClose}>Cancel</button>
      </div>

      <h3 style={{ fontSize: 13, color: 'var(--muted)', marginTop: 16, marginBottom: 8 }}>Dot Density</h3>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
        {DOT_PRESETS.map(d => (
          <button key={d.dots} className={`btn ${settings?.dotDensity === d.dots ? 'btn-primary' : ''}`} style={{ fontSize: 10, padding: '2px 8px' }} onClick={() => onSave({ ...settings, dotDensity: d.dots })}>
            {d.label} ({d.dots.toLocaleString()})
          </button>
        ))}
      </div>
    </div>
  );
}

function JobMonitor({ jobId, onDone }) {
  const [job, setJob] = useState(null);
  useEffect(() => {
    if (!jobId) return;
    let cancelled = false;
    const poll = async () => {
      while (!cancelled) {
        try {
          const r = await fetch(`${API}/api/jobs/${jobId}`);
          const j = await r.json();
          if (cancelled) return;
          setJob(j);
          if (j.state === 'done' || j.state === 'error') { if (onDone) onDone(j); return; }
          await new Promise(res => setTimeout(res, 400));
        } catch { await new Promise(res => setTimeout(res, 1000)); }
      }
    };
    poll();
    return () => { cancelled = true; };
  }, [jobId, onDone]);

  if (!job) return (<div className="stage"><div style={{ display: 'flex', alignItems: 'center', gap: 10 }}><span className="spinner" /><span>Starting job…</span></div></div>);
  const pct = job.progress ?? 0;
  const passes = ['Structure', 'Gradient', 'Detail', 'Lines', 'Accents', 'Polish'];
  const cur = job.stage ? passes.findIndex(s => job.stage.includes(s)) : -1;
  return (
    <div className="stage">
      <div style={{ display: 'flex', justifyContent: 'space-between' }}><div><strong>Compiling</strong>{job.stage && <span style={{ color: 'var(--muted)', marginLeft: 8 }}>{job.stage}</span>}</div><span style={{ fontSize: 18, fontWeight: 600, color: 'var(--accent)' }}>{pct}%</span></div>
      <div className="progress"><i style={{ width: `${pct}%` }} /></div>
      <div style={{ display: 'flex', gap: 4, marginTop: 8 }}>{passes.map((p, i) => (<div key={p} style={{ flex: 1, height: 4, background: i <= cur ? 'var(--accent)' : 'var(--line)', opacity: i <= cur ? 1 : 0.4 }} />))}</div>
      <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>{passes.map((p, i) => (<div key={p} style={{ flex: 1, fontSize: 9, textAlign: 'center', color: i <= cur ? 'var(--text)' : 'var(--muted)' }}>{p}</div>))}</div>
      {job.state === 'done' && <div style={{ marginTop: 10, color: 'var(--accent)' }}>✓ Compile complete — {job.dotsPreview ? job.dotsPreview + ' dots' : ''}</div>}
      {job.state === 'error' && <div style={{ marginTop: 10, color: 'var(--warn)' }}>✗ {job.error || 'Error'}</div>}
    </div>
  );
}

function App() {
  const { projects, loading, createProject, uploadSource, deleteProject, startCompile, getDots } = useProjects();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [activeJob, setActiveJob] = useState(null);
  const [previewDots, setPreviewDots] = useState(null);
  const [previewProject, setPreviewProject] = useState(null);
  const [previewTab, setPreviewTab] = useState('edge');
  const [showSettings, setShowSettings] = useState(false);
  const [settings, setSettings] = useState({ models: [], selectedModelId: null, dotDensity: 50000 });

  // Load settings from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem('stipple-settings');
      if (saved) setSettings(JSON.parse(saved));
    } catch {}
  }, []);

  const saveSettings = (s) => {
    setSettings(s);
    localStorage.setItem('stipple-settings', JSON.stringify(s));
  };

  const onCreate = async () => { if (!name.trim()) return; setBusy(true); await createProject(name.trim()); setName(''); setBusy(false); };
  const onJobDone = async (job) => {
    if (job.state === 'done' && activeJob) {
      // Fetch dots for the project we just compiled
      const projectId = job.projectId;
      if (projectId) {
        const dots = await getDots(projectId);
        if (dots) { setPreviewDots(dots.dots); setPreviewProject(projectId); }
      }
    }
  };
  const viewExisting = async (id) => {
    const dots = await getDots(id);
    if (dots) { setPreviewDots(dots.dots); setPreviewProject(id); }
  };

  // Export project as template JSON file
  const exportTemplate = async (id) => {
    const dots = await getDots(id);
    if (!dots) return;
    const template = {
      version: 1,
      name: projects.find(p => p.id === id)?.name || 'Untitled',
      width: dots.width,
      height: dots.height,
      dotDensity: settings?.dotDensity || 50000,
      edgeBiased: true,
      dots: dots.dots,
      exportedAt: new Date().toISOString(),
    };
    const blob = new Blob([JSON.stringify(template)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tokenart-template-${id}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (<>
    <header><div><h1>Stipple Forge</h1><div className="tag">M0 + M1 — real compile with dot preview</div></div>
      <button className="btn" onClick={() => setShowSettings(true)} style={{ fontSize: 12, padding: '4px 10px' }}>⚙ Settings</button>
    </header>
    <main>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end' }}>
        <div><label style={{ display: 'block', fontSize: 11, color: 'var(--muted)' }}>New project</label><input value={name} onChange={(e) => setName(e.target.value)} placeholder="My scene" style={{ width: 220 }} /></div>
        <button className="btn btn-primary" onClick={onCreate} disabled={busy || !name.trim()}>Create</button>
        <div style={{ flex: 1 }} />
        <button className="btn" onClick={() => window.location.reload()}>Refresh</button>
      </div>

      {loading ? <div style={{ padding: 40, color: 'var(--muted)' }}>Loading…</div> : (
        projects.length === 0 ? <div className="empty">No projects yet. Create one above to start.</div> : (
          <div className="grid">
            {projects.map((p) => (
              <div className="card" key={p.id}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <h3>{p.name}</h3>
                  <button className="btn" style={{ fontSize: 10, padding: '2px 6px', color: 'var(--warn)' }} onClick={() => deleteProject(p.id)}>✕</button>
                </div>
                <p>{p.source ? `source: ${p.source}` : 'no source image'}<br />{new Date(p.created).toLocaleString()}</p>
                <div className="row">
                  <label className="btn" style={{ fontSize: 11, padding: '3px 8px' }}>Import<input type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => e.target.files[0] && uploadSource(p.id, e.target.files[0])} /></label>
                  <button className="btn" style={{ fontSize: 11, padding: '3px 8px' }} disabled={!p.source} onClick={async () => { setPreviewDots(null); const j = await startCompile(p.id, settings.dotDensity); setActiveJob(j); }}>Compile</button>
                  <button className="btn" style={{ fontSize: 11, padding: '3px 8px' }} onClick={() => viewExisting(p.id)}>View</button>
                  <button className="btn" style={{ fontSize: 11, padding: '3px 8px' }} disabled={!p.source} onClick={() => exportTemplate(p.id)}>Export</button>
                </div>
              </div>
            ))}
          </div>
        )
      )}

      {activeJob && <JobMonitor jobId={activeJob} onDone={onJobDone} />}

      {previewDots && (
        <div className="stage" style={{ marginTop: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <strong>Preview — {previewDots.length.toLocaleString()} dots</strong>
            <button className="btn" style={{ fontSize: 11, padding: '3px 8px' }} onClick={() => { setPreviewDots(null); setPreviewProject(null); }}>Close</button>
          </div>
          <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
            <button className="btn btn-primary" style={{ fontSize: 10, padding: '2px 8px' }} onClick={() => setPreviewTab('edge')}>Edge Outline</button>
            <button className="btn" style={{ fontSize: 10, padding: '2px 8px' }} onClick={() => setPreviewTab('result')}>End Result</button>
          </div>
          <DotPreview3D dots={previewDots} width={600} height={400} mode={previewTab} />
        </div>
      )}

      {showSettings && (
        <SettingsPanel
          settings={settings}
          onSave={(s) => { saveSettings(s); setShowSettings(false); }}
          onClose={() => setShowSettings(false)}
        />
      )}
    </main>
  </>);
}

createRoot(document.getElementById('root')).render(<App />);
