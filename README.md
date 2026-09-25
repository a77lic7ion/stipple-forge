# Stipple Forge

**Stipple Forge** turns a reference image into a pixel-dot (stipple) rendering, shows an approvable preview, then exports a reusable template for TokenArt to render.

## Architecture

```
frontend/  (React + Vite, :5173)  — UI, project list, upload, compile, preview, settings
backend/   (Express + WS, :8766)  — API, compile job orchestration, project CRUD
worker/    (Python + numpy)       — image→dots conversion, edge-biased sampling
```

No npm, no bundler, no build step, no framework (except `server.js` Node helper for the collect API).

## Stippling Pipeline

### 1. Upload
Upload a reference image (PNG/JPG) to a project. The image is stored as `source.png` in the project directory.

### 2. Edge Detection
The worker applies a Sobel filter to detect edges in the image. Edges are where the tonal gradient changes sharply — building outlines, silhouettes, corners.

### 3. Edge-Biased Sampling (the core algorithm)
```
probability = (0.05 + 0.95 * tonal_normalized) * (1.0 + edge_strength * 3.0)
            + (edge_strength > 0.5 ? 0.3 : 0)
```
- **Tonal component**: brighter areas get more dots (proportional to brightness)
- **Edge boost**: 3x density along detected edges — this is what makes it read as "architectural stipple" not "halftone photo"
- **Edge-only pass**: extra dots along strong edges (>0.5 threshold) for crisp silhouettes

This is the pass/fail criterion from the PRD: "not uniform random scatter." Edge-biased density is the fix.

### 4. Dot Output
Each dot is `[x, z, r, g, b, size]`:
- `x, z`: position in the image plane (normalized to ±14 units)
- `r, g, b`: color sampled from the source pixel
- `size`: dot radius (larger along edges, smaller in flat areas)

### 5. Compile Passes (6 stages, shown in progress bar)
1. **Structure** — edge-biased dot placement (the actual work)
2. **Gradient** — tonal density adjustment
3. **Detail** — fine feature dots
4. **Lines** — accent edge lines
5. **Accents** — colored feature dots
6. **Polish** — final refinement

Passes 2–6 are simulated (400ms each); only pass 1 does real work.

## Dot Density Settings

| Preset | Dots | Use case |
|---|---|---|
| Draft | 10,000 | Fast preview |
| Standard | 50,000 | Balanced (default) |
| High | 200,000 | Detailed |
| Ultra | 500,000 | Near-photographic |
| Max | 1,000,000 | Maximum (capped at image pixel count) |

1M dots on a 1280×720 image = 921,600 dots (capped at pixel count). Beyond 1M, the JSON file size and browser rendering become the bottleneck, not the algorithm.

## Model Settings Panel

Five model presets + custom model form + API key test + model selection, saved to localStorage:

| Preset | Endpoint | Model | Free |
|---|---|---|---|
| OpenRouter (free) | `https://openrouter.ai/api/v1` | `mistralai/mixtral-8x7b-instruct` | Yes |
| Nous (free) | `https://api.nous.xyz/v1` | `inclusionai/ling-3.0-flash-sante` | Yes |
| Gemini | `https://generativelanguage.googleapis.com/v1` | `gemini-2.0-flash` | Yes |
| Ollama (local) | `http://localhost:11434/v1` | `llama3.1` | Yes |
| Mistral | `https://api.mistral.ai/v1` | `mistral-small-latest` | No |

Custom models can be added via the Custom tab with label, endpoint, model name, and API key. API key testing hits `{endpoint}/models` with Bearer auth.

The selected model is passed to the compile job (backend accepts `model` parameter, currently unused for dot generation — dots are algorithmic).

## Export / Import Pipeline (Stipple Forge → TokenArt)

### Export (Stipple Forge)
Click **Export** on any compiled project. Downloads a `tokenart-template-*.json` file:

```json
{
  "version": 1,
  "name": "Project Name",
  "width": 1280,
  "height": 720,
  "dotDensity": 500000,
  "edgeBiased": true,
  "dots": [[x, z, r, g, b, size], ...],
  "exportedAt": "2026-09-25T12:00:00.000Z"
}
```

### Import (TokenArt)
1. Open TokenArt demo: `http://100.74.139.124:8221/procedural-city-demo.html`
2. Click **IMPORT** (file input, accepts `.json`)
3. Select the template file
4. The renderer switches from procedural city to the stipple dots, using the same instanced-quad ShaderMaterial renderer
5. Title bar shows dot count, dimensions, edge-bias status

The `renderer.setDots()` method converts flat dots `[[x, z, r, g, b, size]]` to Three.js point cloud format `{ position: [x, 0, z], color: [r, g, b], size }` and renders with the same material as the procedural city.

## API Endpoints

| Method | Path | Description |
|---|---|---|
| GET | `/api/health` | Health check |
| GET | `/api/projects` | List all projects |
| POST | `/api/projects` | Create project (body: `{ name }`) |
| POST | `/api/projects/:id/source` | Upload source image (body: `{ filename, data: base64 }`) |
| POST | `/api/projects/:id/compile` | Start compile (body: `{ dotDensity, model }`) |
| GET | `/api/jobs/:jobId` | Job status and progress |
| GET | `/api/projects/:id/dots` | Get dot data for a project |
| DELETE | `/api/projects/:id` | Delete project |

## Quick Start

```bash
# Backend (API + compile worker)
cd backend && node server.js    # :8766

# Frontend (dev server)
cd frontend && npx vite --host 0.0.0.0  # :5173
```

Then open `http://100.74.139.124:5173/`.

## Key Design Decisions

1. **Instanced quads + ShaderMaterial** — GPU-consistent CSS-px dot sizing, circular via `discard`, one draw call. Not `THREE.Points`.
2. **Edge-biased sampling** — the single biggest improvement to stipple quality. Without it, dots look like halftone photos. With it, they read as pencil stippling.
3. **No LLM for dot generation** — dots are algorithmic (Sobel + CDF sampling). LLM is only for the prompt panel (M2+) and scene exploration.
4. **Template format** — flat dot array + metadata, not structured city data. TokenArt converts flat dots to renderable format on import.
5. **Never 0.0.0.0** — all servers bind explicitly to loopback + LAN + Tailscale.
6. **Credentials from env only** — API keys read from `~/.hermes/.env`, never logged or printed.

## Project Status

- M0+M1 complete: upload → compile → preview → export → import pipeline working
- Edge-biased sampling: 3x edge boost + edge-only pass
- Dot density: 10k–1M presets
- Model settings: 5 presets + custom + API key test + localStorage
- Export: downloads template JSON
- Import: TokenArt reads template JSON and renders via `setDots()`
- GitHub: `a77lic7ion/stipple-forge`