#!/usr/bin/env python3
"""image_to_dots.py — convert an image to a dot point cloud.

Proportional sampling: dots cluster where the image has content (bright areas, edges),
sparse where it's blank/dark. Shading gradients survive as dot-density gradients.

Usage: python3 image_to_dots.py <input_image> <output_json> [max_dots]
"""
import json
import math
import random
import sys
import numpy as np

def main():
    in_path = sys.argv[1]
    out_path = sys.argv[2]
    max_dots = int(sys.argv[3]) if len(sys.argv) > 3 else 50000

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
    prob = (0.05 + 0.95 * tnorm) * (1.0 + edges * 1.8)
    prob = np.maximum(prob, 0)
    # Zero out near-transparent pixels
    prob[a < 0.03] = 0

    psum = prob.sum()
    if psum <= 0:
        with open(out_path, 'w') as f:
            json.dumps({"dots": [], "width": iw, "height:": ih})
        return

    prob /= psum

    # CDF
    flat = prob.ravel()
    cdf = np.cumsum(flat)

    # Sample dots
    rng = np.random.default_rng(1701)
    n_dots = min(max_dots, int(total * 1.0))
    u_vals = rng.random(n_dots)
    indices = np.searchsorted(cdf, u_vals)

    sy, sx = np.unravel_index(indices, (sh, sw))

    # Build output
    world_scale = 28.0 / max(iw, ih)
    dots = []
    for i in range(n_dots):
        ix = sx[i] * skip
        iy = sy[i] * skip
        # Get color from original image at this pixel
        if ix < iw and iy < ih:
            pr, pg, pb, pa = img.getpixel((ix, iy))
        else:
            pr = pg = pb = 0
        # Jitter
        jx = (random.random() - 0.5) * 0.6
        jy = (random.random() - 0.5) * 0.6
        wx = (sx[i] - sw / 2 + jx) * world_scale * skip
        wz = (sy[i] - sh / 2 + jy) * world_scale * skip
        size = 0.7 + edges[sy[i], sx[i]] * 1.2
        dots.append([round(float(wx), 3), round(float(wz), 3),
                     round(float(pr) / 255, 3), round(float(pg) / 255, 3),
                     round(float(pb) / 255, 3), round(float(size), 3)])

    output = {
        "width": int(iw),
        "height": int(ih),
        "dots": dots,
        "count": len(dots),
    }
    with open(out_path, 'w') as f:
        json.dump(output, f)
    print(f"  wrote {len(dots)} dots to {out_path}")

if __name__ == "__main__":
    main()
