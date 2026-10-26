export interface ShortcutGroup { title: string; items: Array<[keys: string, action: string]> }

/** Single source of truth for the help overlay. Keep in sync with the tools' key handlers. */
export const SHORTCUTS: ShortcutGroup[] = [
  { title: 'Camera', items: [['W A S D / arrows', 'Pan'], ['Q / E', 'Rotate 90°'], ['Wheel', 'Zoom'], ['Middle/right drag', 'Pan'], ['Alt + drag', 'Free rotate']] },
  { title: 'Tool dock (bottom)', items: [['Dock button', 'Open one drawer; click again or Esc to close'], ['1 – 9', 'Pick the Nth item, only while the Buildings drawer is open'], ['Hover an item', 'Info card: cost, upkeep, footprint, requirements']] },
  { title: 'Terraform (only while the Terrain drawer is open)', items: [['1 2 3 4', 'Raise / Lower / Flatten / Smooth'], ['[ ]', 'Brush size'], ['C', 'Tile / corner target']] },
  { title: 'Trees (Terrain drawer: Plant / Clear)', items: [['1 / 2', 'Plant / Clear brush (while the tree tool is active)'], ['G', 'Cycle species group'], ['[ ]', 'Brush size'], ['Drag', 'Paint saplings (they grow over ~4 months); never on pistes, paths, buildings, water']] },
  { title: 'Landscape (Landscape drawer: Water / Terrain / Nature / Decor)', items: [['1-6', 'Dig pond / Fill in / Boulders / Remove boulders / Decor / Remove decor (while the landscape tool is active)'], ['Drag', 'Pond: drag a rectangle (3–11 tiles) on level ground; decor: drag to draw a row (hedge, fence, wall edge a path)'], ['[ ]', 'Pond size / boulder brush'], ['R', 'Turn the decor piece']] },
  { title: 'Build', items: [['Buildings drawer', 'Pick a building (tabs by type)'], ['R / Shift+R', 'Rotate the ghost clockwise / back (also the ⟲ ⟳ buttons in the drawer header; Rotate button in the inspector for placed buildings)'], ['F', 'Auto-flatten (also in drawer header)'], ['Shift + click', 'Place several'], ['X', 'Bulldoze (buildings, lifts, paths, pistes)']] },
  { title: 'Lifts', items: [['Lifts drawer', 'Pick type, click bottom then top station'], ['F', 'Auto-flatten stations']] },
  { title: 'Paths, roads & pistes', items: [['Paths / Pistes drawers', 'Footpath / Road / Rail / pistes'], ['Drag', 'Draw'], ['R', 'Flip L-corner']] },
  { title: 'Ride-along (guest inspector: Ride along)', items: [['Esc', 'Exit: back to the exact iso view'], ['N', 'Next guest'], ['C', 'Recentre the view'], ['Drag', 'Look around (±100° / ±60°)'], ['Wheel', 'Field of view'], ['Space + - . ,', 'Time controls keep working']] },
  { title: 'Photo mode (P, camera button in the top bar or View drawer)', items: [['P', 'Enter photo mode (from the iso view or a ride-along); P or Esc exits and restores the exact previous view'], ['Drag / wheel', 'Orbit / zoom'], ['W A S D / arrows, right-drag', 'Move the focus (Shift = fast)'], ['Q / E', 'Lower / raise the focus'], ['Enter', 'Save the photo (a PNG download to your device; nothing is uploaded)'], ['Space + - . ,', 'Time controls keep working']] },
  { title: 'Walk mode (V, 🚶 button in the top bar / View drawer, "Walk here" in a building inspector)', items: [['V', 'Enter walk mode on the nearest footpath to the view centre (never in the forest); V or Esc exits and restores the exact previous iso view'], ['Shift+V / 🚶 button', 'Choose start (Street View style): a figure follows the cursor and a ring shows the tile (green = walkable, red = blocked: you drop at the nearest free spot). Click to drop in, Enter = nearest path, Esc cancels. You can also drag the 🚶 button onto the map'], ['T', 'Teleport: back to a bird\'s-eye view to choose a new start (Esc returns to where you were)'], ['W A S D / arrows', 'Walk'], ['Drag (hold the left button)', 'Look around; the cursor is never captured. Settings > Walk: mouse look = Pointer lock for the immersive mode'], ['Alt', 'Pointer-lock mode only: hold to free the mouse (Esc also leaves walk mode)'], ['Shift', 'Run (hold, or toggle in Settings)'], ['Space', 'Hop'], ['E', 'Interact: inspect the building / guest in front; board a lift at its bottom station (a cosmetic ride: you are not a guest, nothing is charged or queued)'], ['P', 'Photo mode from the walker\'s eye (returns to walking)'], ['+ - . ,', 'Time controls keep working']] },
  { title: 'Time (never conflicts with the 1–9 item keys)', items: [['Space', 'Pause / resume'], ['+ / .', 'Faster'], ['- / ,', 'Slower'], ['K', 'Skip to the next month (fast-forward); the ⏭ button next to the speed buttons also offers Next season and Next event. Esc / Space / any click cancels; it stops by itself on important news. Not in ride-along, walk or photo mode, nor in the tutorial'], ['HUD buttons', 'Pause, 1× (day ≈ 2½ min), 3× (≈ 50 s), 10× (≈ 15 s); tools still work while paused'], ['🌙 button', 'Fast nights: nights pass ~3× faster (smooth ramp 20:30-21:30 and 05:30-06:30; 🌙» shows while warping). Only the pace changes, not the simulation']] },
  { title: 'View', items: [['O', 'Cycle map overlay'], ['G', 'Tile grid (not while the tree tool is active: G cycles species there)'], ['B', 'Building gallery (debug)'], ['F3', 'Debug panel']] },
  { title: 'General', items: [['Click', 'Select a building or lift (default Select tool; never edits terrain)'], ['Esc / right-click', 'Cancel tool, back to Select; with nothing to cancel, Esc opens the pause menu (Resume, Save game, Load game, Settings, Help, Main menu); in dialogs Esc closes the top-most one'], ['⌂ Menu (top bar)', 'Back to the main menu (autosaves first)'], ['Ctrl+Z / Cmd+Z, Ctrl+Shift+Z / Ctrl+Y', 'Undo / redo the last build action (buildings, lifts, paths, roads, pistes, terraforming, planting, bulldozes; last 10, same in-game day only; refused across a day boundary, while guests are inside, if funds are short or the ground changed)'], ['Ctrl+S', 'Save game: opens the Save dialog (also the Save button in the top bar and Save game in the pause menu)'], ['F5 / F9', 'Quicksave / quickload (Save / Load dialog: slots, export/import .slope files; autosave every in-game month)'], ['M', 'Mute / unmute all sound (⚙ in the top bar opens volume settings)'], ['? or H', 'This help']] },
  { title: 'Install & offline (PWA)', items: [['Install app', 'Chrome / Edge: the ⤓ Install button in the top bar, when offered'], ['iPhone / iPad', 'Safari: Share → Add to Home Screen (iOS has no install button)'], ['Offline', 'After the first online visit the game and your saves work without a network (an Offline pill shows in the top bar)']] },
];

