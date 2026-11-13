/**
 * Road-vehicle body motion (render only, pure): a soft suspension lean in turns, nose dive when braking / squat when pulling away, and a small bump bob. State is
 * per vehicle, advanced once per frame from the pose the sim already exposes (heading, speed); nothing is saved and no Rng is used.
 */
export interface Suspension { init: boolean; heading: number; speed: number; roll: number; pitch: number; braking: boolean; /** Frames since the last speed drop (brake-light hold). */ quiet: number }
export const newSuspension = (): Suspension => ({ init: false, heading: 0, speed: 0, roll: 0, pitch: 0, braking: false, quiet: 999 });
const clamp = (v: number, a: number, b: number): number => Math.min(b, Math.max(a, v));
/** Shortest signed angle difference. */
export function angleDelta(a: number, b: number): number { const d = ((b - a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI; return d; }
export const SUSP = { maxRoll: 0.07, maxPitch: 0.045, rollGain: 5, pitchGain: 1.2, ease: 0.18, brakeDv: 0.004, /** A speed drop of at least this share of the cruise speed (per frame) re-arms the brake lights; they stay lit this many frames after the last drop (the sim speed changes once per tick, so a smooth slow-down is a train of small drops). */ dropDv: 0.002, holdFrames: 60, bob: 0.004 } as const;

/** Advances the suspension by one frame. `maxSpeed` = the vehicle's cruise speed (normalises the acceleration). Returns the same state object. */
export function stepSuspension(s: Suspension, heading: number, speed: number, maxSpeed: number): Suspension {
  if (!s.init) { s.init = true; s.heading = heading; s.speed = speed; return s; }
  const turn = angleDelta(s.heading, heading), dv = (speed - s.speed) / Math.max(0.001, maxSpeed);
  const moving = speed > 1e-4 ? clamp(speed / Math.max(0.001, maxSpeed), 0, 1) : 0;
  // leaning outwards in a turn (right turn = positive turn about +y: the body rolls to the left), nose down when braking, nose up when accelerating
  const rollT = clamp(-turn * SUSP.rollGain * moving, -SUSP.maxRoll, SUSP.maxRoll), pitchT = clamp(-dv * SUSP.pitchGain * 10, -SUSP.maxPitch, SUSP.maxPitch);
  s.roll += (rollT - s.roll) * SUSP.ease; s.pitch += (pitchT - s.pitch) * SUSP.ease;
  s.braking = brakeLight(s, dv, speed < maxSpeed * 0.02);
  s.heading = heading; s.speed = speed;
  return s;
}
/** Small vertical bump (tiles) from the distance driven and a per-vehicle phase; zero when standing. */
export const bumpBob = (dist: number, id: number, speed: number): number => (speed > 1e-4 ? SUSP.bob * Math.sin(dist * 3 + id) : 0);

/** Brake light state with hysteresis: lit by a speed drop (re-armed by each further drop) or standing still; off once the speed has not dropped for `holdFrames` frames. Cruising slowly never lights it. */
export function brakeLight(s: Pick<Suspension, 'braking' | 'quiet'>, dv: number, stopped: boolean): boolean {
  if (stopped || dv < -SUSP.dropDv) { s.quiet = 0; return true; }
  s.quiet++;
  return s.braking && s.quiet < SUSP.holdFrames;
}

/**
 * Roof snow of a parked / driven road vehicle (render only, 0..1 cover). Driven vehicles shed it (faster the faster they go), a vehicle standing in the sun melts it slowly,
 * a vehicle standing in the shade / at night keeps it. Per-vehicle `k` (0.8..1.2 from the id hash) de-synchronises a car park. No sim state.
 */
export const SNOW_COVER = { shedPerSec: 1 / 25, meltPerSec: 1 / 80, levels: 8 } as const;
export function stepSnowCover(cover: number, dt: number, speedFrac: number, sun: number, k = 1): number {
  const moving = clamp(speedFrac, 0, 1), rate = moving > 0.05 ? SNOW_COVER.shedPerSec * (0.4 + 0.6 * moving) : SNOW_COVER.meltPerSec * clamp(sun, 0, 1);
  return clamp(cover - dt * rate * k, 0, 1);
}
/** Quantised snow level 0..levels (the renderer keeps one shared material per level: per-vehicle look, no extra draw call). */
export const snowLevel = (cover: number): number => Math.round(clamp(cover, 0, 1) * SNOW_COVER.levels);
/** Starting cover of a new vehicle: 0.75..1 from its id (not every roof is equally covered). */
export const startCover = (id: number): number => 0.75 + 0.25 * (((Math.imul(id + 7, 0x9e3779b1) >>> 12) & 255) / 255);
export const meltFactor = (id: number): number => 0.8 + 0.4 * (((Math.imul(id + 13, 0x85ebca6b) >>> 10) & 255) / 255);
