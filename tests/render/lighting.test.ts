import { DAYS_PER_YEAR } from '@/config/balance';
import { describe, expect, it } from 'vitest';
import { lightingAt } from '@/render/Lighting';
import { speedKeyAction } from '@/ui/shortcuts';

describe('lightingAt', () => {
  it('is bright at noon, dark and bluish at midnight, warm at sunset', () => {
    const noon = lightingAt(12), night = lightingAt(0), dusk = lightingAt(18);
    expect(noon.sunIntensity).toBeGreaterThan(1.4);
    expect(night.sunIntensity).toBeLessThan(0.4);
    expect(night.background[2]).toBeGreaterThan(night.background[0]);
    expect(dusk.sunColor[0]).toBeGreaterThan(dusk.sunColor[2]);
    expect(night.night).toBeGreaterThan(0.95);
    expect(noon.night).toBeLessThan(0.05);
  });
  it('is continuous (smooth) over the day and wraps at 24h', () => {
    let prev = lightingAt(0);
    for (let h = 0.05; h <= 24.0001; h += 0.05) {
      const p = lightingAt(h);
      expect(Math.abs(p.sunIntensity - prev.sunIntensity)).toBeLessThan(0.1);
      for (let i = 0; i < 3; i++) { expect(Math.abs(p.sunDir[i]! - prev.sunDir[i]!)).toBeLessThan(0.1); expect(Math.abs(p.background[i]! - prev.background[i]!)).toBeLessThan(0.08); }
      prev = p;
    }
    expect(lightingAt(24).sunIntensity).toBeCloseTo(lightingAt(0).sunIntensity, 9);
  });
});

describe('speed keys', () => {
  it('uses Space / + - . , and never digits', () => {
    expect(speedKeyAction({ key: ' ' })).toBe('toggle');
    expect(speedKeyAction({ key: '+' })).toBe('faster');
    expect(speedKeyAction({ key: '.' })).toBe('faster');
    expect(speedKeyAction({ key: '-' })).toBe('slower');
    expect(speedKeyAction({ key: ',' })).toBe('slower');
    for (const k of '0123456789') expect(speedKeyAction({ key: k })).toBeNull();
    expect(speedKeyAction({ key: ' ', ctrlKey: true })).toBeNull();
  });
});

import { luminance, standardLights } from '@/render/Lighting';
import { seasonName, seasonTerrainSim } from '@/render/Season';
import { seasonOf, seasonYear } from '@/sim/Clock';

describe('single night model (shader uniforms and standard lights share one source)', () => {
  const ambient = (p: ReturnType<typeof lightingAt>): number => luminance([(p.shaderSky[0] + p.shaderGround[0]) / 2, (p.shaderSky[1] + p.shaderGround[1]) / 2, (p.shaderSky[2] + p.shaderGround[2]) / 2]);
  it('Lambert lights are derived from the shader values (x PI compensates three r155+ albedo/PI)', () => {
    for (let h = 0; h < 24; h += 0.5) {
      const p = lightingAt(h), L = standardLights(p);
      expect(L.hemiSky).toEqual(p.shaderSky);
      expect(L.hemiGround).toEqual(p.shaderGround);
      expect(L.sunColor).toEqual(p.shaderSun);
      // radiance of a unit-albedo surface facing up: Lambert = light*intensity/PI, shader = light
      expect((luminance(L.hemiSky) * L.hemiIntensity) / Math.PI).toBeCloseTo(luminance(p.shaderSky), 9);
    }
  });
  it('night ambient keeps >= 12% of the daytime ambient luminance (dark materials stay recognisable)', () => {
    const day = ambient(lightingAt(12));
    for (let h = 0; h < 24; h += 0.25) expect(ambient(lightingAt(h)) / day).toBeGreaterThanOrEqual(0.12);
  });
  it('a dark road (albedo 0.07 linear) at midnight is not near-black: >= 8% of its noon radiance', () => {
    const rad = (h: number): number => { const p = lightingAt(h), L = standardLights(p); return 0.07 * (luminance(L.hemiSky) * L.hemiIntensity + luminance(L.sunColor) * L.sunIntensity * 0.5) / Math.PI; };
    expect(rad(0) / rad(12)).toBeGreaterThan(0.08);
  });
});

