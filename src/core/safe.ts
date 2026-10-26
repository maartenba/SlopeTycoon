/** Run an optional subsystem's wiring; on failure log + report and return the fallback so later wiring continues. */
export function safely<T, F = null>(name: string, fn: () => T, report?: (msg: string) => void, fallback: F = null as F): T | F {
  try {
    return fn();
  } catch (err) {
    console.error(`[startup] ${name} failed`, err);
    report?.(`${name} failed to start: ${err instanceof Error ? err.message : String(err)}`);
    return fallback;
  }
}
