#!/usr/bin/env python3
"""Verify a rendered promo music edit: click-free seam (sample-level difference, 10 ms energy), spectral / level step across the seam against the song's natural bar-to-bar variation, plots.
Usage: .weave/venv-audio/bin/python scripts/promo/musicVerify.py .weave/promo/out/music-90.json .weave/promo/out/music-90.wav  (needs numpy, scipy, librosa, matplotlib)"""
import sys, json, numpy as np, librosa, matplotlib; matplotlib.use('Agg'); import matplotlib.pyplot as plt
info = json.load(open(sys.argv[1])); y, sr = librosa.load(sys.argv[2], sr=None, mono=True); t_seam = info['outA']
def rms_db(x): return 20 * np.log10(np.sqrt((x ** 2).mean()) + 1e-9)
hop = int(sr * 0.01); e = np.array([rms_db(y[i:i + hop]) for i in range(0, len(y) - hop, hop)])
d = np.abs(np.diff(y)); res = {}
if t_seam is not None:
    c = int(t_seam * sr); w = int(0.005 * sr)
    res['seamMaxDiff'] = float(d[c - w:c + w].max()); res['typicalP999Diff'] = float(np.percentile(d, 99.9)); res['globalMaxDiff'] = float(d.max())
    k = int(t_seam * 100); res['energy10ms_dB_seam_vs_neighbours'] = [round(float(v), 1) for v in e[k - 5:k + 6]]
    res['maxStep10ms_seam_dB'] = float(np.abs(np.diff(e[k - 8:k + 9])).max()); res['maxStep10ms_elsewhere_p99_dB'] = float(np.percentile(np.abs(np.diff(e)), 99))
    # mel-spectrum distance (log-mel, 0.4 s before vs 0.4 s after) at the seam vs at every other 0.72 s position of the film audio
    def mel(seg): m = librosa.feature.melspectrogram(y=seg, sr=sr, n_fft=2048, hop_length=512, n_mels=40); return np.log(m.mean(1) + 1e-8)
    L = int(0.4 * sr); dist = lambda c: float(np.linalg.norm(mel(y[c - L:c]) - mel(y[c:c + L])) / np.sqrt(40))
    nat = [dist(int(s * sr)) for s in np.arange(2, len(y) / sr - 12, 0.72) if abs(s - t_seam) > 0.5]
    res['melDistSeam'] = dist(c); res['melDistNaturalMedian'] = float(np.median(nat)); res['melDistNaturalP90'] = float(np.percentile(nat, 90)); res['melDistSeamPercentile'] = float((np.array(nat) < dist(c)).mean() * 100)
    fig, ax = plt.subplots(3, 1, figsize=(14, 9)); lo, hi = max(0, t_seam - 3), t_seam + 3; seg = y[int(lo * sr):int(hi * sr)]
    S = librosa.amplitude_to_db(np.abs(librosa.stft(seg, n_fft=2048, hop_length=256)), ref=np.max); ax[0].imshow(S, origin='lower', aspect='auto', extent=[lo, hi, 0, sr / 2], cmap='magma'); ax[0].set_ylim(0, 8000); ax[0].axvline(t_seam, color='c', lw=0.8); ax[0].set_title('spectrogram +/-3 s around the seam (cyan)')
    ax[1].plot(np.arange(len(seg)) / sr + lo, seg, lw=0.3); ax[1].axvline(t_seam, color='r', lw=0.5); ax[1].set_title('waveform')
    z = int(0.15 * sr); zz = y[c - z:c + z]; ax[2].plot(np.arange(len(zz)) / sr * 1000 - 150, zz, lw=0.5); ax[2].axvspan(-100, 0, color='y', alpha=0.2); ax[2].set_title('waveform +/-150 ms (yellow = the 100 ms crossfade, ends on the beat)')
    plt.tight_layout(); plt.savefig(sys.argv[2].replace('.wav', '-seam.png'), dpi=70)
fig, ax = plt.subplots(2, 1, figsize=(14, 6)); n = int(len(y) / sr); ax[0].plot(np.arange(len(e)) * 0.01, e, lw=0.4); ax[0].set_title('10 ms RMS dB, whole edit'); 
S = librosa.amplitude_to_db(np.abs(librosa.stft(y[-int(14 * sr):], n_fft=2048, hop_length=512)), ref=np.max); ax[1].imshow(S, origin='lower', aspect='auto', extent=[len(y) / sr - 14, len(y) / sr, 0, sr / 2], cmap='magma'); ax[1].set_ylim(0, 8000); ax[1].set_title('spectrogram of the last 14 s (the natural ending)')
plt.tight_layout(); plt.savefig(sys.argv[2].replace('.wav', '-ending.png'), dpi=70)
res['lastSecondDb'] = [round(float(rms_db(y[-int((i + 1) * sr):len(y) - int(i * sr)])), 1) for i in range(0, 4)]
print(json.dumps(res, indent=1))
