/**
 * Road-vehicle body motion (render only, pure): a soft suspension lean in turns, nose dive when braking / squat when pulling away, and a small bump bob. State is
 * per vehicle, advanced once per frame from the pose the sim already exposes (heading, speed); nothing is saved and no Rng is used.
 */
export interface Suspension { init: boolean; heading: number; speed: number; roll: number; pitch: number; braking: boolean }
export const newSuspension = (): Suspension => ({ init: false, heading: 0, speed: 0, roll: 0, pitch: 0, braking: false });
const clamp = (v: number, a: number, b: number): number => Math.min(b, Math.max(a, v));
/** Shortest signed angle difference. */
export function angleDelta(a: number, b: number): number { const d = ((b - a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI; return d; }
export const SUSP = { maxRoll: 0.07, maxPitch: 0.045, rollGain: 5, pitchGain: 1.2, ease: 0.18, brakeDv: 0.004, bob: 0.004 } as const;

/** Advances the suspension by one frame. `maxSpeed` = the vehicle's cruise speed (normalises the acceleration). Returns the same state object. */
export function stepSuspension(s: Suspension, heading: number, speed: number, maxSpeed: number): Suspension {
  if (!s.init) { s.init = true; s.heading = heading; s.speed = speed; return s; }
  const turn = angleDelta(s.heading, heading), dv = (speed - s.speed) / Math.max(0.001, maxSpeed);
  const moving = speed > 1e-4 ? clamp(speed / Math.max(0.001, maxSpeed), 0, 1) : 0;
  // leaning outwards in a turn (right turn = positive turn about +y: the body rolls to the left), nose down when braking, nose up when accelerating
  const rollT = clamp(-turn * SUSP.rollGain * moving, -SUSP.maxRoll, SUSP.maxRoll), pitchT = clamp(-dv * SUSP.pitchGain * 10, -SUSP.maxPitch, SUSP.maxPitch);
  s.roll += (rollT - s.roll) * SUSP.ease; s.pitch += (pitchT - s.pitch) * SUSP.ease;
  s.braking = dv < -SUSP.brakeDv || speed < maxSpeed * 0.02;
  s.heading = heading; s.speed = speed;
  return s;
}
/** Small vertical bump (tiles) from the distance driven and a per-vehicle phase; zero when standing. */
export const bumpBob = (dist: number, id: number, speed: number): number => (speed > 1e-4 ? SUSP.bob * Math.sin(dist * 3 + id) : 0);
