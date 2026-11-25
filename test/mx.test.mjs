import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify, classifyDomains, fixtureResolver } from '../lib/mx.mjs';

const err = (code) => Object.assign(new Error(code), code === undefined ? {} : { code });
const fakeResolver = (table) => ({
  async resolveMx(d) {
    const v = table[d];
    if (v instanceof Error) throw v;
    return v;
  },
});

test('classify by provider signature', () => {
  assert.equal(classify(['aspmx.l.google.com', 'alt1.aspmx.l.google.com']), 'google');
  assert.equal(classify(['acme-example.mail.protection.outlook.com']), 'microsoft');
  assert.equal(classify(['acme-example.n-v1.mx.microsoft.']), 'microsoft');
  assert.equal(classify(['mx1.acme.example']), 'other');
  assert.equal(classify([]), 'none');
});

test('no MX answer is "none"; any other DNS error is "lookup-failed"', async () => {
  const results = await classifyDomains(['a.example', 'b.example', 'c.example', 'd.example', 'e.example'], fakeResolver({
    'a.example': err('ENODATA'),
    'b.example': err('ENOTFOUND'),
    'c.example': err('ETIMEOUT'),
    'd.example': err('ESERVFAIL'),
    'e.example': err(undefined),
  }));
  assert.equal(results.get('a.example').cls, 'none');
  assert.equal(results.get('b.example').cls, 'none');
  assert.equal(results.get('c.example').cls, 'lookup-failed');
  assert.equal(results.get('d.example').cls, 'lookup-failed');
  assert.equal(results.get('e.example').cls, 'lookup-failed');
  assert.equal(results.get('c.example').error, 'ETIMEOUT');
});

test('answers are read in priority order', async () => {
  const results = await classifyDomains(['a.example'], fakeResolver({
    'a.example': [{ exchange: 'backup.a.example', priority: 20 }, { exchange: 'aspmx.l.google.com', priority: 1 }],
  }));
  assert.deepEqual(results.get('a.example').mx, ['aspmx.l.google.com', 'backup.a.example']);
});

test('the worker pool classes every domain it is handed, once', async () => {
  const domains = Array.from({ length: 50 }, (_, i) => `d${i}.example`);
  let calls = 0;
  const resolver = { async resolveMx() { calls++; await new Promise((r) => setTimeout(r, 1)); return [{ exchange: 'mx.x.example', priority: 1 }]; } };
  const results = await classifyDomains(domains, resolver, { concurrency: 8 });
  assert.equal(results.size, 50);
  assert.equal(calls, 50);
});

test('fixture resolver: listed hosts, [] for no mail server, an error entry, and unknown domains held', async () => {
  const resolver = fixtureResolver({ mx: {
    'g.example': ['aspmx.l.google.com.example'],
    'n.example': [],
    'f.example': { error: 'ESERVFAIL' },
  } });
  const results = await classifyDomains(['g.example', 'n.example', 'f.example', 'unknown.example'], resolver);
  assert.equal(results.get('g.example').cls, 'google');
  assert.equal(results.get('n.example').cls, 'none');
  assert.equal(results.get('f.example').cls, 'lookup-failed');
  assert.equal(results.get('unknown.example').cls, 'lookup-failed');
  assert.equal(results.get('unknown.example').error, 'ENOFIXTURE');
});
