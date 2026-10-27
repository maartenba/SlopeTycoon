import { siteUrl } from '../ui/siteLink';
import { analytics } from './index';
import type { Consent } from './consent';

/** What the consent card / Settings toggle need (injectable for tests). */
export interface ConsentUi {
  get(): Consent;
  set(v: 'granted' | 'denied'): void;
  /** Website privacy page (relative like siteLink.ts); null when the game is not served under the site. */
  privacyUrl: string | null;
}
export function consentUi(): ConsentUi {
  const a = analytics();
  return { get: () => a.consent(), set: (v) => a.setConsent(v), privacyUrl: siteUrl('privacy/') };
}
/** Settings > Privacy toggle API (GameSettingsApi.privacy). */
export function settingsPrivacy(c: ConsentUi = consentUi()): { get(): boolean; set(on: boolean): void; url: string | null } {
  return { get: () => c.get() === 'granted', set: (on) => c.set(on ? 'granted' : 'denied'), url: c.privacyUrl };
}
