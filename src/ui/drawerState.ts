export type DrawerId = 'buildings' | 'lifts' | 'paths' | 'pistes' | 'terrain' | 'landscape' | 'bulldoze' | 'view' | 'finance' | 'ops' | 'marketing' | 'pricing';
export const DRAWERS: ReadonlyArray<{ id: DrawerId; label: string; icon: string; key?: string }> = [
  { id: 'buildings', label: 'Buildings', icon: '🏠' },
  { id: 'lifts', label: 'Lifts', icon: '🚡' },
  { id: 'paths', label: 'Paths & Roads', icon: '🛣️' },
  { id: 'pistes', label: 'Pistes & Trails', icon: '⛷️' },
  { id: 'terrain', label: 'Terrain', icon: '⛰️' },
  { id: 'landscape', label: 'Landscape', icon: '🌳' },
  { id: 'bulldoze', label: 'Bulldoze', icon: '🧨', key: 'X' },
  { id: 'view', label: 'View', icon: '👁️' },
  { id: 'finance', label: 'Finance', icon: '💰' },
  { id: 'ops', label: 'Operations', icon: '🗓️' },
  { id: 'marketing', label: 'Marketing', icon: '📣' },
  { id: 'pricing', label: 'Pricing', icon: '🏷️' },
];

/** Drawers whose items place things and so show the auto-flatten toggle. */
export const FLATTEN_DRAWERS: ReadonlySet<DrawerId> = new Set(['buildings', 'lifts']);

export interface DrawerState { open: DrawerId | null }
export type DrawerEvent = { type: 'toggle'; id: DrawerId } | { type: 'close' } | { type: 'escape' };

/** Pure reducer: click toggles (opening replaces any other drawer), Esc/close closes. */
export function drawerReduce(s: DrawerState, e: DrawerEvent): DrawerState {
  switch (e.type) {
    case 'toggle': return { open: s.open === e.id ? null : e.id };
    case 'close': return { open: null };
    case 'escape': return s.open === null ? s : { open: null };
  }
}

/** Number keys 1–9 pick items only while the Buildings drawer is open (1–4 drive terraform modes only while the terraform tool is active). */
export function digitSelectsItem(open: DrawerId | null): boolean { return open === 'buildings'; }
