import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isFreemail, isRoleAddress } from '../lib/freemail.mjs';

test('free-mail domains and their sub-domains, with dot boundaries', () => {
  assert.equal(isFreemail('gmail.com'), true);
  assert.equal(isFreemail('Mail.Yahoo.co.uk.'), true);
  assert.equal(isFreemail('notgmail.com'), false);
  assert.equal(isFreemail('acme.example'), false);
  assert.equal(isFreemail(''), false);
});

test('role addresses, with or without a plus tag', () => {
  assert.equal(isRoleAddress('info@acme.example'), true);
  assert.equal(isRoleAddress('Sales+EU@acme.example'), true);
  assert.equal(isRoleAddress('dana.rowe@acme.example'), false);
  assert.equal(isRoleAddress('information@acme.example'), false);
  assert.equal(isRoleAddress('not an email'), false);
});
