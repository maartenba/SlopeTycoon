#!/usr/bin/env python3
"""Contact sheet of a frame folder: seqMontage.py <dir> <out.png> [--crop x,y,w,h] [--cols 3] [--scale 1]"""
import sys, glob, os
from PIL import Image
d, out = sys.argv[1], sys.argv[2]
opt = lambda k, dflt: sys.argv[sys.argv.index(k) + 1] if k in sys.argv else dflt
cols = int(opt('--cols', '3')); sc = float(opt('--scale', '1')); crop = [int(v) for v in opt('--crop', '').split(',')] if '--crop' in sys.argv else None
fs = sorted(glob.glob(os.path.join(d, '*.png')))
ims = []
for f in fs:
    im = Image.open(f).convert('RGB')
    if crop: im = im.crop((crop[0], crop[1], crop[0] + crop[2], crop[1] + crop[3]))
    if sc != 1: im = im.resize((int(im.width * sc), int(im.height * sc)), Image.LANCZOS)
    ims.append(im)
w, h = ims[0].size; rows = (len(ims) + cols - 1) // cols
sheet = Image.new('RGB', (w * cols, h * rows))
for i, im in enumerate(ims): sheet.paste(im, ((i % cols) * w, (i // cols) * h))
sheet.save(out)
