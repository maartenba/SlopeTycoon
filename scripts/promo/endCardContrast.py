#!/usr/bin/env python3
"""Contrast of the end-card URL against its background: python endCardContrast.py frame.png  (frame = the end card at full opacity, e.g. endcard-90-t5.5.png)
Band = the URL line (centre, 0.495-0.66 of the height); glyph pixels and an 8 px ring around them are ignored, the rest is the background the text sits on. Reports WCAG contrast of white vs the mean / p95 / max background luminance."""
import sys, numpy as np
from PIL import Image
a = np.asarray(Image.open(sys.argv[1]).convert('RGB')).astype(np.float64) / 255; H, W, _ = a.shape
lin = np.where(a <= 0.04045, a / 12.92, ((a + 0.055) / 1.055) ** 2.4); L = 0.2126 * lin[..., 0] + 0.7152 * lin[..., 1] + 0.0722 * lin[..., 2]
band = L[int(H * 0.495):int(H * 0.66), int(W * 0.14):int(W * 0.86)]; from scipy.ndimage import binary_dilation
bg = band[~binary_dilation(band > 0.45, iterations=8)]  # drop the glyphs and an 8 px ring around them (anti-aliased edges are not background)
for nm, v in (('mean', bg.mean()), ('p95', np.percentile(bg, 95)), ('p99', np.percentile(bg, 99)), ('max', bg.max())): print(f'{nm}: bg luminance {v:.4f} -> contrast white/bg {(1.05) / (v + 0.05):.1f}:1')
