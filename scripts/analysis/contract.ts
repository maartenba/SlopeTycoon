/** `npm run analysis:contract`: prints every building / lift / campaign / guest-type contract gap (see contractLib.ts). */
import { formatContract, runContract } from './contractLib';

const t0 = Date.now();
const rows = runContract();
console.log(formatContract(rows));
console.log(`\n${rows.length} rows, ${rows.filter((r) => r.problems.length).length} with gaps, ${((Date.now() - t0) / 1000).toFixed(1)} s`);
