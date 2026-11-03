const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const Stripe = require('stripe');
const { createDatabase } = require('../src/database/connection');
const { createApp } = require('../src/app');
const { createBillingProvider } = require('../src/services/billingProvider');
const { HttpError } = require('../src/utils/httpError');
process.env.NODE_ENV = 'test';
let db, app, subscriptions, sessions, creates, provider;
const headers = { Authorization: 'Bearer alice' };
const active = (status = 'active', plan = 'plus') => ({ id: 'sub_1', customer: 'cus_1', created: 100, status, cancel_at_period_end: false, items: { data: [{ id: 'si_1', quantity: 1, price: { id: plan }, current_period_start: 100, current_period_end: Math.floor(Date.now() / 1000) + 86400 }] } });
beforeEach(() => {
  db = createDatabase(':memory:'); subscriptions = []; sessions = new Map(); creates = 0;
  provider = {
    validatePlan: async plan => plan,
    customer: async () => ({ id: 'cus_1' }),
    subscriptions: async () => subscriptions,
    plan: sub => sub.items.data[0].price.id,
    checkout: async (customer, uid, price, key) => {
      if (!sessions.has(key)) { creates++; sessions.set(key, { id: key, customer, client_reference_id: uid, status: 'open', payment_status: 'unpaid', client_secret: 'test_secret', livemode: false }); }
      return sessions.get(key);
    },
    session: async id => sessions.get(id),
    expire: async id => { sessions.get(id).status = 'expired'; },
    portal: async (customer, sub, price) => ({ url: `https://billing.stripe.com/test/${sub ? price : 'manage'}` }),
    event: (body, signature) => {
      assert.ok(Buffer.isBuffer(body));
      try { return Stripe.webhooks.constructEvent(body, signature, 'whsec_unit_only'); }
      catch { throw new HttpError(400, 'Invalid signature', 'INVALID_SIGNATURE'); }
    },
  };
  app = createApp({ db, billingProvider: provider, verifyIdToken: async token => {
    if (token !== 'alice' && token !== 'bob') throw Object.assign(new Error('Invalid token'), { code: 'auth/invalid-id-token' });
    return { uid: token, email: `${token}@example.test` };
  } });
});
afterEach(() => db.close());
const checkout = plan => request(app).post('/api/billing/checkout').set(headers).send({ plan, price: 1, status: 'active' });
const checkoutSession = id => request(app).get(`/api/billing/checkout-sessions/${encodeURIComponent(id)}`).set(headers);
const status = () => request(app).get('/api/billing/subscription').set(headers);
function webhook(id, type = 'customer.subscription.updated') {
  const payload = JSON.stringify({ id, type, data: { object: { customer: 'cus_1' } } });
  const signature = Stripe.webhooks.generateTestHeaderString({ payload, secret: 'whsec_unit_only' });
  return request(app).post('/api/billing/webhook').set('Content-Type', 'application/json').set('stripe-signature', signature).send(payload);
}
test('every user billing endpoint rejects missing and invalid tokens', async () => {
  for (const [method, path] of [['get', 'subscription'], ['get', 'checkout-sessions/session_1'], ['post', 'checkout'], ['post', 'portal']]) {
    await request(app)[method](`/api/billing/${path}`).expect(401);
    await request(app)[method](`/api/billing/${path}`).set('Authorization', 'Bearer invalid').expect(401);
  }
});
test('invalid plans are rejected and free activation needs no provider', async () => {
  for (const plan of ['enterprise', '__proto__', {}, null]) await checkout(plan).expect(400);
  assert.equal((await checkout('free').expect(200)).body.destination, '/dashboard');
  assert.equal((await status()).body.plan, 'free'); assert.equal(creates, 0);
});
test('public Pro checkout maps to the existing Team Stripe price configuration', async () => {
  const response = await checkout('pro').expect(200);
  assert.equal(response.body.clientSecret, 'test_secret');
  assert.equal((await status()).body.plan, 'free');
  assert.equal(creates, 1);
});
test('authenticated checkout ignores client price/status and reuses open session', async () => {
  assert.equal((await checkout('plus').expect(200)).body.clientSecret, 'test_secret');
  await checkout('plus').expect(200); assert.equal(creates, 1);
  assert.equal((await status()).body.plan, 'free');
  await checkout('team').expect(200); assert.equal(creates, 2);
  assert.equal([...sessions.values()][0].status, 'expired');
});
test('checkout return sessions are authenticated, account-bound, and do not grant paid access', async () => {
  await checkout('plus').expect(200);
  const sessionId = [...sessions.keys()][0];
  assert.deepEqual((await checkoutSession(sessionId).expect(200)).body, { status: 'open', paymentStatus: 'unpaid' });
  sessions.get(sessionId).status = 'complete';
  sessions.get(sessionId).payment_status = 'paid';
  assert.deepEqual((await checkoutSession(sessionId).expect(200)).body, { status: 'complete', paymentStatus: 'paid' });
  assert.equal((await status()).body.plan, 'free');
  await request(app).get(`/api/billing/checkout-sessions/${sessionId}`).set({ Authorization: 'Bearer bob' }).expect(404);
});
test('successful signed webhook synchronizes and duplicate is idempotent', async () => {
  await checkout('plus'); subscriptions = [active()];
  await webhook('evt_paid').expect(200);
  assert.equal((await status()).body.plan, 'plus');
  assert.equal((await webhook('evt_paid')).body.duplicate, true);
  assert.equal(db.prepare('SELECT count(*) AS n FROM billing_events').get().n, 1);
});
test('failed payments, canceled and expired subscriptions revoke paid entitlement', async () => {
  await checkout('plus');
  for (const state of ['past_due', 'unpaid', 'canceled', 'incomplete', 'incomplete_expired', 'paused']) {
    subscriptions = [active(state)]; await webhook(`evt_${state}`, 'invoice.payment_failed').expect(200);
    const response = await status(); assert.equal(response.body.plan, 'free'); assert.equal(response.body.status, state);
  }
  subscriptions = [active()]; subscriptions[0].items.data[0].current_period_end = 1;
  assert.equal((await status()).body.plan, 'free');
});
test('trial and scheduled cancellation retain access until period end', async () => {
  await checkout('plus'); subscriptions = [active('trialing')]; subscriptions[0].cancel_at_period_end = true;
  const response = await status(); assert.equal(response.body.plan, 'plus'); assert.equal(response.body.cancelAtPeriodEnd, true);
});
test('current plan and upgrades/downgrades use portal without duplicate subscriptions', async () => {
  await checkout('plus'); subscriptions = [active()];
  assert.equal((await checkout('plus')).body.current, true);
  assert.match((await checkout('team')).body.url, /team$/);
  assert.match((await checkout('free')).body.url, /manage$/);
  subscriptions = [active('active', 'team')]; assert.match((await checkout('plus')).body.url, /plus$/);
  assert.equal(creates, 1);
});
test('out-of-order events fetch current state and invalid signatures cannot mutate it', async () => {
  await checkout('plus'); subscriptions = [active('canceled')];
  await webhook('evt_old', 'invoice.paid'); assert.equal((await status()).body.plan, 'free');
  await request(app).post('/api/billing/webhook').set('Content-Type', 'application/json').send('{}').expect(400);
  assert.equal(db.prepare('SELECT count(*) AS n FROM billing_events').get().n, 1);
});
test('accounts are isolated and a success URL cannot grant access', async () => {
  await checkout('plus'); subscriptions = [active()]; await status();
  const bob = await request(app).get('/api/billing/subscription').set('Authorization', 'Bearer bob').expect(200);
  assert.equal(bob.body.plan, 'free');
  await request(app).post('/api/billing/portal').set('Authorization', 'Bearer bob').expect(409);
});
test('real provider validates webhook signatures without network access', () => {
  const real = createBillingProvider({ STRIPE_SECRET_KEY: 'sk_test_unit_only', STRIPE_WEBHOOK_SECRET: 'whsec_unit_only', BILLING_APP_URL: 'http://localhost:5173' });
  assert.throws(() => real.event(Buffer.from('{}'), 'invalid'), error => error.status === 400);
});
test('billing fails explicitly when provider is not configured', async () => {
  const real = createBillingProvider({}); await assert.rejects(real.validatePlan('plus'), error => error.status === 503);
});
test('failed webhook sync is retryable and does not mark the event processed', async () => {
  await checkout('plus');
  const original = provider.subscriptions;
  provider.subscriptions = async () => { throw new Error('provider temporarily unavailable'); };
  await webhook('evt_retry').expect(500);
  assert.equal(db.prepare('SELECT count(*) AS n FROM billing_events').get().n, 0);
  provider.subscriptions = original; subscriptions = [active()];
  await webhook('evt_retry').expect(200);
  assert.equal((await status()).body.plan, 'plus');
});
test('uncertain checkout is recovered before switching plans', async () => {
  const original = provider.checkout;
  let fail = true;
  provider.checkout = async (...args) => {
    const result = await original(...args);
    if (fail) { fail = false; throw new Error('connection lost after creation'); }
    return result;
  };
  await checkout('plus').expect(500);
  await checkout('team').expect(200);
  assert.equal(creates, 2);
  assert.equal([...sessions.values()][0].status, 'expired');
  assert.equal([...sessions.values()].filter(s => s.status === 'open').length, 1);
});
test('concurrent requests cannot create a second checkout', async () => {
  const original = provider.checkout;
  let release, entered;
  const ready = new Promise(resolve => { entered = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  provider.checkout = async (...args) => { entered(); await gate; return original(...args); };
  const first = checkout('plus').then(response => response);
  await ready;
  await checkout('plus').expect(409);
  release(); assert.equal((await first).status, 200); assert.equal(creates, 1);
});
test('Stripe adapter validates exact server prices and creates monthly embedded subscription checkout', async () => {
  let configuredPrice = { id: 'price_plus', active: true, currency: 'usd', unit_amount: 600, recurring: { interval: 'month', interval_count: 1, usage_type: 'licensed' } };
  let parameters;
  const adapter = createBillingProvider({ STRIPE_SECRET_KEY: 'sk_test_unit', STRIPE_WEBHOOK_SECRET: 'whsec_unit', STRIPE_PRICE_PLUS: 'price_plus', BILLING_APP_URL: 'https://example.test' }, {
    prices: { retrieve: async () => configuredPrice },
    checkout: { sessions: { create: async (body, options) => { parameters = { body, options }; return { id: 'cs_fixture' }; } } },
  });
  assert.equal(await adapter.validatePlan('plus'), 'price_plus');
  for (const patch of [{ unit_amount: 1 }, { currency: 'eur' }, { active: false }, { recurring: { interval: 'year', interval_count: 1, usage_type: 'licensed' } }]) {
    const original = configuredPrice; configuredPrice = { ...original, ...patch };
    await assert.rejects(adapter.validatePlan('plus'), e => e.code === 'INVALID_PRICE_CONFIGURATION'); configuredPrice = original;
  }
  await adapter.checkout('cus_fixture', 'uid_fixture', 'price_plus', 'key_fixture');
  assert.equal(parameters.body.ui_mode, 'embedded_page');
  assert.equal(parameters.body.mode, 'subscription');
  assert.deepEqual(parameters.body.line_items, [{ price: 'price_plus', quantity: 1 }]);
  assert.equal(parameters.options.idempotencyKey, 'key_fixture');
  assert.equal(parameters.body.return_url, 'https://example.test/checkout/success?session_id={CHECKOUT_SESSION_ID}');
});
