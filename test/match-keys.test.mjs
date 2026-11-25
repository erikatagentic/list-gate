import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  displayName, emailDomain, emailKey, isEmailKey, linkedinKey, normName, normalizeHost, personKey, registrableDomain,
} from '../lib/match-keys.mjs';

test('normalizeHost strips scheme, www, path, query, port and a trailing dot', () => {
  assert.equal(normalizeHost('https://www.Acme.example/about?x=1'), 'acme.example');
  assert.equal(normalizeHost('acme.example:8443/'), 'acme.example');
  assert.equal(normalizeHost('acme.example.'), 'acme.example');
  assert.equal(normalizeHost(''), '');
});

test('registrableDomain keys sub-domains and two-label suffixes correctly', () => {
  assert.equal(registrableDomain('mail.shop.acme.example'), 'acme.example');
  assert.equal(registrableDomain('shop.acme.co.uk'), 'acme.co.uk');
  assert.equal(registrableDomain('www.acme.com.au'), 'acme.com.au');
});

test('normName drops legal suffixes and punctuation', () => {
  assert.equal(normName('Acme Corp, Inc.'), 'acme');
  assert.equal(normName('acme corporation'), 'acme');
  assert.equal(normName('Quill & Fern Partners LLC'), 'quillfernpartners');
  assert.equal(normName('Quill and Fern Partners'), normName('Quill & Fern Partners, Inc.'));
});

test('emailKey lowercases; isEmailKey wants a dotted domain', () => {
  assert.equal(emailKey('  Dana.Rowe@Acme.Example '), 'dana.rowe@acme.example');
  assert.equal(isEmailKey('dana@acme.example'), true);
  assert.equal(isEmailKey('dana@localhost'), false);
  assert.equal(isEmailKey('n/a'), false);
  assert.equal(emailDomain('Dana@Mail.Acme.Example'), 'mail.acme.example');
});

test('linkedinKey reads every common spelling of one profile the same', () => {
  const want = 'in/dana-rowe';
  for (const u of ['https://www.linkedin.com/in/dana-rowe/', 'linkedin.com/in/Dana-Rowe?trk=x', 'https://uk.linkedin.com/in/dana-rowe#about']) {
    assert.equal(linkedinKey(u), want, u);
  }
  assert.equal(linkedinKey('https://www.linkedin.com/company/acme/'), 'company/acme');
  assert.equal(linkedinKey('https://other.example/in/dana-rowe'), '');
});

test('personKey removes nothing that could tell two people apart', () => {
  assert.equal(personKey('  Dana   Rowe '), 'dana rowe');
  assert.notEqual(personKey('Jane Smith-Jones'), personKey('Jane Jones'));
  assert.notEqual(personKey('Zo\u00eb Lark'), personKey('Zoe Lark'));
});

test('displayName: collapse spaces, drop emoji, keep the DBA trade name, title-case only all-lowercase names', () => {
  assert.equal(displayName('  Lantern   Moss  Studio '), 'Lantern Moss Studio');
  assert.equal(displayName('Nightjar Coffee \u2615'), 'Nightjar Coffee');
  assert.equal(displayName('Westbrook Holdings LLC dba Westbrook Roofing'), 'Westbrook Roofing');
  assert.equal(displayName('tallgrass creative'), 'Tallgrass Creative');
  assert.equal(displayName('iRobotics ACME'), 'iRobotics ACME');
});