export type SpeedKeyAction = 'toggle' | 'faster' | 'slower';

/** Time-control keys: Space, '+'/'=' or '.', '-'/'_' or ','. Digits are deliberately NOT used (terraform modes and drawer items own 1–9). */
export function speedKeyAction(e: { key: string; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean }): SpeedKeyAction | null {
  if (e.ctrlKey || e.metaKey || e.altKey) return null;
  switch (e.key) {
    case ' ': return 'toggle';
    case '+': case '=': case '.': return 'faster';
    case '-': case '_': case ',': return 'slower';
    default: return null;
  }
}

/**
 * Machine-readable key registry (Task 35). One row per physical key in a CONTEXT (the set of handlers that can be live at the same time).
 * tests/ui/shortcuts.test.ts asserts: no key is bound twice inside one context, and a key bound in 'global' is not rebound by any context
 * that can be active together with it (unless the global handler is explicitly gated, see `gatedBy`).
 */
export type KeyContext = 'global' | 'drawer' | 'terraform' | 'plant' | 'landscape' | 'build' | 'lift' | 'path' | 'ride' | 'photo' | 'walk';
export interface KeyBinding { key: string; context: KeyContext; action: string; /** Tool in which the global binding is suppressed. */ gatedBy?: KeyContext }
export const KEY_BINDINGS: readonly KeyBinding[] = [
  { key: 'w', context: 'global', action: 'pan up' }, { key: 'a', context: 'global', action: 'pan left' }, { key: 's', context: 'global', action: 'pan down' }, { key: 'd', context: 'global', action: 'pan right' },
  { key: 'ArrowUp', context: 'global', action: 'pan up' }, { key: 'ArrowDown', context: 'global', action: 'pan down' }, { key: 'ArrowLeft', context: 'global', action: 'pan left' }, { key: 'ArrowRight', context: 'global', action: 'pan right' },
  { key: 'q', context: 'global', action: 'rotate left' }, { key: 'e', context: 'global', action: 'rotate right' },
  { key: ' ', context: 'global', action: 'pause' }, { key: '+', context: 'global', action: 'faster' }, { key: '=', context: 'global', action: 'faster' }, { key: '.', context: 'global', action: 'faster' },
  { key: 'k', context: 'global', action: 'skip to next month (fast-forward)' }, { key: '-', context: 'global', action: 'slower' }, { key: '_', context: 'global', action: 'slower' }, { key: ',', context: 'global', action: 'slower' },
  { key: 'o', context: 'global', action: 'cycle overlay' }, { key: 'g', context: 'global', action: 'tile grid', gatedBy: 'plant' }, { key: 'b', context: 'global', action: 'model gallery (debug)' },
  { key: 'x', context: 'global', action: 'bulldoze' }, { key: 'm', context: 'global', action: 'mute' }, { key: '?', context: 'global', action: 'help' }, { key: 'h', context: 'global', action: 'help' },
  { key: 'p', context: 'global', action: 'photo mode (enter / exit)' }, { key: 'F3', context: 'global', action: 'debug panel' }, { key: 'F5', context: 'global', action: 'quicksave' }, { key: 'F9', context: 'global', action: 'quickload' }, { key: 'Ctrl+S', context: 'global', action: 'save dialog' }, { key: 'Ctrl+Z', context: 'global', action: 'undo last build action' }, { key: 'Ctrl+Y', context: 'global', action: 'redo (also Ctrl+Shift+Z)' }, { key: 'Escape', context: 'global', action: 'cancel / pause menu' },
  { key: '1-9', context: 'drawer', action: 'pick Nth item (Buildings drawer open)' },
  { key: '1', context: 'terraform', action: 'raise' }, { key: '2', context: 'terraform', action: 'lower' }, { key: '3', context: 'terraform', action: 'flatten' }, { key: '4', context: 'terraform', action: 'smooth' },
  { key: '[', context: 'terraform', action: 'brush -' }, { key: ']', context: 'terraform', action: 'brush +' }, { key: 'c', context: 'terraform', action: 'tile/corner' },
  { key: '1', context: 'plant', action: 'plant' }, { key: '2', context: 'plant', action: 'clear' }, { key: 'g', context: 'plant', action: 'cycle species' }, { key: '[', context: 'plant', action: 'brush -' }, { key: ']', context: 'plant', action: 'brush +' },
  { key: '1-6', context: 'landscape', action: 'pond / fill / boulders / remove boulders / decor / remove decor' }, { key: '[', context: 'landscape', action: 'size -' }, { key: ']', context: 'landscape', action: 'size +' }, { key: 'r', context: 'landscape', action: 'turn decor' },
  { key: 'r', context: 'build', action: 'rotate' }, { key: 'f', context: 'build', action: 'auto-flatten' },
  { key: 'f', context: 'lift', action: 'auto-flatten' },
  { key: 'n', context: 'ride', action: 'next guest' }, { key: 'c', context: 'ride', action: 'recentre the view' },
  { key: 'w', context: 'photo', action: 'move forward' }, { key: 'a', context: 'photo', action: 'move left' }, { key: 's', context: 'photo', action: 'move back' }, { key: 'd', context: 'photo', action: 'move right' }, { key: 'q', context: 'photo', action: 'lower focus' }, { key: 'e', context: 'photo', action: 'raise focus' }, { key: 'Enter', context: 'photo', action: 'save photo' }, { key: 'Escape', context: 'photo', action: 'exit photo mode' },
  { key: 'v', context: 'global', action: 'walk mode (enter at the nearest path; exits while walking)' }, { key: 'Shift+V', context: 'global', action: 'walk: choose start (drop mode)' },
  { key: 'w', context: 'walk', action: 'walk forward' }, { key: 'a', context: 'walk', action: 'strafe left' }, { key: 's', context: 'walk', action: 'walk back' }, { key: 'd', context: 'walk', action: 'strafe right' }, { key: 'Shift', context: 'walk', action: 'run' }, { key: ' ', context: 'walk', action: 'hop' }, { key: 'e', context: 'walk', action: 'interact / board a lift' }, { key: 'p', context: 'walk', action: 'photo mode' }, { key: 't', context: 'walk', action: 'teleport (choose start again)' }, { key: 'Alt', context: 'walk', action: 'free the mouse (pointer-lock mode)' }, { key: 'Escape', context: 'walk', action: 'exit walk mode' },
  { key: 'r', context: 'path', action: 'flip corner' },
];
