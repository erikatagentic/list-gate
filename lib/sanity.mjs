// sanity.mjs: whole-list checks. Each one looks at the list as a set, not row by row, and
// each failure is a hard stop for the gate.
//
//   floor cluster       a size column where most rows sit in a narrow band at a round number.
//                       One real list had 47 of 50 rows with a company figure between 300 and
//                       310, right on the search filter's floor. That's the fingerprint of a
//                       ">= 300, sorted ascending, take 50" pull, so the list doesn't cover the
//                       range it was sold as. Every row looks fine on its own.
//   domain share        one root domain owning too many rows
//   blank column        a column that is empty on most rows
//   domain count        the domains sent to the mail-server check must equal the domains that
//                       came back classed. A parsing bug once dropped 151 of 1,268 domains (12%)
//                       and the run still said success. This check makes that loss loud.
import { registrableDomain } from './match-keys.mjs';

export const NUMERIC_COLUMN = /employee|headcount|company_size|staff_count|revenue/i;
const NOT_A_FIGURE = /_range|_bucket|_band|_status/i;
export const MIN_VALUES = 20;           // fewer usable values than this and the shape can't be judged
export const BAND_SHARE = 0.5;          // more than half the rows within 10% of the minimum
export const DOMAIN_SHARE = 0.25;       // one root domain on more than a quarter of the rows...
export const DOMAIN_MIN_ROWS = 5;       // ...and on at least this many rows
export const BLANK_SHARE = 0.5;         // a column empty on more than half the rows

const pct = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
const roundFloor = (n) => n % 50 === 0 || [100, 250, 300, 500, 1000].includes(n);

/** header: column names. records: [{row, record}] */
export function checkFloorCluster(header, records) {
  const name = 'numeric column clustered at a floor';
  const findings = [];
  const skipped = [];
  const checked = [];
  for (const col of header) {
    if (!NUMERIC_COLUMN.test(col) || NOT_A_FIGURE.test(col)) continue;
    const vals = records
      .map((r) => Number(String(r.record[col] ?? '').replace(/,/g, '')))
      .filter((v) => Number.isFinite(v) && v > 0)
      .sort((a, b) => a - b);
    if (vals.length < MIN_VALUES) { skipped.push(`${col} (${vals.length} usable values)`); continue; }
    checked.push(col);
    const min = vals[0];
    const p10 = pct(vals, 0.1);
    const p90 = pct(vals, 0.9);
    const band = vals.filter((v) => v <= min * 1.1);
    const inBand = band.length;
    const narrow = p90 / p10 < 1.5 && roundFloor(min);
    if (inBand / vals.length > BAND_SHARE || narrow) {
      findings.push(`${col}: ${inBand} of ${vals.length} rows sit between ${min} and ${band[band.length - 1]} ` +
        `(10th to 90th percentile ${p10} to ${p90}). That's the shape of a ">= ${min}, sorted ascending" pull, ` +
        'not a natural spread');
    }
  }
  if (findings.length) return { name, status: 'FAIL', detail: findings.join('; ') };
  if (!checked.length) {
    return { name, status: 'SKIP', detail: skipped.length ? `too few values to judge: ${skipped.join(', ')}` : 'no size or revenue column' };
  }
  return { name, status: 'PASS', detail: `checked ${checked.join(', ')}` };
}

export function checkDomainShare(records) {
  const name = 'one domain owns too many rows';
  const counts = new Map();
  for (const r of records) {
    const root = registrableDomain(r.record.company_domain);
    if (!root) continue;
    if (!counts.has(root)) counts.set(root, []);
    counts.get(root).push(r.row);
  }
  const n = records.length;
  const over = [...counts].filter(([, rows]) => rows.length >= DOMAIN_MIN_ROWS && rows.length / n > DOMAIN_SHARE);
  if (over.length) {
    return { name, status: 'FAIL',
      detail: over.map(([d, rows]) => `${d} owns ${rows.length} of ${n} rows (rows ${rows.slice(0, 8).join(', ')}${rows.length > 8 ? ', ...' : ''})`).join('; ') };
  }
  const top = [...counts].sort((a, b) => b[1].length - a[1].length)[0];
  return { name, status: 'PASS', detail: top ? `largest is ${top[0]} with ${top[1].length} of ${n} rows` : 'no domains' };
}

export function checkBlankColumns(header, records) {
  const name = 'column blank on most rows';
  if (!records.length) return { name, status: 'SKIP', detail: 'no rows' };
  const blank = header
    .map((col) => ({ col, n: records.filter((r) => !String(r.record[col] ?? '').trim()).length }))
    .filter(({ n }) => n / records.length > BLANK_SHARE);
  if (blank.length) {
    return { name, status: 'FAIL', detail: blank.map(({ col, n }) => `${col} is blank on ${n} of ${records.length} rows`).join('; ') };
  }
  return { name, status: 'PASS', detail: `${header.length} columns, none blank on more than half the rows` };
}

/** domainsIn: the domains handed to the mail-server check. results: Map<domain, {cls}>. */
export function checkDomainCount(domainsIn, results) {
  const name = 'domains in = domains classed';
  const sent = new Set(domainsIn);
  const missing = [...sent].filter((d) => !results.has(d));
  const extra = [...results.keys()].filter((d) => !sent.has(d));
  const classed = [...results.values()].length;
  if (missing.length || extra.length || classed !== sent.size) {
    const parts = [`${sent.size} domains in, ${classed} classed`];
    if (missing.length) parts.push(`never classed: ${missing.slice(0, 8).join(', ')}`);
    if (extra.length) parts.push(`classed but never sent: ${extra.slice(0, 8).join(', ')}`);
    return { name, status: 'FAIL', detail: parts.join('; ') };
  }
  return { name, status: 'PASS', detail: `${sent.size} domains in, ${classed} classed` };
}
