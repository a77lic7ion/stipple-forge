# Stipple Forge

**M0 + M1** — standalone app that turns a reference image into a pixel-dot (stipple) rendering, shows an approvable preview, then compiles a reusable template.

## Quick Start

```bash
cd frontend && npx vite --host 0.0.0.0    # dev server :5173
cd backend && node server.js              # API :8766
```

## Stack
- Frontend: React + Vite (plain JS, ES modules, no build step)
- Backend: Express + WebSocket (Node)
- Worker: Python image-to-dots (numpy, proportional CDF sampling)

## API Endpoints
- `GET /api/health` — health check
- `GET /api/projects` — list projects
- `POST /api/projects` — create project
- `POST /api/projects/:id/source` — upload source image (base64)
- `POST /api/projects/:id/compile` — start compile job
- `GET /api/jobs/:jobId` — job status
- `GET /api/projects/:id/dots` — get dot data

## Features (M0 + M1)
- Project CRUD with source image upload
- Real image-to-dots conversion (80k dots from 1280×720 in ~3s)
- Progress meter with 6-pass display (Structure → Gradient → Detail → Lines → Accents → Polish)
- WebSocket live progress updates
- Delete projects with confirm dialog
- Canvas dot preview with bounding-box auto-fit
