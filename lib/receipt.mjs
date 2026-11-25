// receipt.mjs: the hash, the receipt object and the printed report.
import { createHash } from 'node:crypto';

export const sha256 = (text) => createHash('sha256').update(text).digest('hex');

// Statuses: FAIL blocks the list. DROP, HOLD and FLAG report what happened to rows and never
// block on their own. PASS and SKIP are what they say.
export const BLOCKING = 'FAIL';

export function buildReceipt({ inputName, inputText, rowsIn, checks, dropped, held, mxCounts, output }) {
  const receipt = {
    tool: 'list-gate',
    input: inputName,
    input_sha256: sha256(inputText),
    generated_at: new Date().toISOString(),
    rows_in: rowsIn,
    rows_out: output?.rows ?? 0,
    rows_dropped: dropped.length,
    rows_held: held.length,
    checks: checks.map(({ name, status, detail }) => ({ name, status, detail })),
    mx_classes: mxCounts,
    dropped: dropped.map(compactRow),
    held: held.map(compactRow),
  };
  if (output) receipt.output = { file: output.file, sha256: output.sha256 };
  return receipt;
}

function compactRow(d) {
  const out = { row: d.row, reason: d.reason, email: d.email_raw ?? d.record?.email ?? '' };
  if (d.kept_row !== undefined) out.kept_row = d.kept_row;
  return out;
}

export function formatReport({ inputName, rowsIn, checks, dropped, held, resolverNote }) {
  const width = Math.max(...checks.map((c) => c.name.length));
  const lines = [`list-gate: ${inputName} (${rowsIn} rows in, mail servers from ${resolverNote})`, ''];
  for (const c of checks) lines.push(`  ${c.status.padEnd(4)}  ${c.name.padEnd(width)}  ${c.detail}`);
  const rowLine = (d) => `  row ${String(d.row).padEnd(4)} ${d.reason}${d.kept_row ? ` (same person as row ${d.kept_row})` : ''}  ${d.email_raw ?? d.record?.email ?? ''}`;
  if (dropped.length) lines.push('', 'Dropped rows:', ...dropped.map(rowLine));
  if (held.length) lines.push('', 'Held rows (not shipped, not checked):', ...held.map(rowLine));
  return lines.join('\n');
}
