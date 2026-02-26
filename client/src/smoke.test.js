import test from 'node:test';
import assert from 'node:assert/strict';

test('client smoke', () => {
  assert.equal(typeof URL, 'function');
});
