/** Pure formatter for the on-screen input diagnostic line. */
export function describeEl(el: unknown): string {
  const e = el as { tagName?: string; id?: string; className?: unknown } | null;
  if (!e || !e.tagName) return 'none';
  const cls = typeof e.className === 'string' && e.className ? '.' + e.className.split(/\s+/).join('.') : '';
  return `${e.tagName.toLowerCase()}${e.id ? '#' + e.id : ''}${cls}`;
}

export function formatInputLine(i: { target: unknown; onCanvas: boolean; tool: string; tile: { x: number; y: number } | null; button: number }): string {
  const t = i.tile ? `${i.tile.x},${i.tile.y}` : 'none';
  return `click: target=${describeEl(i.target)}${i.onCanvas ? '' : ' (NOT canvas!)'} btn=${i.button} tool=${i.tool} tile=${t}`;
}
