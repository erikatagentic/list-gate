#!/usr/bin/env node
// gate.mjs: a check that refuses to ship a bad lead list.
//
//   node gate.mjs <list.csv> [--suppress <file.csv>] [--live-dns] [--mx-fixture <file.json>]
//
// It reads the list, runs every check, and then does one of two things:
//   any check FAILs   prints each failed check with rows and reasons, writes NOTHING, exits 1
//   every check passes writes <name>.gated.csv and <name>.receipt.json next to the input, exits 0
// Exit 2 is a usage or config problem (missing file, a required column with no header).
//
// Rows can also be dropped (missing a required field, suppressed, a duplicate) or held (the
// mail-server lookup failed). Those rows leave the shipped file with a reason in the receipt,
// but they don't fail the run on their own.
//
// Mail-server lookups use a fixture (sample/mx-fixture.json) unless --live-dns is passed, so
// the demo needs no network. A domain the fixture doesn't list is held, never guessed.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { badRowWidths, mapHeaders, parseCsvRows, REQUIRED_FIELDS, toCsv } from './lib/csv.mjs';
import { displayName, emailDomain, emailKey, isEmailKey, normalizeHost, registrableDomain } from './lib/match-keys.mjs';
import { dedupRows } from './lib/dedup.mjs';
import { loadSuppression, matchSuppression } from './lib/suppression.mjs';
import { isFreemail, isRoleAddress } from './lib/freemail.mjs';
import { classifyDomains, fixtureResolver, liveResolver, MX_CLASSES } from './lib/mx.mjs';
import { checkBlankColumns, checkDomainCount, checkDomainShare, checkFloorCluster } from './lib/sanity.mjs';
import { BLOCKING, buildReceipt, formatReport, sha256 } from './lib/receipt.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_FIXTURE = path.join(HERE, 'sample', 'mx-fixture.json');

export class GateConfigError extends Error {}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * The whole gate, minus the file writes. Returns
 *   { ok, checks, header, rows, dropped, held, mxCounts, csv }
 * where csv is the cleaned list text (only meaningful when ok is true).
 */
