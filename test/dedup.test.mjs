import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dedupRows } from '../lib/dedup.mjs';

const person = (row, fields) => ({ row, record: { email: '', full_name: '', company_domain: '', linkedin_url: '', ...fields } });

test('the same email under different casing is one person; the first row wins', () => {
  const { kept, dropped } = dedupRows([
    person(2, { email: 'leona.marrowby@northfold.example', full_name: 'Leona Marrowby', company_domain: 'northfold.example' }),
    person(9, { email: 'Leona.Marrowby@Northfold.example', full_name: 'L. Marrowby', company_domain: 'other.example' }),
  ]);
  assert.deepEqual(kept.map((k) => k.row), [2]);
  assert.equal(dropped[0].row, 9);
  assert.equal(dropped[0].reason, 'duplicate:email');
  assert.equal(dropped[0].kept_row, 2);
});

test('two spellings of one LinkedIn profile are one person', () => {
  const { dropped } = dedupRows([
    person(2, { email: 'a@one.example', linkedin_url: 'https://www.linkedin.com/in/dana-rowe/' }),
    person(3, { email: 'b@two.example', linkedin_url: 'linkedin.com/in/Dana-Rowe?trk=list' }),
  ]);
  assert.equal(dropped.length, 1);
  assert.equal(dropped[0].reason, 'duplicate:linkedin');
});

test('the same full name at the same root domain is one person, even with a new email and a sub-domain', () => {
  const { dropped } = dedupRows([
    person(2, { email: 'dana@acme.example', full_name: 'Dana Rowe', company_domain: 'https://www.acme.example/' }),
    person(3, { email: 'drowe@acme.example', full_name: 'dana  rowe', company_domain: 'eu.acme.example' }),
  ]);
  assert.equal(dropped.length, 1);
  assert.equal(dropped[0].reason, 'duplicate:name_root');
});

test('two different people at one company are two leads', () => {
  const { kept } = dedupRows([
    person(2, { email: 'dana@acme.example', full_name: 'Dana Rowe', company_domain: 'acme.example' }),
    person(3, { email: 'ivo@acme.example', full_name: 'Ivo Raskin', company_domain: 'acme.example' }),
  ]);
  assert.equal(kept.length, 2);
});

test('the same name at two different companies is two people', () => {
  const { kept } = dedupRows([
    person(2, { email: 'dana@acme.example', full_name: 'Dana Rowe', company_domain: 'acme.example' }),
    person(3, { email: 'dana@birch.example', full_name: 'Dana Rowe', company_domain: 'birch.example' }),
  ]);
  assert.equal(kept.length, 2);
});

test('a company LinkedIn page is not a person key', () => {
  const { kept } = dedupRows([
    person(2, { email: 'a@acme.example', linkedin_url: 'https://www.linkedin.com/company/acme' }),
    person(3, { email: 'b@acme.example', linkedin_url: 'https://www.linkedin.com/company/acme' }),
  ]);
  assert.equal(kept.length, 2);
});
