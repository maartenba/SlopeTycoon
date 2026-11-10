#!/usr/bin/env python3
"""Aliasing / shimmer measure without optical flow (docs/promo-video.md): A = frames rendered at the target size, B = the same frames rendered
at a higher size and area-downscaled to the same size (the 'truth'). e(t) = A(t) - B(t) is the aliasing error; shimmer = |e(t) - (e(t-1)+e(t+1))/2|.
  python3 scripts/promo/aliasStats.py <dirA> <dirB> [--thr 8]   (both: frames/<shot>/*.jpg of equal size and count)"""
import sys, os, glob, cv2, numpy as np
a, b = sys.argv[1], sys.argv[2]; thr = float(sys.argv[sys.argv.index('--thr') + 1]) if '--thr' in sys.argv else 8
for sd in sorted(os.listdir(a)):
    fa, fb = sorted(glob.glob(f'{a}/{sd}/*.jpg')), sorted(glob.glob(f'{b}/{sd}/*.jpg'))
    if not fb: continue
    n = min(len(fa), len(fb)); e = [cv2.imread(fa[i], 0).astype(np.float32) - cv2.imread(fb[i], 0).astype(np.float32) for i in range(n)]
    fl, mn = [], []
    for i in range(1, n - 1):
        r = np.abs(e[i] - 0.5 * (e[i - 1] + e[i + 1])); fl.append((r > thr).mean() * 100); mn.append(r.mean())
    print(f'{sd:16s} n={n} shimmer mean|r|={np.mean(mn):.3f} flip>{thr:g}={np.mean(fl):.3f}%  static aliasing |e|={np.mean([np.abs(x).mean() for x in e]):.3f}')
