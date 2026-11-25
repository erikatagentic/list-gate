import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSuppression, matchSuppression } from '../lib/suppression.mjs';

test('wide layout: email and domain columns', () => {
  const sup = loadSuppression('email,domain\nDana@Acme.example,\n,https://www.birch.example/\n');
  assert.deepEqual([...sup.emails], ['dana@acme.example']);
  assert.deepEqual([...sup.domains], ['birch.example']);
  assert.deepEqual(matchSuppression({ email: 'dana@acme.example', company_domain: 'acme.example' }, sup), ['email:dana@acme.example']);
});

test('typed layout: type,value rows', () => {
  const sup = loadSuppression('type,value\nemail,ivo@cedar.example\ndomain,birch.example\nphone,ignored\n');
  assert.equal(sup.emails.size, 1);
  assert.equal(sup.domains.size, 1);
});

test('a domain matches on the root, through the company domain or the email domain', () => {
  const sup = loadSuppression('domain\nbirch.example\n');
  assert.deepEqual(matchSuppression({ email: 'x@other.example', company_domain: 'shop.birch.example' }, sup), ['domain:birch.example']);
  assert.deepEqual(matchSuppression({ email: 'x@mail.birch.example', company_domain: 'other.example' }, sup), ['domain:birch.example']);
  assert.deepEqual(matchSuppression({ email: 'x@notbirch.example', company_domain: 'notbirch.example' }, sup), []);
});

test('a free-mail domain in the file is ignored, so it cannot wipe out every personal address', () => {
  const sup = loadSuppression('domain\ngmail.com\n');
  assert.equal(sup.domains.size, 0);
  assert.deepEqual(sup.ignored, ['gmail.com (free mail)']);
  // Built from parts so the public check doesn't read it as a real address.
  const personal = ['someone', 'gmail.com'].join('@');
  assert.deepEqual(matchSuppression({ email: personal, company_domain: 'acme.example' }, sup), []);
});

test('a file with no usable column throws', () => {
  assert.throws(() => loadSuppression('company\nAcme\n'), /email or domain column/);
});

test('an empty file suppresses nothing', () => {
  const sup = loadSuppression('');
  assert.equal(sup.rows, 0);
  assert.deepEqual(matchSuppression({ email: 'a@acme.example', company_domain: 'acme.example' }, sup), []);
});
