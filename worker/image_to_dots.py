#!/usr/bin/env python3
"""image_to_dots.py — convert an image to a dot point cloud.

Proportional sampling: dots cluster where the image has content (bright areas, edges),
sparse where it's blank/dark. Shading gradients survive as dot-density gradients.

Uses weighted Poisson-disc sampling for even spatial coverage without clumping.

Usage: python3 image_to_dots.py <input_image> <output_json> [max_dots] [--invert-tone]
"""
import json
import math
import random
import sys
import numpy as np


def weighted_poisson_sample(prob, min_dist, max_attempts=30, seed=1701):
    """Sample points using weighted Poisson-disc sampling.

    Each candidate is accepted with probability proportional to prob at that location,
    and rejected if it's too close to an already-accepted point.
    Returns list of (y, x) tuples.
    """
    rng = np.random.default_rng(seed)
    h, w = prob.shape
    prob_flat = prob.ravel()
    # Normalize to cumulative distribution for candidate selection
    cdf = np.cumsum(prob_flat)
    if cdf[-1] <= 0:
        return []
    cdf /= cdf[-1]

    # Spatial hash grid for fast neighbor lookup
    cell_size = max(min_dist, 1.0)
    grid_w = int(math.ceil(w / cell_size)) + 1
    grid_h = int(math.ceil(h / cell_size)) + 1
    grid = {}  # (gx, gy) -> (y, x)

    def grid_key(y, x):
        return (int(x / cell_size), int(y / cell_size))

    def has_neighbor(y, x):
        gx, gy = grid_key(y, x)
        for dy in range(-1, 2):
            for dx in range(-1, 2):
                key = (gx + dx, gy + dy)
                if key in grid:
                    ny, nx = grid[key]
                    if math.hypot(ny - y, nx - x) < min_dist:
                        return True
        return False

    def add_point(y, x):
        gx, gy = grid_key(y, x)
        grid[(gx, gy)] = (y, x)

    # Active list for Poisson-disc generation
    active = []
    points = []

    # Pick first point weighted by probability
    u = rng.random()
    idx = int(np.searchsorted(cdf, u))
    y, x = divmod(idx, w)
    if prob_flat[idx] > 0:
        active.append((float(y), float(x)))
        add_point(y, x)
        points.append((float(y), float(x)))

    while active:
        # Pick a random active point
        ai = rng.integers(len(active))
        ay, ax = active[ai]

        found = False
        for _ in range(max_attempts):
            # Random angle and radius in [min_dist, 2*min_dist]
            angle = rng.random() * 2 * math.pi
            radius = min_dist + rng.random() * min_dist
            ny = ay + radius * math.sin(angle)
            nx = ax + radius * math.cos(angle)

            if ny < 0 or ny >= h or nx < 0 or nx >= w:
                continue

            if has_neighbor(ny, nx):
                continue

            # Accept with probability proportional to prob at this location
            ix = int(nx)
            iy = int(ny)
            p = prob[iy, ix]
            if p <= 0:
                continue
            if rng.random() < p:
                active.append((ny, nx))
                add_point(ny, nx)
                points.append((ny, nx))
                found = True
                break

        if not found:
            active.pop(ai)

    return points


