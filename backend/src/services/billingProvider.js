const { HttpError } = require('../utils/httpError');

// Provider boundary: the rest of the API only depends on these operations.
function createBillingProvider(env = process.env, sdk) {
  let client = sdk;
  const plans = { plus: { amount: 600, price: env.STRIPE_PRICE_PLUS }, team: { amount: 1200, price: env.STRIPE_PRICE_TEAM } };
  function stripe() {
    if (!env.STRIPE_SECRET_KEY || !env.BILLING_APP_URL || !env.STRIPE_WEBHOOK_SECRET)
      throw new HttpError(503, 'Billing is not configured yet. Please try again later.', 'BILLING_NOT_CONFIGURED');
    const url = new URL(env.BILLING_APP_URL);
    if (url.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(url.hostname)) throw new Error('Billing requires HTTPS');
    client ||= new (require('stripe'))(env.STRIPE_SECRET_KEY, { maxNetworkRetries: 2, timeout: 20000 });
    return client;
  }
  const base = () => env.BILLING_APP_URL.replace(/\/$/, '');
  return {
    async validatePlan(plan) {
      const config = plans[plan];
      if (!config?.price) throw new HttpError(503, 'This plan is not configured yet.', 'PRICE_NOT_CONFIGURED');
      const price = await stripe().prices.retrieve(config.price);
      if (!price.active || price.currency !== 'usd' || price.unit_amount !== config.amount || price.recurring?.interval !== 'month' || price.recurring.interval_count !== 1 || price.recurring.usage_type !== 'licensed')
        throw new HttpError(503, 'The billing price configuration is invalid.', 'INVALID_PRICE_CONFIGURATION');
      return price.id;
    },
    async customer(user, key) {
      return stripe().customers.create({ email: user.email, metadata: { firebase_uid: user.firebaseUid } }, { idempotencyKey: key });
    },
    async subscriptions(customer) {
      const items = [];
      for await (const subscription of stripe().subscriptions.list({ customer, status: 'all', limit: 100 })) items.push(subscription);
      return items;
    },
    plan(subscription) {
      const item = subscription.items.data[0];
      return Object.keys(plans).find(key => plans[key].price && plans[key].price === item?.price.id && item.quantity === 1 && subscription.items.data.length === 1) || null;
    },
    checkout(customer, uid, price, key) {
      return stripe().checkout.sessions.create({ customer, mode: 'subscription', ui_mode: 'embedded_page', payment_method_types: ['card'], line_items: [{ price, quantity: 1 }], client_reference_id: uid, subscription_data: { metadata: { firebase_uid: uid } }, return_url: `${base()}/checkout/success?session_id={CHECKOUT_SESSION_ID}`, redirect_on_completion: 'always' }, { idempotencyKey: key });
    },
    session(id) { return stripe().checkout.sessions.retrieve(id); },
    expire(id) { return stripe().checkout.sessions.expire(id); },
    portal(customer, subscription, price) {
      return stripe().billingPortal.sessions.create({ customer, return_url: `${base()}/dashboard/settings`, ...(subscription && price ? { flow_data: { type: 'subscription_update_confirm', subscription_update_confirm: { subscription: subscription.id, items: [{ id: subscription.items.data[0].id, price, quantity: 1 }] }, after_completion: { type: 'redirect', redirect: { return_url: `${base()}/checkout/success` } } } } : {}) });
    },
    event(body, signature) {
      const sdk = stripe();
      try { return sdk.webhooks.constructEvent(body, signature, env.STRIPE_WEBHOOK_SECRET); }
      catch { throw new HttpError(400, 'Invalid webhook signature.', 'INVALID_SIGNATURE'); }
    },
  };
}
module.exports = { createBillingProvider };
