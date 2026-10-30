import { Layer } from '../../src/world/Networks';
import type { Sim } from '../../src/game/createSim';

/** Paint a backcountry route (<= `len` tiles) that starts on the flank of the starter piste; returns its tile indices. */
export function paintBackcountryRoute(s: Sim, len = 8): number[] {
  const n = s.size, net = s.networks, out: number[] = [];
  let cur = -1;
  for (let i = 0; i < n * n && cur < 0; i++) if ((net.layers[i]! & Layer.Ski) && net.kind[i] === 0) cur = i;
  for (let k = 0; k < 80 && out.length < len; k++) {
    const x = cur % n, y = (cur / n) | 0;
    const nb = ([[1, 0], [0, 1], [-1, 0], [0, -1]] as const).map(([dx, dy]) => (y + dy) * n + x + dx).find((j) => !out.includes(j) && !(net.layers[j]! & Layer.Ski) && net.canPaint(j % n, (j / n) | 0, Layer.Backcountry).ok);
    if (nb === undefined) break;
    out.push(nb); cur = nb;
  }
  net.paint(Layer.Backcountry, out.map((t) => ({ x: t % n, y: (t / n) | 0 })));
  return out;
}
