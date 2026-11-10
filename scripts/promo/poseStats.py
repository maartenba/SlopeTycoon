#!/usr/bin/env python3
"""Camera pose smoothness: python3 poseStats.py pose.json [more.json]. Pose rows = [t, ...channels] per frame (free: px py pz yaw pitch fov; iso: tx ty tz yaw logzoom).
Reports per channel the peak |acceleration| (units / s^2), the peak |jerk| and the p99 |accel|, and the times of the three worst accel spikes (dups at the same t are dropped)."""
import json, sys, numpy as np
for f in sys.argv[1:]:
    rows = json.load(open(f)); out = []
    for r in rows:
        if out and abs(r[0]-out[-1][0]) < 1e-6: out[-1] = r
        else: out.append(r)
    a = np.array(out); t = a[:,0]; dt = np.median(np.diff(t)); free = a.shape[1] == 7
    names = ['px','py','pz','yaw','pitch','fov'] if free else ['tx','ty','tz','yaw','logzoom']
    print(f"== {f.split('/')[-1]}  frames {len(a)}  dt {dt:.4f}")
    worst = 0
    for k, n in enumerate(names):
        x = a[:,k+1].copy()
        if n in ('yaw','pitch'): x = np.unwrap(x)
        v = np.diff(x)/dt; ac = np.diff(v)/dt; j = np.diff(ac)/dt
        sp = np.argsort(-np.abs(ac))[:3]
        print(f"  {n:7s} peak accel {np.abs(ac).max():9.2f}  p99 {np.percentile(np.abs(ac),99):8.2f}  peak jerk {np.abs(j).max():10.1f}  worst at t={[round(float(t[i+1]),2) for i in sp]}")
        # unit-aware "visible" score: free: position in tiles, angles in degrees; iso: world units
        if n in ('yaw','pitch'): ac = np.degrees(ac)
        worst = max(worst, np.abs(ac).max()) if n != 'fov' else worst
    print(f"  worst (pos units / deg) accel {worst:.1f}")