export async function runGate({ text, suppressText = null, resolver }) {
  const table = parseCsvRows(text);
  if (table.length < 2) throw new GateConfigError('the list has no data rows');
  const mapped = mapHeaders(table[0]);
  if (mapped.error) throw new GateConfigError(mapped.error);
  const header = mapped.canonicalHeader;
  const checks = [];

  // 1. Row widths. A row with more or fewer fields than the header has shifted columns.
  const widths = badRowWidths(table);
  checks.push(widths.length
    ? { name: 'row widths match the header', status: 'FAIL',
        detail: widths.slice(0, 8).map((w) => `row ${w.row} has ${w.fields} fields, header has ${w.expected}`).join('; ') }
    : { name: 'row widths match the header', status: 'PASS', detail: `${table.length - 1} rows, ${header.length} fields each` });

  let rows = table.slice(1).map((cells, i) => ({
    row: i + 2,
    email_raw: String(cells[mapped.columns.email] ?? '').trim(),
    record: Object.fromEntries(header.map((h, j) => [h, String(cells[j] ?? '').trim()])),
  }));
  const rowsIn = rows.length;
  const dropped = [];
  const drop = (entry, reason) => dropped.push({ ...entry, reason });

  // 2. Required fields, and an email that is at least shaped like one.
  {
    const before = dropped.length;
    rows = rows.filter((entry) => {
      const missing = REQUIRED_FIELDS.filter((f) => !entry.record[f]);
      if (missing.length) { drop(entry, `missing ${missing.join(', ')}`); return false; }
      if (!isEmailKey(entry.record.email)) { drop(entry, 'email is not an address'); return false; }
      return true;
    });
    const n = dropped.length - before;
    checks.push({ name: 'required fields present', status: n ? 'DROP' : 'PASS',
      detail: n ? `${plural(n, 'row')} dropped` : `all ${REQUIRED_FIELDS.length} required fields on every row` });
  }

  // Normalise. Matching keys come from lib/match-keys.mjs; the display name sits next to the raw one.
  for (const { record } of rows) {
    record.email = emailKey(record.email);
    record.company_domain = normalizeHost(record.company_domain);
    record.domain_root = registrableDomain(record.company_domain);
    record.company_name_clean = displayName(record.company);
  }

  // 3. Suppression.
  if (suppressText === null) {
    checks.push({ name: 'suppression', status: 'SKIP', detail: 'no --suppress file given' });
  } else {
    let sup;
    try { sup = loadSuppression(suppressText); } catch (e) { throw new GateConfigError(e.message); }
    const before = dropped.length;
    rows = rows.filter((entry) => {
      const hits = matchSuppression(entry.record, sup);
      if (hits.length) { drop(entry, `suppressed ${hits.join(', ')}`); return false; }
      return true;
    });
    const n = dropped.length - before;
    const ignored = sup.ignored.length ? `; ignored ${sup.ignored.join(', ')}` : '';
    checks.push({ name: 'suppression', status: n ? 'DROP' : 'PASS',
      detail: `${plural(sup.emails.size, 'email')} and ${plural(sup.domains.size, 'domain')} suppressed, ${plural(n, 'row')} dropped${ignored}` });
  }

  // 4. Duplicates: email, LinkedIn, or the same name at the same root domain.
  {
    const result = dedupRows(rows);
    rows = result.kept;
    dropped.push(...result.dropped);
    const n = result.dropped.length;
    checks.push({ name: 'duplicates', status: n ? 'DROP' : 'PASS',
      detail: n ? `${plural(n, 'row')} dropped, first row kept` : 'no repeat people' });
  }

  // 5. Free-mail and role-address flags. Tagged, never dropped.
  {
    let free = 0, role = 0;
    for (const { record } of rows) {
      const flags = [];
      if (isFreemail(emailDomain(record.email))) { flags.push('freemail'); free++; }
      if (isRoleAddress(record.email)) { flags.push('role'); role++; }
      record.email_flags = flags.join('|');
    }
    checks.push({ name: 'free-mail and role flags', status: free || role ? 'FLAG' : 'PASS',
      detail: `${free} free-mail, ${role} role address${role === 1 ? '' : 'es'} (tagged in email_flags, kept)` });
  }

  // 6. Mail-server class. A failed lookup holds the row.
  const domainsIn = [...new Set(rows.map((r) => emailDomain(r.record.email)))];
  const results = await classifyDomains(domainsIn, resolver);
  const held = [];
  const mxCounts = Object.fromEntries(MX_CLASSES.map((c) => [c, 0]));
  for (const result of results.values()) mxCounts[result.cls] = (mxCounts[result.cls] ?? 0) + 1;
  for (const entry of rows) {
    const r = results.get(emailDomain(entry.record.email));
    entry.record.mx_class = r ? r.cls : 'lookup-failed';
    if (entry.record.mx_class === 'lookup-failed') {
      held.push({ ...entry, reason: `mail-server lookup failed (${r?.error ?? 'no result'})` });
    }
  }
  const classLine = MX_CLASSES.filter((c) => mxCounts[c]).map((c) => `${c} ${mxCounts[c]}`).join(', ');
  checks.push({ name: 'mail-server class', status: held.length ? 'HOLD' : 'PASS',
    detail: `${plural(domainsIn.length, 'domain')}: ${classLine || 'none'}${held.length ? `; ${plural(held.length, 'row')} held` : ''}` });

  // 7-10. Whole-list sanity, on the rows that survived the drops.
  checks.push(checkFloorCluster(header, rows));
  checks.push(checkDomainShare(rows));
  checks.push(checkBlankColumns(header, rows));
  checks.push(checkDomainCount(domainsIn, results));

  // 11. Something has to be left.
  const heldRows = new Set(held.map((h) => h.row));
  const shipped = rows.filter((r) => !heldRows.has(r.row));
  checks.push(shipped.length
    ? { name: 'rows left to ship', status: 'PASS', detail: `${shipped.length} of ${rowsIn}` }
    : { name: 'rows left to ship', status: 'FAIL', detail: `0 of ${rowsIn}; every row was dropped or held` });

  // Output columns: the input's, with the clean name and root domain beside their raw fields.
  // Columns the gate computes are rebuilt, so an input that already carries them can't ship stale ones.
  const computed = new Set(['company_name_clean', 'domain_root', 'email_flags', 'mx_class']);
  const outHeader = [];
  for (const h of header.filter((col) => !computed.has(col))) {
    outHeader.push(h);
    if (h === 'company') outHeader.push('company_name_clean');
    if (h === 'company_domain') outHeader.push('domain_root');
  }
  outHeader.push('email_flags', 'mx_class');
  const csv = toCsv(outHeader, shipped.map((r) => outHeader.map((h) => r.record[h] ?? '')));

  return {
    ok: !checks.some((c) => c.status === BLOCKING),
    checks, rowsIn, header: outHeader, rows: shipped, dropped, held, mxCounts, csv,
  };
}

