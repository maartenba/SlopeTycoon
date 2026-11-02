import type { AttractionSpec } from './Attraction';

/**
 * M7.4 sky activities (docs/m74-buildings.md). One guest = one jump / flight; `serviceTicks` is the whole trip (a jump load takes about an hour with the
 * plane's climb, a glide about 30). Open only in daylight and clear weather (AttractionSystem `skyClosed`).
 */
export const SKY_SPECS: Record<string, AttractionSpec> = {
  // [solo, couple, family, vip, budget, adventure]: adventure seekers and VIPs love the jump, families and budget guests hardly
  skydiveCentre: { kind: 'skydive', serviceTicks: 10, slots: 4, effects: { fatigue: 0.08, happiness: 0.25 }, appeal: [0.6, 0.4, 0.1, 0.7, 0.1, 1], sky: 'skydive' },
  // quieter and cheaper: a scenic flight, couples and families can enjoy it too
  launchRamp: { kind: 'glide', serviceTicks: 6, slots: 4, effects: { fatigue: 0.06, happiness: 0.18 }, appeal: [0.6, 0.55, 0.3, 0.4, 0.3, 0.95], sky: 'glide' },
};