def main():
    in_path = sys.argv[1]
    out_path = sys.argv[2]
    max_dots = int(sys.argv[3]) if len(sys.argv) > 3 else 50000
    invert_tone = '--invert-tone' in sys.argv

    from PIL import Image
    img = Image.open(in_path).convert('RGBA')
    iw, ih = img.size

    # Subsample large images to keep processing fast
    target_pixels = 60000  # ~245x245
    total = iw * ih
    skip = max(1, int(math.sqrt(total / target_pixels)))
    sw = max(8, iw // skip)
    sh = max(8, ih // skip)
    img_small = img.resize((sw, sh), Image.LANCZOS)
    data = np.array(img_small)  # shape (sh, sw, 4) uint8

    # Tone (luminance)
    r, g, b, a = data[..., 0] / 255.0, data[..., 1] / 255.0, data[..., 2] / 255.0, data[..., 3] / 255.0
    tone = 0.299 * r + 0.587 * g + 0.114 * b

    # Edge detection: per-pixel gradient magnitude
    edges = np.zeros_like(tone)
    gx = np.abs(np.roll(tone, -1, axis=1) - np.roll(tone, 1, axis=1))
    gy = np.abs(np.roll(tone, -1, axis=0) - np.roll(tone, 1, axis=0))
    edges[1:-1, 1:-1] = np.hypot(gx[1:-1, 1:-1], gy[1:-1, 1:-1])
    emax = edges.max()
    if emax > 0:
        edges /= emax

    # Tone range
    tmin, tmax = tone.min(), tone.max()
    tr = tmax - tmin
    if tr > 0:
        tnorm = (tone - tmin) / tr
    else:
        tnorm = np.zeros_like(tone)

    # Per-pixel probability
    # Edge boost: 3x density along edges for architectural stipple look
    edge_boost = 3.0
    prob = (0.05 + 0.95 * tnorm) * (1.0 + edges * edge_boost)
    # Additional edge-only pass: extra dots along strong edges
    edge_mask = (edges > 0.5).astype(float)
    prob = prob + edge_mask * 0.3
    # Tone inversion for black-ink stippling
    if invert_tone:
        prob = 1.0 - prob
    prob = np.maximum(prob, 0)
    # Zero out near-transparent pixels
    prob[a < 0.03] = 0

    psum = prob.sum()
    if psum <= 0:
        output = {"dots": [], "width": iw, "height": ih}
        with open(out_path, 'w') as f:
            json.dump(output, f)
        print(f"  wrote 0 dots to {out_path} (empty/transparent image)")
        return

    # Poisson-disc sampling for even spatial coverage
    min_dist = max(1.0, math.sqrt((sw * sh) / max_dots))
    sampled_points = weighted_poisson_sample(prob, min_dist, max_attempts=30, seed=1701)

    # If we didn't get enough dots, fill remaining with weighted CDF sampling
    if len(sampled_points) < max_dots:
        flat = prob.ravel()
        cdf = np.cumsum(flat)
        if cdf[-1] > 0:
            cdf /= cdf[-1]
            rng = np.random.default_rng(1701)
            needed = max_dots - len(sampled_points)
            u_vals = rng.random(needed)
            indices = np.searchsorted(cdf, u_vals)
            sy2, sx2 = np.unravel_index(indices, (sh, sw))
            for i in range(needed):
                sampled_points.append((float(sy2[i]), float(sx2[i])))

    # Build output
    world_scale = 28.0 / max(iw, ih)
    rng = np.random.default_rng(1701)
    dots = []
    for sy, sx in sampled_points[:max_dots]:
        ix = int(sx) * skip
        iy = int(sy) * skip
        # Get color from original image at this pixel
        if ix < iw and iy < ih:
            pr, pg, pb, pa = img.getpixel((ix, iy))
        else:
            pr = pg = pb = 0
        # Jitter — seeded with same rng
        jx = (rng.random() - 0.5) * 0.6
        jy = (rng.random() - 0.5) * 0.6
        wx = (sx - sw / 2 + jx) * world_scale * skip
        wz = (sy - sh / 2 + jy) * world_scale * skip
        size = 0.7 + edges[int(sy), int(sx)] * 1.2
        dots.append([round(float(wx), 3), round(float(wz), 3),
                     round(float(pr) / 255, 3), round(float(pg) / 255, 3),
                     round(float(pb) / 255, 3), round(float(size), 3)])

    output = {
        "width": int(iw),
        "height": int(ih),
        "dots": dots,
        "count": len(dots),
        "seed": 1701,
    }
    with open(out_path, 'w') as f:
        json.dump(output, f)
    print(f"  wrote {len(dots)} dots to {out_path}")

if __name__ == "__main__":
    main()