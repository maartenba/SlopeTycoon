/**
 * Frame-rate AND tick-rate independent chase factor for render smoothing of sim-driven agents (sleds, snowcats, helicopters, rangers, ...).
 * The sim moves them once per tick (1.6 ticks/s at 1x), so the smoothed display position follows with a time constant of ~1 tick:
 * `pos += (target - pos) * chaseK(dt, ticksPerSecond)`. (The old fixed 0.25 per frame meant a 0.1 s lag, i.e. stop-and-go at the 1.6 Hz tick.)
 */
export function chaseK(dt: number, ticksPerSecond: number, gain = 1.2): number {
  const tps = Math.max(0.5, Number.isFinite(ticksPerSecond) ? ticksPerSecond : 1.6);
  return 1 - Math.exp(-Math.max(0, dt) * tps * gain);
}
