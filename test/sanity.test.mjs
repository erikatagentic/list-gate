import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkBlankColumns, checkDomainCount, checkDomainShare, checkFloorCluster } from '../lib/sanity.mjs';
import { parseCsvRows } from '../lib/csv.mjs';

const rowsOf = (values, col = 'employee_count') => values.map((v, i) => ({ row: i + 2, record: { [col]: String(v) } }));

test('floor cluster: 47 of 50 rows between 300 and 310 fails', () => {
  const values = [...Array.from({ length: 47 }, (_, i) => 300 + (i % 11)), 342, 415, 520];
  const r = checkFloorCluster(['employee_count'], rowsOf(values));
  assert.equal(r.status, 'FAIL');
  assert.match(r.detail, /47 of 50 rows sit between 300 and 310/);
});

test('floor cluster: a natural spread passes', () => {
  const values = Array.from({ length: 40 }, (_, i) => 10 + i * i);
  const r = checkFloorCluster(['employee_count'], rowsOf(values));
  assert.equal(r.status, 'PASS');
});

test('floor cluster: a narrow band starting on a round number fails even when under half sit right at the floor', () => {
  const values = Array.from({ length: 30 }, (_, i) => 500 + i * 7);   // 500..703, p90/p10 well under 1.5
  const r = checkFloorCluster(['headcount'], rowsOf(values, 'headcount'));
  assert.equal(r.status, 'FAIL');
});

test('floor cluster: fewer than 20 usable values is a SKIP, never a quiet PASS', () => {
  const r = checkFloorCluster(['employee_count'], rowsOf([300, 301, 302, 'n/a', '']));
  assert.equal(r.status, 'SKIP');
  assert.match(r.detail, /3 usable values/);
});

test('floor cluster: range and bucket columns are labels, not figures', () => {
  const r = checkFloorCluster(['employee_range'], rowsOf(Array(30).fill(300), 'employee_range'));
  assert.equal(r.status, 'SKIP');
});

test('floor cluster: thousands separators are read as numbers', () => {
  const values = Array.from({ length: 25 }, () => '1,000');
  assert.equal(checkFloorCluster(['revenue'], rowsOf(values, 'revenue')).status, 'FAIL');
});

test('domain share: one root domain on most rows fails', () => {
  const rows = Array.from({ length: 10 }, (_, i) => ({ row: i + 2, record: { company_domain: i < 6 ? `team${i}.acme.example` : `c${i}.example` } }));
  const r = checkDomainShare(rows);
  assert.equal(r.status, 'FAIL');
  assert.match(r.detail, /acme\.example owns 6 of 10 rows/);
});

test('domain share: a few colleagues at one firm on a small list pass', () => {
  const rows = Array.from({ length: 8 }, (_, i) => ({ row: i + 2, record: { company_domain: i < 3 ? 'acme.example' : `c${i}.example` } }));
  assert.equal(checkDomainShare(rows).status, 'PASS');
});

test('blank column: a column empty on most rows fails and is named', () => {
  const rows = Array.from({ length: 10 }, (_, i) => ({ row: i + 2, record: { email: 'a@b.example', title: i < 3 ? 'CEO' : ' ' } }));
  const r = checkBlankColumns(['email', 'title'], rows);
  assert.equal(r.status, 'FAIL');
  assert.match(r.detail, /title is blank on 7 of 10 rows/);
  rows.forEach((r2) => { r2.record.title = 'CEO'; });
  assert.equal(checkBlankColumns(['email', 'title'], rows).status, 'PASS');
});

// The comma bug, end to end: extract the domain column with a bare split, class what comes
// out, and the counts no longer add up. The run used to call that a success.
test('domain count: domains lost by a naive column split fail the count', () => {
  const csv = [
    'company,company_domain',
    '"Lantern Moss, Inc",lanternmoss.example',
    'Copperleaf Advisory,copperleaf.example',
    '"Northfold Consulting, LLC",northfold.example',
    'Tidewell Engineering,tidewell.example',
  ].join('\n');
  const sent = parseCsvRows(csv).slice(1).map((r) => r[1]);
  const naive = csv.split('\n').slice(1).map((l) => l.split(',')[1]).filter((d) => d.endsWith('.example'));
  const classed = new Map(naive.map((d) => [d, { cls: 'other' }]));
  const r = checkDomainCount(sent, classed);
  assert.equal(r.status, 'FAIL');
  assert.match(r.detail, /4 domains in, 2 classed/);
  assert.match(r.detail, /never classed: lanternmoss\.example, northfold\.example/);
});

test('domain count: a domain classed that was never sent also fails', () => {
  const r = checkDomainCount(['a.example'], new Map([['a.example', { cls: 'google' }], ['b.example', { cls: 'google' }]]));
  assert.equal(r.status, 'FAIL');
  assert.match(r.detail, /classed but never sent: b\.example/);
});

test('domain count: equal sets pass', () => {
  const r = checkDomainCount(['a.example', 'b.example'], new Map([['a.example', { cls: 'google' }], ['b.example', { cls: 'lookup-failed' }]]));
  assert.equal(r.status, 'PASS');
});
