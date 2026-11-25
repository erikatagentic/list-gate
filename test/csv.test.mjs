import { test } from 'node:test';
import assert from 'node:assert/strict';
import { badRowWidths, mapHeaders, parseCsvRows, toCsv } from '../lib/csv.mjs';

// The comma bug: a bare split on "," shifts every later column once an earlier field holds a
// comma. On a real list that lost 151 of 1,268 domains (12%) and the run still said success.
test('a quoted field with a comma does not shift later columns', () => {
  const rows = parseCsvRows('company,company_domain\n"Lantern Moss, Inc",lanternmoss.example\n');
  assert.deepEqual(rows[1], ['Lantern Moss, Inc', 'lanternmoss.example']);
});

test('the naive split gets this exact row wrong, which is why the parser exists', () => {
  const line = '"Lantern Moss, Inc",lanternmoss.example';
  assert.notEqual(line.split(',')[1], 'lanternmoss.example');
  assert.equal(parseCsvRows(line)[0][1], 'lanternmoss.example');
});

test('escaped quotes, CRLF line ends and a byte-order mark', () => {
  const rows = parseCsvRows('\uFEFFname,domain\r\n"She said ""hi"", twice",a.example\r\n');
  assert.deepEqual(rows, [['name', 'domain'], ['She said "hi", twice', 'a.example']]);
});

test('badRowWidths names each row whose field count differs from the header', () => {
  const rows = parseCsvRows('a,b,c\n1,2,3\n1,2\n1,2,3,4\n');
  assert.deepEqual(badRowWidths(rows), [
    { row: 3, fields: 2, expected: 3 },
    { row: 4, fields: 4, expected: 3 },
  ]);
});

test('toCsv quotes only what needs it and round-trips', () => {
  const header = ['company', 'note'];
  const rows = [['Quill & Fern, Inc.', 'said "yes"'], ['Plain', 'line\nbreak']];
  const text = toCsv(header, rows);
  assert.deepEqual(parseCsvRows(text), [header, ...rows]);
  assert.ok(text.startsWith('company,note\n"Quill & Fern, Inc.","said ""yes"""'));
});

test('header aliases: Email, email_address and Work Email all read as email', () => {
  const base = ['First Name', 'Last Name', 'Full Name', 'Company', 'Website'];
  for (const h of ['Email', 'email_address', 'Work Email']) {
    const m = mapHeaders([h, ...base]);
    assert.equal(m.error, undefined, h);
    assert.equal(m.columns.email, 0, h);
    assert.equal(m.canonicalHeader[0], 'email');
    assert.equal(m.canonicalHeader[5], 'company_domain');
  }
});

test('a missing required column is an error that lists the accepted headers', () => {
  const m = mapHeaders(['email', 'first_name', 'last_name', 'full_name', 'company']);
  assert.match(m.error, /no column for company_domain/);
  assert.match(m.error, /website/);
});

test('two headers that read as the same field are refused, not first-wins', () => {
  const m = mapHeaders(['Email', 'Work Email', 'first_name', 'last_name', 'full_name', 'company', 'domain']);
  assert.match(m.error, /"Email" and "Work Email" both read as email/);
});

test('a repeated header is refused', () => {
  const m = mapHeaders(['email', 'first_name', 'last_name', 'full_name', 'company', 'domain', 'city', 'city']);
  assert.match(m.error, /repeats "city"/);
});
