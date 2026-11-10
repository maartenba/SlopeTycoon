#!/usr/bin/env python3
"""Beat-level features of a promo song for the clean-edit planner (scripts/promo/music.ts planEdit).
Usage: .weave/venv-audio/bin/python scripts/promo/musicFeatures.py public/audio/menu-seasons-of-management.mp3 promo/music-seasons-of-management.json
Needs numpy, scipy, librosa (pip install librosa; analysis tooling only, nothing ships). Writes: beats (s, from librosa beat tracking at the
dominant ~80-90 bpm pulse), chroma per beat (12, unit norm), rmsDb per beat, centroid (Hz) per beat, timbre per beat (MFCC 2-13, z-scored, unit norm), novelty per beat (checkerboard on a
beat-level chroma + MFCC self-similarity: section boundaries), the duration and `ending` (start of the final decay / cadence)."""
import sys, json, subprocess, numpy as np, librosa, tempfile, os
src, dst = sys.argv[1], sys.argv[2]
tmp = tempfile.mktemp(suffix='.wav'); subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', src, '-ac', '1', '-ar', '22050', tmp], check=True)
y, sr = librosa.load(tmp, sr=22050); os.remove(tmp); D = len(y) / sr; hop = 512
oenv = librosa.onset.onset_strength(y=y, sr=sr, hop_length=hop)
tempo, bf = librosa.beat.beat_track(onset_envelope=oenv, sr=sr, hop_length=hop, start_bpm=85, tightness=100)
if float(np.atleast_1d(tempo)[0]) > 120: tempo, bf = librosa.beat.beat_track(onset_envelope=oenv, sr=sr, hop_length=hop, start_bpm=70, tightness=100)
bt = librosa.frames_to_time(bf, sr=sr, hop_length=hop)
ch = librosa.feature.chroma_cqt(y=y, sr=sr, hop_length=hop); mf = librosa.feature.mfcc(y=y, sr=sr, hop_length=hop, n_mfcc=13)[1:]
rms = librosa.feature.rms(y=y, frame_length=2048, hop_length=hop)[0]; cen = librosa.feature.spectral_centroid(y=y, sr=sr, hop_length=hop)[0]
edges = np.append(bf, min(len(rms), bf[-1] + int(np.median(np.diff(bf)))))
def agg(a, f=np.mean): return np.array([f(a[..., edges[i]:max(edges[i] + 1, edges[i + 1])], axis=-1) for i in range(len(bf))])
C = agg(ch); C = C / (np.linalg.norm(C, axis=1, keepdims=True) + 1e-9); M = agg(mf); R = 20 * np.log10(agg(rms) + 1e-6); CE = agg(cen)
Mz = (M - M.mean(0)) / (M.std(0) + 1e-9); Mz /= (np.linalg.norm(Mz, axis=1, keepdims=True) + 1e-9)
k = 8; F = np.hstack([np.hstack([np.roll(C, -i, 0) for i in range(k)]), np.hstack([np.roll(Mz, -i, 0) for i in range(k)])]); F /= np.linalg.norm(F, axis=1, keepdims=True) + 1e-9
S = F @ F.T; n = len(S); h = 8; nov = np.zeros(n)
for i in range(h, n - h):
    blk = S[i - h:i + h, i - h:i + h]; nov[i] = blk[h:, h:].mean() + blk[:h, :h].mean() - blk[:h, h:].mean() - blk[h:, :h].mean()
nov = nov / (nov.max() + 1e-9)
# the ending: the last time the 0.25 s smoothed level is within 3 dB of the loud body of the last 30 s (before the final decay)
sm = np.convolve(20 * np.log10(rms + 1e-6), np.ones(11) / 11, 'same'); t = librosa.frames_to_time(np.arange(len(rms)), sr=sr, hop_length=hop)
body = np.percentile(sm[(t > D - 30) & (t < D - 8)], 75); idx = np.where((sm > body - 3) & (t < D - 3))[0]; ending = float(t[idx[-1]]) if len(idx) else D - 9
json.dump({'src': os.path.basename(src), 'dur': round(D, 3), 'tempo': round(float(np.atleast_1d(tempo)[0]), 2), 'ending': round(ending, 2), 'beats': [round(float(x), 3) for x in bt],
           'chroma': [[round(float(v), 3) for v in r] for r in C], 'rmsDb': [round(float(v), 2) for v in R], 'centroid': [round(float(v)) for v in CE], 'novelty': [round(float(v), 3) for v in nov], 'timbre': [[round(float(v), 3) for v in r] for r in Mz]}, open(dst, 'w'), separators=(',', ':'))
print(dst, 'beats', len(bt), 'tempo', tempo, 'ending', ending)
