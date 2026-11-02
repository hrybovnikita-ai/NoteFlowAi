import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rememberPlan, selectedPlan, clearPlan } from './intent.js';
const storage = () => { const data = new Map(); return { setItem: (k, v) => data.set(k, v), getItem: k => data.get(k), removeItem: k => data.delete(k) }; };
test('a selected paid plan survives registration and refresh', () => {
  for (const plan of ['plus', 'team']) {
    const session = storage(); rememberPlan(plan, session);
    assert.equal(selectedPlan(session), plan);
  }
});
test('public Pro plan keeps the existing Team billing identifier', () => {
  const session = storage();
  rememberPlan('pro', session);
  assert.equal(selectedPlan(session), 'team');
});
test('confirmed checkout clears the selected plan', () => {
  const session = storage(); rememberPlan('free', session);
  clearPlan(session); assert.equal(selectedPlan(session), null);
});
