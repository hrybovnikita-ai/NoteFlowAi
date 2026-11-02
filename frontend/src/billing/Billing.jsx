import { useEffect, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { EmbeddedCheckout, EmbeddedCheckoutProvider } from '@stripe/react-stripe-js';
import { loadStripe } from '@stripe/stripe-js';
import { api } from '../api/client';
import { useAuth } from '../auth/useAuth';
import { clearPlan, rememberPlan, selectedPlan, validPlan } from './intent';
import './Billing.css';

const names = { free: 'Free', plus: 'Plus', team: 'Pro' };
const prices = { free: 0, plus: 6, team: 12 };
let stripePromise;
function stripe() { return stripePromise ||= loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY); }

export function PlanButton({ plan, featured }) {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [subscription, setSubscription] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    if (user) api.billing.subscription().then(value => { if (active) setSubscription(value); }).catch(() => {});
    return () => { active = false; };
  }, [user]);
  const current = Boolean(user && subscription?.plan === plan);
  async function select() {
    rememberPlan(plan);
    if (!user) return navigate('/register');
    if (plan !== 'free') return navigate(`/checkout?plan=${plan}`);
    setBusy(true); setError('');
    try {
      const result = await api.billing.checkout(plan);
      clearPlan();
      if (result.url) window.location.assign(result.url);
      else navigate('/dashboard');
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }
  return <><button className={featured ? 'main-button' : 'pricing-link'} onClick={select} disabled={loading || busy || current}>{busy ? 'Please wait…' : current ? 'Current Plan' : plan === 'free' ? 'Get Started' : 'Subscribe'}</button>{error && <p role="alert">{error}</p>}</>;
}

function BillingFrame({ children }) {
  return <main className="billing-shell"><Link className="billing-brand" to="/"><img src="/favicon.png" alt="" />NoteFlow <span>AI</span></Link>{children}</main>;
}

export function CheckoutPage() {
  const { user, loading } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const requestedPlan = new URLSearchParams(location.search).get('plan');
  const plan = requestedPlan === 'pro' ? 'team' : requestedPlan;
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { if (validPlan(plan)) rememberPlan(plan); }, [plan]);
  if (loading) return <BillingFrame><p role="status">Restoring your session…</p></BillingFrame>;
  if (!validPlan(plan) || plan === 'free') return <BillingFrame><h1>Choose a paid plan</h1><Link to="/pricing">Back to Pricing</Link></BillingFrame>;
  if (!user) return <Navigate to="/register" replace />;
  async function start() {
    setBusy(true); setError('');
    try {
      if (!import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY) throw new Error('Secure payments are not configured yet. Please try again later.');
      const response = await api.billing.checkout(plan);
      if (response.url) window.location.assign(response.url);
      else if (response.destination) navigate(response.destination);
      else if (response.current) navigate('/dashboard/settings');
      else {
        const sdk = await stripe();
        if (!sdk) throw new Error('The secure payment form could not load. Please retry.');
        setResult(response);
      }
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }
  return <BillingFrame><div className="billing-heading"><span className="main-eyebrow">A LITTLE MORE ROOM TO THINK</span><h1>Your next chapter starts here.</h1><p>One simple monthly subscription. Manage it anytime.</p></div><div className="checkout-grid"><section className="billing-card billing-summary"><span className="billing-pill">{plan === 'plus' ? 'Recommended' : 'More room to create'}</span><h2>NoteFlow {names[plan]}</h2><p className="billing-price">${prices[plan]}<small> USD / month</small></p><p>{plan === 'plus' ? 'More notes, a larger daily AI allowance, and AI summaries.' : 'The highest daily AI allowance, unlimited notes subject to fair per-note limits, and all currently available AI tools.'}</p><hr /><div className="billing-line"><span>Monthly subscription</span><strong>${prices[plan]}.00</strong></div><div className="billing-line"><span>Billing frequency</span><strong>Monthly</strong></div><p>Renews automatically until canceled. Any prorations for plan changes are shown by Stripe before confirmation.</p><Link to="/pricing">← Back to Pricing</Link></section><section className="billing-card payment-card"><h2>Secure checkout</h2><p>Choose your payment method in Stripe’s secure form. Visa and Mastercard are supported. Apple Pay and Google Pay appear only on eligible devices and accounts.</p>{result?.livemode === false && <p className="billing-notice" role="status">Test mode — no real payments.</p>}{error && <p className="billing-error" role="alert">{error}</p>}{result?.clientSecret ? <EmbeddedCheckoutProvider stripe={stripe()} options={{ clientSecret: result.clientSecret }}><EmbeddedCheckout /></EmbeddedCheckoutProvider> : <button className="main-button" disabled={busy} onClick={start}>{busy ? 'Preparing secure checkout…' : 'Continue to payment'}</button>}<p className="billing-security">🔒 Payment details go directly to Stripe. The secure form contains your payment method selector and Subscribe button.</p><p><a href={import.meta.env.VITE_TERMS_URL || '/terms'}>Terms</a> · <a href={import.meta.env.VITE_PRIVACY_URL || '/privacy'}>Privacy</a></p><Link to={`/checkout/cancel?plan=${plan}`}>Cancel checkout</Link></section></div></BillingFrame>;
}

