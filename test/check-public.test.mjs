import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { scanDir, scanText } from '../scripts/check-public.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Every planted value is built from pieces, so this file itself stays clean.
const j = (...parts) => parts.join('');
const labels = (text) => scanText(text).map((h) => h.label);

test('flags phone numbers in the common US shapes', () => {
  assert.deepEqual(labels(j('call 555', '-201-', '3344')), ['phone']);
  assert.deepEqual(labels(j('(555) ', '201.', '3344')), ['phone']);
  assert.deepEqual(labels(j('+1', '55520', '13344')), ['phone']);
  assert.deepEqual(labels('151 of 1,268 domains, 47 of 50 rows, 300 to 310'), []);
});

test('flags private network addresses', () => {
  assert.deepEqual(labels(j('host ', '10.', '0.4.17')), ['private IP']);
  assert.deepEqual(labels(j('192.', '168.1.20')), ['private IP']);
  assert.deepEqual(labels(j('172.', '20.0.9')), ['private IP']);
  assert.deepEqual(labels('version 1.2.3.4 of 172.40.1.1'), []);
});

test('flags internal hostnames and chat webhooks', () => {
  assert.deepEqual(labels(j('https://build-box', '.onrender', '.com/x')), ['internal host']);
  assert.deepEqual(labels(j('api-box', '.fly', '.dev')), ['internal host']);
  assert.deepEqual(labels(j('https://flows-', 'n8n', '.acme.io/webhook')), ['internal host']);
  assert.deepEqual(labels(j('https://hooks', '.slack', '.com/services/x')), ['webhook']);
});

test('flags a key-shaped name with a value, and hides the value', () => {
  const hits = scanText(j('DB', '_PASSWORD=', 'hunter22'));
  assert.deepEqual(hits.map((h) => [h.label, h.match]), [['key with value', '[value hidden]']]);
  assert.deepEqual(labels(j('const sort', '_key = ', '"abcd"')), ['key with value']);
  assert.deepEqual(labels(j('set the ', 'API', '_KEY in your shell')), []);
});

test('flags any email outside the example domains and the one contact address', () => {
  assert.deepEqual(labels(j('jo@', 'realcorp', '.com')), ['email']);
  assert.deepEqual(labels('dana@acme.example, x@y.test, a@example.com, b@mail.example.org'), []);
  assert.deepEqual(labels('erik@erikhernal.com'), []);
  assert.deepEqual(labels(j('jo@', 'badexample', '.com')), ['email']);
});

test('walks a folder, skips .git and node_modules, and names the file and line', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-public-'));
  fs.mkdirSync(path.join(dir, '.git'));
  fs.mkdirSync(path.join(dir, 'node_modules'));
  fs.writeFileSync(path.join(dir, '.git', 'config'), j('jo@', 'realcorp', '.com'));
  fs.writeFileSync(path.join(dir, 'node_modules', 'x.js'), j('jo@', 'realcorp', '.com'));
  fs.writeFileSync(path.join(dir, 'notes.md'), j('fine line\nmail jo@', 'realcorp', '.com\n'));
  const hits = scanDir(dir);
  assert.deepEqual(hits.map((h) => [h.file, h.line, h.label]), [['notes.md', 2, 'email']]);
});

test('this repo passes its own check', () => {
  const res = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'check-public.mjs'), ROOT], { encoding: 'utf8' });
  assert.equal(res.status, 0, res.stdout);
});
