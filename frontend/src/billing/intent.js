const key = 'noteflow.billing.plan';
const normalizePlan = plan => plan === 'pro' ? 'team' : plan;
export const validPlan = plan => ['free', 'plus', 'team', 'pro'].includes(plan);
export function rememberPlan(plan, storage = window.sessionStorage) {
  if (validPlan(plan)) storage.setItem(key, normalizePlan(plan));
}
export function selectedPlan(storage = window.sessionStorage) {
  const plan = storage.getItem(key);
  return validPlan(plan) ? normalizePlan(plan) : null;
}
export function clearPlan(storage = window.sessionStorage) { storage.removeItem(key); }
