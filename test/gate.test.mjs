import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { GateConfigError, runGate } from '../gate.mjs';
import { fixtureResolver } from '../lib/mx.mjs';
import { parseCsvRows } from '../lib/csv.mjs';
import { sha256 } from '../lib/receipt.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SAMPLE = path.join(ROOT, 'sample');
const read = (f) => fs.readFileSync(path.join(SAMPLE, f), 'utf8');
const fixture = JSON.parse(read('mx-fixture.json'));
const resolver = fixtureResolver(fixture);

const HEADER = 'email,first_name,last_name,full_name,company,company_domain,title';
const tiny = (...lines) => [HEADER, ...lines].join('\n') + '\n';
const tinyResolver = fixtureResolver({ mx: { 'acme.example': ['aspmx.l.google.com.example'], 'birch.example': ['mx1.birch.example'] } });

function tmpCopy(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'list-gate-'));
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), text);
  return dir;
}
const runCli = (args, cwd = ROOT) => spawnSync(process.execPath, [path.join(ROOT, 'gate.mjs'), ...args], { cwd, encoding: 'utf8' });

test('the bad sample fails on the clustered size column, drops the hidden duplicate and holds the failed lookup', async () => {
  const r = await runGate({ text: read('bad-list.csv'), resolver });
  assert.equal(r.ok, false);
  const failed = r.checks.filter((c) => c.status === 'FAIL').map((c) => c.name);
  assert.deepEqual(failed, ['numeric column clustered at a floor']);
  const dupe = r.dropped.find((d) => d.reason === 'duplicate:email');
  assert.equal(dupe.row, 37);
  assert.equal(dupe.kept_row, 6);
  assert.equal(dupe.email_raw, 'LMarrowby@northfold.example');
  assert.deepEqual(r.held.map((h) => [h.row, h.reason]), [[3, 'mail-server lookup failed (ESERVFAIL)']]);
});

test('the good sample passes and ships every row with the computed columns beside their raw fields', async () => {
  const r = await runGate({ text: read('good-list.csv'), resolver });
  assert.equal(r.ok, true, JSON.stringify(r.checks.filter((c) => c.status === 'FAIL')));
  assert.equal(r.rows.length, 30);
  const header = parseCsvRows(r.csv)[0];
  assert.equal(header[header.indexOf('company') + 1], 'company_name_clean');
  assert.equal(header[header.indexOf('company_domain') + 1], 'domain_root');
  assert.deepEqual(header.slice(-2), ['email_flags', 'mx_class']);
  const out = parseCsvRows(r.csv).slice(1);
  assert.ok(out.some((row) => row[header.indexOf('company_name_clean')] === 'Westbrook Roofing'));
  assert.ok(out.some((row) => row[header.indexOf('email_flags')] === 'role'));
  assert.ok(out.every((row) => !row[header.indexOf('company_domain')].startsWith('http')));
});

test('a row missing a required field, or with a non-address email, is dropped with a reason', async () => {
  const r = await runGate({ resolver: tinyResolver, text: tiny(
    'dana@acme.example,Dana,Rowe,Dana Rowe,Acme,acme.example,CEO',
    'ivo@acme.example,Ivo,,Ivo Raskin,Acme,acme.example,CTO',
    'n/a,Bea,Lund,Bea Lund,Birch,birch.example,COO',
  ) });
  assert.deepEqual(r.dropped.map((d) => [d.row, d.reason]), [[3, 'missing last_name'], [4, 'email is not an address']]);
  assert.equal(r.rows.length, 1);
});

test('a row with more fields than the header fails the run', async () => {
  const r = await runGate({ resolver: tinyResolver, text: tiny(
    'dana@acme.example,Dana,Rowe,Dana Rowe,Acme, Inc,acme.example,CEO',
  ) });
  assert.equal(r.ok, false);
  assert.match(r.checks.find((c) => c.name === 'row widths match the header').detail, /row 2 has 8 fields, header has 7/);
});

test('suppression drops matching rows with the reason', async () => {
  const r = await runGate({ resolver: tinyResolver, suppressText: 'type,value\ndomain,birch.example\n', text: tiny(
    'dana@acme.example,Dana,Rowe,Dana Rowe,Acme,acme.example,CEO',
    'bea@birch.example,Bea,Lund,Bea Lund,Birch,www.birch.example,COO',
  ) });
  assert.deepEqual(r.dropped.map((d) => d.reason), ['suppressed domain:birch.example']);
  assert.equal(r.ok, true);
});

