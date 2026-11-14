import test from 'node:test';
import assert from 'node:assert/strict';
import { OAuthStateStore } from './oauth-state.mjs';

test('OAuth state is accepted once and cannot be replayed', () => {
  const store = new OAuthStateStore({ createState: () => 'random-state-with-enough-length' });
  const state = store.create();

  assert.equal(state, 'random-state-with-enough-length');
  assert.equal(store.consume(state), true);
  assert.equal(store.consume(state), false);
});

test('unknown and expired OAuth state are rejected', () => {
  let now = 100;
  const store = new OAuthStateStore({ ttlMs: 50, now: () => now, createState: () => 'state-value' });
  const state = store.create();
  now += 50;

  assert.equal(store.consume('not-issued'), false);
  assert.equal(store.consume(state), false);
});

test('default state is cryptographically generated in WHOOP documented eight-character format', () => {
  const state = new OAuthStateStore().create();
  assert.match(state, /^[A-Za-z0-9_-]{8}$/);
});