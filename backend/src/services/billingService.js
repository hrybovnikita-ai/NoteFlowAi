const { randomUUID } = require('node:crypto');
const { HttpError } = require('../utils/httpError');
const { createBillingProvider } = require('./billingProvider');
const { createBillingStore } = require('../database/billingStore');

function createBillingService(db, provider = createBillingProvider()) {
  const store = createBillingStore(db);
  const row = uid => store.row(uid);
  const ensure = uid => store.ensure(uid);
  // Database leases protect checkout and synchronization across API processes.
  async function locked(uid, operation) {
    await ensure(uid);
    const owner = randomUUID();
    const result = await store.claim(uid, owner);
    if (!result) throw new HttpError(409, 'Billing is updating. Please retry in a moment.', 'BILLING_BUSY');
    try { return await operation(); }
    finally { await store.release(uid, owner); }
  }
  async function sync(uid) {
    const account = await ensure(uid);
    if (!account.customer_id) return null;
    const subscriptions = await provider.subscriptions(account.customer_id);
    const ongoing = subscriptions.filter(s => !['canceled', 'incomplete_expired'].includes(s.status));
    if (ongoing.length > 1) throw new HttpError(409, 'Multiple subscriptions need support review.', 'MULTIPLE_SUBSCRIPTIONS');
    const subscription = ongoing[0] || subscriptions.sort((a, b) => b.created - a.created)[0];
    const item = subscription?.items.data[0];
    const plan = subscription ? provider.plan(subscription) : null;
    await store.update(uid, { plan: plan || 'free', subscription_id: subscription?.id || null, status: subscription?.status || 'free', period_start: item?.current_period_start || subscription?.current_period_start || null, period_end: item?.current_period_end || subscription?.current_period_end || null, cancel_at_period_end: subscription?.cancel_at_period_end ? 1 : 0, synced_at: new Date().toISOString() });
    return ongoing[0] || null;
  }
  async function summary(uid) {
    const a = await ensure(uid);
    const entitled = ['active', 'trialing'].includes(a.status) && a.period_end * 1000 > Date.now();
    return { plan: entitled ? a.plan : 'free', billingPlan: a.plan, monthlyPrice: { free: 0, plus: 6, team: 12 }[a.plan], status: a.status, periodStart: a.period_start, periodEnd: a.period_end, cancelAtPeriodEnd: Boolean(a.cancel_at_period_end), syncedAt: a.synced_at, hasCustomer: Boolean(a.customer_id) };
  }
  return {
    subscription: uid => locked(uid, async () => { await sync(uid); return summary(uid); }),
    checkout(user, plan) {
      if (plan === "pro") plan = "team";
      if (!['free', 'plus', 'team'].includes(plan)) throw new HttpError(400, 'Choose a valid plan.', 'INVALID_PLAN');
      return locked(user.firebaseUid, async () => {
        const uid = user.firebaseUid;
        const current = await sync(uid);
        let a = await row(uid);
        if (plan === 'free') {
          if (current) return { url: (await provider.portal(a.customer_id)).url };
          return { destination: '/dashboard' };
        }
        const price = await provider.validatePlan(plan);
        if (current) {
          if (provider.plan(current) === plan && ['active', 'trialing'].includes(current.status)) return { current: true };
          return { url: (await provider.portal(a.customer_id, ['active', 'trialing'].includes(current.status) ? current : null, price)).url };
        }
        if (!a.customer_id) {
          const customer = await provider.customer(user, `noteflow-customer-${uid}`);
          await store.update(uid, { customer_id: customer.id });
          a = await row(uid);
        }
        if (a.checkout_key && !a.checkout_id) {
          if (Date.now() - a.checkout_started > 23 * 60 * 60 * 1000) throw new HttpError(409, 'An earlier checkout could not be confirmed. Contact support before starting another payment.', 'CHECKOUT_REVIEW_REQUIRED');
          const recovered = await provider.checkout(a.customer_id, uid, await provider.validatePlan(a.checkout_plan), a.checkout_key);
          await store.update(uid, { checkout_id: recovered.id });
          a = await row(uid);
        }
        if (a.checkout_id) {
          const previous = await provider.session(a.checkout_id);
          if (previous.status === 'open' && a.checkout_plan === plan) return { clientSecret: previous.client_secret, livemode: previous.livemode };
          if (previous.status === 'open') await provider.expire(previous.id);
          if (previous.status === 'complete') {
            await sync(uid);
            if ((await row(uid)).subscription_id && !['canceled', 'incomplete_expired'].includes((await row(uid)).status)) return { destination: '/checkout/success' };
          }
        }
        // Persist the idempotency key BEFORE the network call so uncertain requests can be retried.
        const key = a.checkout_key && !a.checkout_id && a.checkout_plan === plan ? a.checkout_key : randomUUID();
        await store.update(uid, { checkout_key: key, checkout_plan: plan, checkout_started: Date.now(), checkout_id: null });
        const session = await provider.checkout(a.customer_id, uid, price, key);
        await store.update(uid, { checkout_id: session.id });
        return { clientSecret: session.client_secret, livemode: session.livemode };
      });
    },
    checkoutSession(uid, sessionId) {
      return locked(uid, async () => {
        const account = await row(uid);
        if (!account?.checkout_id || account.checkout_id !== sessionId) {
          throw new HttpError(404, 'Checkout session not found.', 'CHECKOUT_SESSION_NOT_FOUND');
        }
        const session = await provider.session(sessionId);
        const customerId = typeof session.customer === 'string' ? session.customer : session.customer?.id;
        if (customerId !== account.customer_id || session.client_reference_id !== uid) {
          throw new HttpError(404, 'Checkout session not found.', 'CHECKOUT_SESSION_NOT_FOUND');
        }
        return { status: session.status, paymentStatus: session.payment_status };
      });
    },
    portal: uid => locked(uid, async () => {
      const a = await row(uid);
      if (!a.customer_id) throw new HttpError(409, 'No billing account exists yet.', 'NO_CUSTOMER');
      return { url: (await provider.portal(a.customer_id)).url };
    }),
    async webhook(body, signature) {
      const event = provider.event(body, signature);
      if (await store.seen(event.id)) return { received: true, duplicate: true };
      const supported = /^(customer\.subscription\.(created|updated|deleted|paused|resumed)|invoice\.(paid|payment_failed|payment_action_required)|checkout\.session\.(completed|expired|async_payment_succeeded|async_payment_failed))$/;
      if (!supported.test(event.type)) return { received: true };
      const customer = event.data.object.customer;
      const a = await store.customer(typeof customer === 'string' ? customer : customer?.id || '');
      if (!a) throw new HttpError(503, 'Billing account is not synchronized yet.', 'BILLING_ACCOUNT_PENDING');
      await locked(a.firebase_uid, async () => {
        // Retrieve current provider state, never apply stale event payloads out of order.
        await sync(a.firebase_uid);
        await store.record(event.id);
      });
      return { received: true };
    },
  };
}
module.exports = { createBillingService };
