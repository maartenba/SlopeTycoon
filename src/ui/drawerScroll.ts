/** Pure helpers for the low-profile build drawer (horizontal card rail + floating info popover). */

/** px per wheel "line" / "page" for deltaMode 1 / 2. */
const LINE_PX = 16;

/**
 * Mouse-wheel (vertical) -> horizontal scroll. Returns the scrollLeft delta to apply, or null when the event should be left alone
 * (horizontal-dominant gestures such as trackpads already scroll natively, or there is nothing to scroll).
 */
export function wheelToHorizontal(e: { deltaX: number; deltaY: number; deltaMode?: number }, pageW = 400): number | null {
  if (!e.deltaY || Math.abs(e.deltaX) >= Math.abs(e.deltaY)) return null;
  const mul = e.deltaMode === 1 ? LINE_PX : e.deltaMode === 2 ? pageW : 1;
  return e.deltaY * mul;
}

/** New scrollLeft that brings [itemLeft, itemLeft+itemW) (content coordinates) fully into view with `margin`; unchanged when already visible. */
export function scrollIntoViewLeft(scrollLeft: number, viewW: number, itemLeft: number, itemW: number, margin = 8, scrollWidth = Infinity): number {
  let t = scrollLeft;
  if (itemLeft - margin < scrollLeft) t = itemLeft - margin;
  else if (itemLeft + itemW + margin > scrollLeft + viewW) t = itemLeft + itemW + margin - viewW;
  const max = Number.isFinite(scrollWidth) ? Math.max(0, scrollWidth - viewW) : Infinity;
  return Math.max(0, Math.min(max, t));
}

/** Which fade edges / arrow buttons are needed. */
export function edgeState(scrollLeft: number, clientW: number, scrollW: number): { left: boolean; right: boolean } {
  return { left: scrollLeft > 1, right: scrollLeft + clientW < scrollW - 1 };
}

/** Left offset (inside the drawer, width `boundsW`) of a popover of width `popW` anchored to a card: aligned to the card's left edge, flipped to its right edge when it would overflow, then clamped on-screen. */
export function popoverLeft(anchorLeft: number, anchorW: number, popW: number, boundsW: number, margin = 0): number {
  let l = anchorLeft;
  if (l + popW > boundsW - margin) l = anchorLeft + anchorW - popW;
  return Math.max(margin, Math.min(l, boundsW - popW - margin));
}