describe('render season state matches the calendar', () => {
  it('seasonName(seasonYear(date)) === seasonOf(date) for every day of the year; Y2 day 36 is summer with no autumn tint', () => {
    for (let day = 0; day < DAYS_PER_YEAR; day++) for (const minute of [0, 720, 1439]) expect(seasonName(seasonYear({ day, minute }))).toBe(seasonOf({ day }));
    expect(seasonOf({ day: 36 })).toBe('summer');
    const st = seasonTerrainSim(seasonYear({ day: 36, minute: 1200 }), 99);
    expect(st.autumn).toBe(0);
  });
});

import { sunTimes } from '@/sim/Daylight';

describe('lightingAt follows the sun times', () => {
  for (const [name, day] of [['winter', 150], ['summer', 60], ['equinox', 15]] as const) {
    it(`${name}: continuous over the whole day incl. the sunrise / sunset boundaries, wraps at 24h`, () => {
      const sun = sunTimes(day);
      let prev = lightingAt(0, sun);
      for (let h = 0.01; h <= 24.0001; h += 0.01) {
        const p = lightingAt(h, sun);
        expect(Math.abs(p.sunIntensity - prev.sunIntensity), `${name} ${h}`).toBeLessThan(0.08);
        for (let i = 0; i < 3; i++) { expect(Math.abs(p.sunDir[i]! - prev.sunDir[i]!), `${name} ${h} dir${i}`).toBeLessThan(0.08); expect(Math.abs(p.background[i]! - prev.background[i]!)).toBeLessThan(0.05); }
        prev = p;
      }
      expect(lightingAt(24, sun).sunIntensity).toBeCloseTo(lightingAt(0, sun).sunIntensity, 9);
      for (const edge of [sun.sunrise, sun.sunset]) {
        const a = lightingAt(edge - 1e-6, sun), b = lightingAt(edge + 1e-6, sun);
        expect(Math.abs(a.sunIntensity - b.sunIntensity)).toBeLessThan(1e-3); expect(a.sunDir[1]).toBeCloseTo(b.sunDir[1], 3);
      }
    });
    it(`${name}: bright at solar noon, dark at midnight, warm glow at the horizon, the sun is up exactly between sunrise and sunset`, () => {
      const sun = sunTimes(day), noon = lightingAt((sun.sunrise + sun.sunset) / 2, sun), mid = lightingAt(0, sun);
      expect(noon.night).toBeLessThan(0.05); expect(mid.night).toBeGreaterThan(0.95);
      const dusk = lightingAt(sun.sunset, sun); expect(dusk.sunColor[0]).toBeGreaterThan(dusk.sunColor[2]);
      expect(lightingAt(sun.sunrise + 0.5, sun).night).toBeLessThan(0.7);
      // sun path: x flips sign across the day (east -> west)
      expect(lightingAt(sun.sunrise + 0.2, sun).sunDir[0]).toBeLessThan(0); expect(lightingAt(sun.sunset - 0.2, sun).sunDir[0]).toBeGreaterThan(0);
    });
  }
  it('summer sun climbs higher than the winter sun; summer evening is still lit when the winter sun has long set', () => {
    expect(lightingAt(13.25, sunTimes(60)).sunDir[1]).toBeGreaterThan(lightingAt(12.25, sunTimes(150)).sunDir[1]);
    expect(lightingAt(19, sunTimes(60)).night).toBeLessThan(0.2); expect(lightingAt(19, sunTimes(150)).night).toBeGreaterThan(0.95);
  });
  it('keeps the legacy 6/18 day when no sun times are given', () => { expect(lightingAt(12).sunIntensity).toBeGreaterThan(1.4); expect(lightingAt(0).night).toBeGreaterThan(0.95); });
});
