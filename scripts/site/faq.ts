import type { FaqItem } from './md';
/** Landing-page FAQ (inline markdown answers; `{version}` is replaced). The visible list and the FAQPage JSON-LD are both built from this. */
export const landingFaq = (version: string): FaqItem[] => [
  { q: 'Is there a ski resort tycoon game you can play in the browser?', a: 'Yes, this one. Slope Tycoon runs in a browser tab on a laptop or desktop: shape the terrain, build lifts and pistes, and run a mountain resort through winter and summer. See [play a ski resort tycoon in your browser](lp:ski-resort-tycoon).' },
  { q: 'Is there a Ski Resort Tycoon 2?', a: 'There was a sequel to the 2000 game, but this is not it. Slope Tycoon is an independent game inspired by the classic, not an official sequel. See [Ski Resort Tycoon online](lp:ski-resort-tycoon) and [play ski games online](lp:play-ski-games-online) for what is out there.' },
  { q: 'Is it free? Do I need an account?', a: 'It is free, and there are no accounts and no ads. Saves stay on your device.' },
  { q: 'Is anything tracked?', a: 'Only if you allow it. Anonymous usage statistics (Google Analytics) stay off until you click Allow, and they never include names, saves or text. See [Privacy & analytics](lp:privacy).' },
  { q: 'Does it work on my phone or tablet?', a: 'Yes, with touch support: one-finger pan, pinch to zoom, two-finger twist to rotate and a two-step placement so nothing is built by accident. Tablets are comfortable and phones are playable, but the game is still best on a desktop with a mouse. See [Touch & tablets](page:touch).' },
  { q: 'Can I play offline?', a: 'Yes. Open the game once while online and it caches itself. Install it as an app for a home-screen icon.' },
  { q: 'Where are my saves?', a: 'In your browser storage on this device. Use Save / Load, then Export, to keep a .slope file as a backup or to move to another computer.' },
  { q: 'Is it like the original Ski Resort Tycoon?', a: 'It is an independent game and not affiliated with it, but it was inspired by it. You build lifts, pistes and a village and keep guests happy. This one is 3D and has real months and a summer half. See [games like Ski Resort Tycoon](lp:games-like-ski-resort-tycoon).' },
  { q: 'Does the game use real months?', a: 'Yes. A year is 180 days in twelve real months, northern hemisphere: winter December to March, spring April and May, summer June to September, autumn October and November. Festivals, daylight and the snow line follow that calendar.' },
  { q: 'Is it finished?', a: `It is a pre-release (v${version}). Expect rough edges, and read the [devlog](lp:devlog) to see what changes.` },
];
