#!/usr/bin/env python3
"""image_to_dots.py — convert an image to a dot point cloud.

Proportional sampling: dots cluster where the image has content (bright areas, edges),
sparse where it's blank/dark. Shading gradients survive as dot-density gradients.

Uses weighted Poisson-disc sampling for even spatial coverage without clumping.
Supports silhouette/detail edge layers, face/feature masks, spot-color modes,
print tiling, and packed binary templates.

Usage: python3 image_to_dots.py <input_image> <output_json> [max_dots] [--invert-tone] [--mode mono|spot2|spot4|rgb] [--tile-cols N] [--tile-rows N] [--bleed MM]
"""
import json
import math
import random
import sys
import numpy as np
import struct
import zlib


def weighted_poisson_sample(prob, min_dist, max_attempts=30, seed=1701):
    """Sample points using weighted Poisson-disc sampling."""
    rng = np.random.default_rng(seed)
    h, w = prob.shape
    prob_flat = prob.ravel()
    cdf = np.cumsum(prob_flat)
    if cdf[-1] <= 0:
        return []
    cdf /= cdf[-1]

    cell_size = max(min_dist, 1.0)
    grid_w = int(math.ceil(w / cell_size)) + 1
    grid_h = int(math.ceil(h / cell_size)) + 1
    grid = {}

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

    active = []
    points = []

    u = rng.random()
    idx = int(np.searchsorted(cdf, u))
    y, x = divmod(idx, w)
    if prob_flat[idx] > 0:
        active.append((float(y), float(x)))
        add_point(y, x)
        points.append((float(y), float(x)))

    while active:
        ai = rng.integers(len(active))
        ay, ax = active[ai]

        found = False
        for _ in range(max_attempts):
            angle = rng.random() * 2 * math.pi
            radius = min_dist + rng.random() * min_dist
            ny = ay + radius * math.sin(angle)
            nx = ax + radius * math.cos(angle)

            if ny < 0 or ny >= h or nx < 0 or nx >= w:
                continue

            if has_neighbor(ny, nx):
                continue

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


def detect_edges(tone, sigma=1.0):
    """Multi-scale edge detection using Gaussian-smoothed gradients."""
    from scipy.ndimage import gaussian_filter
    # Smooth tone to reduce noise
    smooth = gaussian_filter(tone.astype(float), sigma=sigma)
    gx = np.abs(np.roll(smooth, -1, axis=1) - np.roll(smooth, 1, axis=1))
    gy = np.abs(np.roll(smooth, -1, axis=0) - np.roll(smooth, 1, axis=0))
    edges = np.hypot(gx, gy)
    emax = edges.max()
    if emax > 0:
        edges /= emax
    return edges


