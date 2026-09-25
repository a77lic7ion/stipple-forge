import React, { useState, useEffect, useCallback, useRef } from 'react';
import { createRoot } from 'react-dom/client';

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
  const startCompile = async (id) => { const r = await fetch(`${API}/api/projects/${id}/compile`, { method: 'POST' }); return (await r.json()).jobId; };
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

  return (<>
    <header><div><h1>Stipple Forge</h1><div className="tag">M0 + M1 — real compile with dot preview</div></div></header>
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
                  <button className="btn" style={{ fontSize: 11, padding: '3px 8px' }} disabled={!p.source} onClick={async () => { setPreviewDots(null); const j = await startCompile(p.id); setActiveJob(j); }}>Compile</button>
                  <button className="btn" style={{ fontSize: 11, padding: '3px 8px' }} onClick={() => viewExisting(p.id)}>View</button>
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
          <DotPreview dots={previewDots} width={600} height={400} />
        </div>
      )}
    </main>
  </>);
}

createRoot(document.getElementById('root')).render(<App />);
