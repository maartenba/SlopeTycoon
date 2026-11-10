#!/usr/bin/env python3
"""One-frame glitch finder: a frame whose neighbours t-1 and t+1 agree with each other (small diff) while both differ a lot from t.
  python3 scripts/promo/glitchFrames.py <frames-dir> [--ratio 3] [--min 6]   (prints shot, frame, diffs; exit 1 when any found)"""
import sys, os, glob, cv2, numpy as np
root = sys.argv[1]; opt = lambda k, d: float(sys.argv[sys.argv.index(k) + 1]) if k in sys.argv else d
ratio, mn = opt('--ratio', 3), opt('--min', 6); bad = 0
for d in sorted(os.listdir(root)):
    p = os.path.join(root, d)
    if not os.path.isdir(p): continue
    fs = sorted(glob.glob(p + '/*.jpg') + glob.glob(p + '/*.png'))
    im = [cv2.resize(cv2.imread(f, cv2.IMREAD_GRAYSCALE), (192, 108), interpolation=cv2.INTER_AREA).astype(np.float32) for f in fs]
    for i in range(1, len(im) - 1):
        dp, dn, dpn = np.abs(im[i] - im[i - 1]).mean(), np.abs(im[i] - im[i + 1]).mean(), np.abs(im[i - 1] - im[i + 1]).mean()
        if min(dp, dn) > mn and min(dp, dn) > ratio * max(dpn, 0.5): print(f'{d} frame {i + 1}: d(t-1,t)={dp:.1f} d(t,t+1)={dn:.1f} d(t-1,t+1)={dpn:.1f}'); bad += 1
print(f'{bad} glitch frame(s)'); sys.exit(1 if bad else 0)