export function outputPaths(input) {
  const dir = path.dirname(input);
  const base = path.basename(input).replace(/\.csv$/i, '');
  return { list: path.join(dir, `${base}.gated.csv`), receipt: path.join(dir, `${base}.receipt.json`) };
}

function parseArgs(argv) {
  const opts = { input: null, suppress: null, liveDns: false, fixture: DEFAULT_FIXTURE };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--suppress' || a === '--mx-fixture') {
      const v = argv[++i];
      if (!v || v.startsWith('--')) throw new GateConfigError(`${a} needs a file path`);
      if (a === '--suppress') opts.suppress = v; else opts.fixture = v;
    } else if (a === '--live-dns') opts.liveDns = true;
    else if (a.startsWith('--')) throw new GateConfigError(`unknown option ${a}`);
    else if (!opts.input) opts.input = a;
    else throw new GateConfigError(`unexpected argument ${a}`);
  }
  if (!opts.input) throw new GateConfigError('usage: node gate.mjs <list.csv> [--suppress <file.csv>] [--live-dns] [--mx-fixture <file.json>]');
  return opts;
}

const readOrFail = (file, what) => {
  try { return fs.readFileSync(file, 'utf8'); }
  catch { throw new GateConfigError(`can't read ${what}: ${file}`); }
};

export async function main(argv) {
  const opts = parseArgs(argv);
  const text = readOrFail(opts.input, 'the list');
  const suppressText = opts.suppress ? readOrFail(opts.suppress, 'the suppression file') : null;
  let resolver, resolverNote;
  if (opts.liveDns) {
    resolver = await liveResolver();
    resolverNote = 'live DNS';
  } else {
    let fixture;
    try { fixture = JSON.parse(readOrFail(opts.fixture, 'the MX fixture')); }
    catch (e) { throw e instanceof GateConfigError ? e : new GateConfigError(`the MX fixture is not JSON: ${opts.fixture}`); }
    resolver = fixtureResolver(fixture);
    resolverNote = `the fixture ${path.relative(process.cwd(), opts.fixture) || opts.fixture}`;
  }

  const result = await runGate({ text, suppressText, resolver });
  const inputName = opts.input;
  console.log(formatReport({ inputName, rowsIn: result.rowsIn, checks: result.checks, dropped: result.dropped, held: result.held, resolverNote }));
  const out = outputPaths(opts.input);

  if (!result.ok) {
    const failed = result.checks.filter((c) => c.status === BLOCKING).length;
    console.log(`\nREFUSED: ${plural(failed, 'check')} failed. No file written.`);
    const stale = [out.list, out.receipt].filter((f) => fs.existsSync(f));
    if (stale.length) console.log(`WARNING: an earlier passing run left ${stale.join(' and ')}. They are not from this run.`);
    return 1;
  }

  const receipt = buildReceipt({
    inputName, inputText: text, rowsIn: result.rowsIn, checks: result.checks,
    dropped: result.dropped, held: result.held, mxCounts: result.mxCounts,
    output: { file: path.basename(out.list), sha256: sha256(result.csv), rows: result.rows.length },
  });
  fs.writeFileSync(out.list, result.csv);
  fs.writeFileSync(out.receipt, JSON.stringify(receipt, null, 2) + '\n');
  console.log(`\nPASSED: wrote ${out.list} (${plural(result.rows.length, 'row')}) and ${out.receipt}`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (code) => { process.exitCode = code; },
    (e) => {
      if (e instanceof GateConfigError) { console.error(`list-gate: ${e.message}`); process.exitCode = 2; }
      else { console.error(e); process.exitCode = 2; }
    },
  );
}