def build_importance_mask(data, sw, sh):
    """Build a face/feature importance mask.

    Uses simple heuristics for portrait features:
    - Eyes: bright regions in upper-middle area
    - Mouth/nose: medium-dark region in lower-center
    - Hair: dark region at top
    - Silhouette: broad edge at image boundary
    """
    mask = np.zeros((sh, sw), dtype=float)
    r, g, b, a = data[..., 0] / 255.0, data[..., 1] / 255.0, data[..., 2] / 255.0, data[..., 3] / 255.0
    tone = 0.299 * r + 0.587 * g + 0.114 * b

    # Hair: dark region at top 20%
    hair_region = tone[:sh//5, :]
    hair_mask = (hair_region < 0.4).astype(float)
    mask[:sh//5, :] = hair_mask * 0.8

    # Eyes: bright regions in upper-middle area (top 40-60%)
    eye_region = tone[sh//4:sh//2, :]
    eye_mask = (eye_region > 0.6).astype(float)
    mask[sh//4:sh//2, :] = np.maximum(mask[sh//4:sh//2, :], eye_mask * 0.9)

    # Mouth/nose: medium-dark region in lower-center
    mouth_region = tone[sh//2:3*sh//4, sw//4:3*sw//4]
    mouth_mask = ((mouth_region > 0.3) & (mouth_region < 0.6)).astype(float) * 0.7
    mask[sh//2:3*sh//4, sw//4:3*sw//4] = np.maximum(
        mask[sh//2:3*sh//4, sw//4:3*sw//4],
        np.pad(mouth_mask, ((0, 0), (sw//4, sw//4)), mode='constant')
    )

    # Silhouette: broad edge at image boundary
    silhouette = np.zeros((sh, sw), dtype=float)
    silhouette[:5, :] = 1.0
    silhouette[-5:, :] = 1.0
    silhouette[:, :5] = 1.0
    silhouette[:, -5:] = 1.0
    mask = np.maximum(mask, silhouette * 0.6)

    return mask


def pack_binary(dots, width, height, mode, edges, seed, stats):
    """Pack dots into a compact binary format for large templates.

    Format:
    - 4 bytes: magic 'TKTA'
    - 2 bytes: version (2)
    - 4 bytes: dot count
    - 4 bytes: width
    - 4 bytes: height
    - 1 byte: mode (0=mono, 1=spot2, 2=spot4, 3=rgb)
    - 1 byte: edges (0=basic, 1=silhouette+detail)
    - 4 bytes: seed
    - 4 bytes: stats count
    - For each dot: 6 * 4 bytes = 24 bytes (x, z, r, g, b, size as float32)
    """
    magic = b'TKTA'
    version = struct.pack('<H', 2)
    count = struct.pack('<I', len(dots))
    w = struct.pack('<I', width)
    h = struct.pack('<I', height)
    mode_byte = struct.pack('<B', {'mono': 0, 'spot2': 1, 'spot4': 2, 'rgb': 3}.get(mode, 0))
    edges_byte = struct.pack('<B', 1 if edges == 'silhouette+detail' else 0)
    seed_bytes = struct.pack('<i', seed)
    stats_count = struct.pack('<I', stats.get('count', len(dots)))

    dot_data = b''
    for d in dots:
        dot_data += struct.pack('<ffffff', d[0], d[1], d[2], d[3], d[4], d[5])

    return magic + version + count + w + h + mode_byte + edges_byte + seed_bytes + stats_count + dot_data


def main():
    in_path = sys.argv[1]
    out_path = sys.argv[2]
    max_dots = int(sys.argv[3]) if len(sys.argv) > 3 else 50000
    invert_tone = '--invert-tone' in sys.argv
    mode = 'mono'
    tile_cols = 0
    tile_rows = 0
    bleed_mm = 3.0

    # Parse additional args
    i = 4
    while i < len(sys.argv):
        if sys.argv[i] == '--mode' and i + 1 < len(sys.argv):
            mode = sys.argv[i + 1]
            i += 2
        elif sys.argv[i] == '--tile-cols' and i + 1 < len(sys.argv):
            tile_cols = int(sys.argv[i + 1])
            i += 2
        elif sys.argv[i] == '--tile-rows' and i + 1 < len(sys.argv):
            tile_rows = int(sys.argv[i + 1])
            i += 2
        elif sys.argv[i] == '--bleed' and i + 1 < len(sys.argv):
            bleed_mm = float(sys.argv[i + 1])
            i += 2
        else:
            i += 1

    from PIL import Image
    img = Image.open(in_path).convert('RGBA')
    iw, ih = img.size

    # Subsample large images to keep processing fast
    target_pixels = 60000
    total = iw * ih
    skip = max(1, int(math.sqrt(total / target_pixels)))
    sw = max(8, iw // skip)
    sh = max(8, ih // skip)
    img_small = img.resize((sw, sh), Image.Resampling.LANCZOS)
    data = np.array(img_small)

    # Tone (luminance)
    r, g, b, a = data[..., 0] / 255.0, data[..., 1] / 255.0, data[..., 2] / 255.0, data[..., 3] / 255.0
    tone = 0.299 * r + 0.587 * g + 0.114 * b

    # Multi-scale edge detection
    try:
        edges_detail = detect_edges(tone, sigma=0.5)   # Fine detail (eyes, hair)
        edges_silhouette = detect_edges(tone, sigma=2.0)  # Broad silhouette
    except ImportError:
        # Fallback if scipy not available
        edges_detail = np.zeros_like(tone)
        gx = np.abs(np.roll(tone, -1, axis=1) - np.roll(tone, 1, axis=1))
        gy = np.abs(np.roll(tone, -1, axis=0) - np.roll(tone, 1, axis=0))
        edges_detail[1:-1, 1:-1] = np.hypot(gx[1:-1, 1:-1], gy[1:-1, 1:-1])
        emax = edges_detail.max()
        if emax > 0:
            edges_detail /= emax
        edges_silhouette = edges_detail.copy()

    # Importance mask for portrait features
    try:
        importance = build_importance_mask(data, sw, sh)
    except Exception:
        importance = np.ones((sh, sw), dtype=float) * 0.5

    # Tone range
    tmin, tmax = tone.min(), tone.max()
    tr = tmax - tmin
    if tr > 0:
        tnorm = (tone - tmin) / tr
    else:
        tnorm = np.zeros_like(tone)

    # Per-pixel probability with silhouette/detail layers
    tone_weight = 0.3
    silhouette_weight = 0.35
    detail_weight = 0.25
    importance_weight = 0.1

    prob = (
        tone_weight * (1.0 - tnorm) +  # Darker = more dots (for black ink)
        silhouette_weight * edges_silhouette +
        detail_weight * edges_detail +
        importance_weight * importance
    )

    # Edge boost for architectural stipple look
    edge_boost = 3.0
    prob = prob * (1.0 + edges_detail * edge_boost)

    # Additional edge-only pass for strong edges
    edge_mask = (edges_detail > 0.5).astype(float)
    prob = prob + edge_mask * 0.3

    # Tone inversion for black-ink stippling
    if invert_tone:
        prob = 1.0 - prob

    prob = np.maximum(prob, 0)
    prob[a < 0.03] = 0

    psum = prob.sum()
    if psum <= 0:
        output = {"dots": [], "width": iw, "height": ih, "mode": mode}
        with open(out_path, 'w') as f:
            json.dump(output, f)
        print(f"  wrote 0 dots to {out_path} (empty/transparent image)")
        return

    # Poisson-disc sampling
    min_dist = max(1.0, math.sqrt((sw * sh) / max_dots))
    sampled_points = weighted_poisson_sample(prob, min_dist, max_attempts=30, seed=1701)

    # Fill remaining with weighted CDF sampling
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

    # Build output with color mode
    world_scale = 28.0 / max(iw, ih)
    rng = np.random.default_rng(1701)
    dots = []
    for sy, sx in sampled_points[:max_dots]:
        ix = int(sx) * skip
        iy = int(sy) * skip
        if ix < iw and iy < ih:
            pr, pg, pb, pa = img.getpixel((ix, iy))
        else:
            pr = pg = pb = 0

        # Color mode handling
        if mode == 'mono':
            # Monochrome: all dots use ink color, tone encoded by density
            ink_r, ink_g, ink_b = 0.09, 0.10, 0.10  # Near-black ink
        elif mode == 'spot2':
            # 2-color spot: base ink + one accent
            base_r, base_g, base_b = 0.09, 0.10, 0.10
            accent_r, accent_g, accent_b = 0.85, 0.55, 0.45  # Rust accent
            if pr/255 > 0.5:
                ink_r, ink_g, ink_b = accent_r, accent_g, accent_b
            else:
                ink_r, ink_g, ink_b = base_r, base_g, base_b
        elif mode == 'spot4':
            # 4-color spot: curated palette
            base_r, base_g, base_b = 0.09, 0.10, 0.10
            rust_r, rust_g, rust_b = 0.85, 0.55, 0.45
            teal_r, teal_g, teal_b = 0.18, 0.56, 0.51
            cream_r, cream_g, cream_b = 0.96, 0.94, 0.89
            luma = 0.299 * (pr/255) + 0.587 * (pg/255) + 0.114 * (pb/255)
            if luma < 0.25:
                ink_r, ink_g, ink_b = base_r, base_g, base_b
            elif luma < 0.5:
                ink_r, ink_g, ink_b = rust_r, rust_g, rust_b
            elif luma < 0.75:
                ink_r, ink_g, ink_b = teal_r, teal_g, teal_b
            else:
                ink_r, ink_g, ink_b = cream_r, cream_g, cream_b
        else:  # rgb or unknown
            ink_r, ink_g, ink_b = pr / 255, pg / 255, pb / 255

        # Jitter
        jx = (rng.random() - 0.5) * 0.6
        jy = (rng.random() - 0.5) * 0.6
        wx = (sx - sw / 2 + jx) * world_scale * skip
        wz = (sy - sh / 2 + jy) * world_scale * skip
        size = 0.7 + edges_detail[int(sy), int(sx)] * 1.2
        dots.append([round(float(wx), 3), round(float(wz), 3),
                     round(ink_r, 3), round(ink_g, 3),
                     round(ink_b, 3), round(float(size), 3)])

    output = {
        "width": int(iw),
        "height": int(ih),
        "dots": dots,
        "count": len(dots),
        "seed": 1701,
        "mode": mode,
        "edges": "silhouette+detail",
        "importance_mask": True,
        "stats": {"count": len(dots)},
    }

    # Add print tiling metadata
    if tile_cols > 0 and tile_rows > 0:
        output["stats"]["tiling"] = {
            "cols": tile_cols,
            "rows": tile_rows,
            "bleedMm": bleed_mm,
        }

    with open(out_path, 'w') as f:
        json.dump(output, f)

    # Also write packed binary version for large templates
    bin_path = out_path.replace('.json', '.bin')
    binary_data = pack_binary(dots, iw, ih, mode, "silhouette+detail", 1701, output["stats"])
    with open(bin_path, 'wb') as f:
        f.write(binary_data)
    print(f"  wrote {len(dots)} dots to {out_path} (mode={mode}, binary={bin_path})")

if __name__ == "__main__":
    main()