export function CheckoutResult({ canceled = false }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  const [subscription, setSubscription] = useState(null);
  const [checkoutStatus, setCheckoutStatus] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const plan = selectedPlan();
  const sessionId = new URLSearchParams(location.search).get('session_id');
  async function refresh() {
    setBusy(true); setError('');
    try {
      if (sessionId) setCheckoutStatus((await api.billing.checkoutSession(sessionId)).status);
      const value = await api.billing.subscription();
      setSubscription(value);
      if (value.plan !== 'free') clearPlan();
    }
    catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }
  useEffect(() => {
    if (!user || canceled) return;
    let active = true;
    let count = 0;
    async function check() {
      try {
        if (sessionId) {
          const checkout = await api.billing.checkoutSession(sessionId);
          if (active) setCheckoutStatus(checkout.status);
        }
        const value = await api.billing.subscription();
        if (active) { setSubscription(value); setError(''); if (value.plan !== 'free') clearPlan(); }
      } catch (e) { if (active) setError(e.message); }
    }
    check();
    const timer = setInterval(() => { if (++count < 6) check(); else clearInterval(timer); }, 3000);
    return () => { active = false; clearInterval(timer); };
  }, [user, canceled, sessionId]);
  if (loading) return <BillingFrame><p role="status">Restoring your session…</p></BillingFrame>;
  if (!user && !canceled) return <Navigate to="/login" state={{ from: { pathname: '/checkout/success' } }} replace />;
  const confirmed = subscription && subscription.plan !== 'free';
  return <BillingFrame><section className="billing-card billing-result"><span className="billing-pill">{canceled ? 'Checkout closed' : confirmed ? 'Subscription confirmed' : 'Checking subscription'}</span><h1>{canceled ? 'Take your time.' : confirmed ? `Welcome to ${names[subscription.plan]}.` : 'Waiting for confirmation.'}</h1><p>{canceled ? 'You left checkout. You can retry whenever you’re ready. If you already submitted payment, check Billing before trying again.' : confirmed ? 'Your subscription has been verified with the payment provider.' : 'No paid access is granted until the provider confirms your subscription. If payment was declined, retry or update your payment method in Billing.'}</p>{checkoutStatus && !confirmed && <p role="status">Checkout session status: {checkoutStatus.replaceAll('_', ' ')}.</p>}{error && <p role="alert">{error}</p>}{!canceled && !confirmed && <button className="main-button" disabled={busy} onClick={refresh}>{busy ? 'Checking…' : 'Check again'}</button>}<div className="billing-actions"><Link to="/dashboard">Return to dashboard</Link><Link to="/dashboard/settings">Billing settings</Link>{!confirmed && <Link to={plan && plan !== 'free' ? `/checkout?plan=${plan}` : '/#pricing'}>Retry checkout</Link>}</div></section></BillingFrame>;
}

export function BillingSettings() {
  const [subscription, setSubscription] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { let active = true; api.billing.subscription().then(s => { if (active) setSubscription(s); }).catch(e => { if (active) setError(e.message); }); return () => { active = false; }; }, []);
  async function manage() {
    setBusy(true); setError('');
    try { window.location.assign((await api.billing.portal()).url); }
    catch (e) { setError(e.message); setBusy(false); }
  }
  return <section className="dashboard-settings-card billing-settings"><span className="dashboard-eyebrow">YOUR PLAN</span><h2>Billing &amp; Subscription</h2>{error && <p role="alert">{error}</p>}{!subscription && !error && <p role="status">Loading subscription…</p>}{subscription && <><h3>{names[subscription.plan]} · ${prices[subscription.plan]} / month</h3><p>Status: {subscription.status.replaceAll('_', ' ')}</p>{subscription.periodEnd && <p>{subscription.cancelAtPeriodEnd || ['canceled', 'incomplete_expired'].includes(subscription.status) ? 'Period ends' : 'Next billing date'}: {new Date(subscription.periodEnd * 1000).toLocaleDateString()}</p>}{subscription.cancelAtPeriodEnd && <p>Cancellation is scheduled at the end of this billing period.</p>}<div className="billing-actions"><Link to="/pricing">Change plan</Link>{subscription.hasCustomer && <button className="dashboard-secondary-button" disabled={busy} onClick={manage}>{busy ? 'Opening…' : 'Manage billing'}</button>}</div><p>Manage payment methods, cancel your subscription, and view invoices in Stripe’s secure customer portal.</p></>}</section>;
}

export function LegalPage({ privacy = false }) {
  return <BillingFrame><section className="billing-card"><h1>{privacy ? 'Privacy' : 'Subscription terms'}</h1><p>{privacy ? 'Authentication is handled by Firebase. NoteFlow stores your notes and billing identifiers. Stripe handles payment details directly; NoteFlow does not store card numbers or security codes.' : 'Paid plans renew monthly until canceled. Stripe shows the final charge and any plan-change prorations before you confirm. Manage cancellation from Settings → Billing & Subscription.'}</p><p>The operator must publish their full {privacy ? 'privacy policy' : 'terms of service'} before live billing opens.</p><Link to="/#pricing">Back to Pricing</Link></section></BillingFrame>;
}
