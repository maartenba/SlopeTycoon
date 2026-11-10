#!/usr/bin/env python3
"""Temporal flicker statistics for promo frames (docs/promo-video.md, "Flicker hunt").
  python3 scripts/promo/flickerStats.py <frames-dir> [--shots s01,s05] [--out report.json] [--thr 12] [--half 2]
Motion-compensated: Farneback optical flow warps frames t-1 and t+1 onto frame t; the residual of a pixel is min(|t - warp(t-1)|, |t - warp(t+1)|),
so camera motion and occlusions cancel and only pixels that are OFF in frame t relative to BOTH neighbours (flicker, shimmer, sparkle, swimming
shadow edges) remain. Per shot: mean residual, share of pixels above --thr (flips), the worst frame, the worst 8x8 tile (row, col) and its share.
Needs numpy, pillow, opencv-python-headless (a venv is fine)."""
import sys, os, json, glob
import numpy as np, cv2
from multiprocessing import Pool
cv2.setNumThreads(1)

def load(p, half):
    g = cv2.imread(p, cv2.IMREAD_GRAYSCALE)
    return cv2.resize(g, (g.shape[1] // half, g.shape[0] // half), interpolation=cv2.INTER_AREA) if half > 1 else g

def warp(src, ref):
    fl = cv2.calcOpticalFlowFarneback(ref, src, None, 0.5, 4, 21, 3, 7, 1.5, 0)  # flow ref -> src
    h, w = ref.shape; gx, gy = np.meshgrid(np.arange(w, dtype=np.float32), np.arange(h, dtype=np.float32))
    return cv2.remap(src, gx + fl[..., 0], gy + fl[..., 1], cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)

def shot(args):
    d, thr, half = args
    fs = sorted(glob.glob(os.path.join(d, '*.jpg')) + glob.glob(os.path.join(d, '*.png')))
    if len(fs) < 3: return None
    a, b = load(fs[0], half), load(fs[1], half)
    mean_l, flip_l, tiles = [], [], None
    for i in range(1, len(fs) - 1):
        c = load(fs[i + 1], half)
        r = np.minimum(np.abs(b.astype(np.float32) - warp(a, b)), np.abs(b.astype(np.float32) - warp(c, b)))
        r[:8, :] = 0; r[-8:, :] = 0; r[:, :8] = 0; r[:, -8:] = 0  # border: warp padding
        m = r > thr
        mean_l.append(float(r.mean())); flip_l.append(float(m.mean()))
        h, w = m.shape; t = m[:h // 8 * 8, :w // 8 * 8].reshape(8, h // 8, 8, w // 8).mean(axis=(1, 3))
        tiles = t if tiles is None else tiles + t
        a, b = b, c
    n = len(mean_l); tiles = tiles / n
    wi = int(np.argmax(flip_l)); ty, tx = np.unravel_index(int(np.argmax(tiles)), tiles.shape)
    return {'shot': os.path.basename(d), 'frames': len(fs), 'meanAbs': float(np.mean(mean_l)), 'flipPct': float(np.mean(flip_l) * 100),
            'worstFrame': wi + 2, 'worstFlipPct': float(flip_l[wi] * 100), 'hotTile': [int(ty), int(tx)], 'hotTileFlipPct': float(tiles[ty, tx] * 100)}

if __name__ == '__main__':
    root = sys.argv[1]; opt = lambda k, d: sys.argv[sys.argv.index(k) + 1] if k in sys.argv else d
    only = [s for s in opt('--shots', '').split(',') if s]; thr = float(opt('--thr', '12')); half = int(opt('--half', '2'))
    dirs = [os.path.join(root, x) for x in sorted(os.listdir(root)) if os.path.isdir(os.path.join(root, x)) and (not only or any(x.startswith(o) for o in only))]
    with Pool(int(opt('--jobs', '4'))) as p: res = [r for r in p.map(shot, [(d, thr, half) for d in dirs], chunksize=1) if r]
    for r in sorted(res, key=lambda r: -r['flipPct']):
        print(f"{r['shot']:16s} n={r['frames']:4d} mean|r|={r['meanAbs']:.3f} flip>{thr:g}={r['flipPct']:.3f}% worst f{r['worstFrame']} {r['worstFlipPct']:.2f}% hot tile (row {r['hotTile'][0]}, col {r['hotTile'][1]}) {r['hotTileFlipPct']:.2f}%")
    tot = sum(r['frames'] for r in res); print(f"ALL mean flip {sum(r['flipPct'] * r['frames'] for r in res) / max(1, tot):.3f}%  mean|r| {sum(r['meanAbs'] * r['frames'] for r in res) / max(1, tot):.3f}")
    if '--out' in sys.argv: json.dump(res, open(opt('--out', ''), 'w'), indent=1)