test('a lookup-failed row is held out of the shipped list even when the run passes', async () => {
  const r = await runGate({ resolver: tinyResolver, text: tiny(
    'dana@acme.example,Dana,Rowe,Dana Rowe,Acme,acme.example,CEO',
    'cy@cedar.example,Cy,Moss,Cy Moss,Cedar,cedar.example,CFO',
  ) });
  assert.equal(r.ok, true);
  assert.deepEqual(r.held.map((h) => h.row), [3]);
  assert.ok(!r.csv.includes('cedar.example'));
  assert.equal(r.rows.length, 1);
});

test('when every row is held, nothing is left to ship and the run fails', async () => {
  const r = await runGate({ resolver: fixtureResolver({ mx: {} }), text: tiny(
    'dana@acme.example,Dana,Rowe,Dana Rowe,Acme,acme.example,CEO',
  ) });
  assert.equal(r.ok, false);
  assert.equal(r.checks.find((c) => c.name === 'rows left to ship').status, 'FAIL');
});

test('a list with no column for a required field is a config error', async () => {
  await assert.rejects(runGate({ resolver: tinyResolver, text: 'email,company\na@acme.example,Acme\n' }), GateConfigError);
});

test('CLI: a failing list writes nothing and exits 1', () => {
  const dir = tmpCopy({ 'list.csv': read('bad-list.csv') });
  const res = runCli([path.join(dir, 'list.csv')]);
  assert.equal(res.status, 1, res.stderr);
  assert.match(res.stdout, /FAIL {2}numeric column clustered at a floor/);
  assert.match(res.stdout, /REFUSED: 1 check failed\. No file written\./);
  assert.deepEqual(fs.readdirSync(dir), ['list.csv']);
});

test('CLI: a passing list writes the cleaned list and a receipt that matches it', () => {
  const dir = tmpCopy({ 'list.csv': read('good-list.csv'), 'sup.csv': read('suppress.csv') });
  const res = runCli([path.join(dir, 'list.csv'), '--suppress', path.join(dir, 'sup.csv')]);
  assert.equal(res.status, 0, res.stdout + res.stderr);
  assert.deepEqual(fs.readdirSync(dir).sort(), ['list.csv', 'list.gated.csv', 'list.receipt.json', 'sup.csv']);
  const receipt = JSON.parse(fs.readFileSync(path.join(dir, 'list.receipt.json'), 'utf8'));
  const gated = fs.readFileSync(path.join(dir, 'list.gated.csv'), 'utf8');
  assert.equal(receipt.input_sha256, sha256(read('good-list.csv')));
  assert.equal(receipt.output.sha256, sha256(gated));
  assert.equal(receipt.rows_in, 30);
  assert.equal(receipt.rows_out, parseCsvRows(gated).length - 1);
  assert.equal(receipt.rows_in, receipt.rows_out + receipt.rows_dropped + receipt.rows_held);
  assert.ok(receipt.dropped.every((d) => d.reason.startsWith('suppressed ')));
  assert.equal(receipt.checks.length, 11);
});

test('CLI: a fail after an earlier pass warns about the old files and leaves them alone', () => {
  const dir = tmpCopy({ 'list.csv': read('good-list.csv') });
  assert.equal(runCli([path.join(dir, 'list.csv')]).status, 0);
  const before = fs.readFileSync(path.join(dir, 'list.gated.csv'), 'utf8');
  fs.writeFileSync(path.join(dir, 'list.csv'), read('bad-list.csv'));
  const res = runCli([path.join(dir, 'list.csv')]);
  assert.equal(res.status, 1);
  assert.match(res.stdout, /WARNING: an earlier passing run left/);
  assert.equal(fs.readFileSync(path.join(dir, 'list.gated.csv'), 'utf8'), before);
});

test('CLI: usage and config problems exit 2', () => {
  assert.equal(runCli([]).status, 2);
  assert.equal(runCli(['nope.csv']).status, 2);
  const dir = tmpCopy({ 'list.csv': 'email,company\na@acme.example,Acme\n' });
  const res = runCli([path.join(dir, 'list.csv')]);
  assert.equal(res.status, 2);
  assert.match(res.stderr, /no column for/);
  assert.deepEqual(fs.readdirSync(dir), ['list.csv']);
});
