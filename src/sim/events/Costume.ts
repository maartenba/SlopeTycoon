import { CARNIVAL } from '../../config/festivals';

/**
 * Carnival costumes (M7.4): a deterministic share (`CARNIVAL.costumeShare`) of the guests wear a costume while the Carnival runs. A pure hash of the guest id:
 * no RNG is drawn and nothing is stored, so the sim and the render agree and a loaded game shows the same revellers.
 */
export function costumed(guestId: number): boolean {
  let h = Math.imul(guestId ^ 0x2545f491, 0x9e3779b1);
  h ^= h >>> 15; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13;
  return (h >>> 0) / 4294967296 < CARNIVAL.costumeShare;
}
