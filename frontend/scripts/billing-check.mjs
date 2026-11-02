import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || undefined });
const base = process.env.APP_URL || 'http://127.0.0.1:5174';
const results = [];
await mkdir('artifacts/billing', { recursive: true });
try {
  const page = await browser.newPage({ reducedMotion: 'reduce' });
  page.on('pageerror', error => console.error(error.message));
  // Browser-only Firebase and API fixtures. No test bypass is shipped in application code.
  await page.route('**/src/auth/AuthContext.jsx', route => route.fulfill({ contentType: 'application/javascript', body: `
    import React from '/node_modules/.vite/deps/react.js';
    import {AuthContext} from '/src/auth/AuthContextValue.js';
    export function AuthProvider({children}) {
      const fixture = {uid:'fixture',email:'fixture@example.test',displayName:'Fixture',providerData:[]};
      const [user,setUser] = React.useState(sessionStorage.getItem('fixture.auth') ? fixture : null);
      const signIn = async () => { sessionStorage.setItem('fixture.auth','yes'); setUser(fixture); return {user:fixture}; };
      const logout = async () => { sessionStorage.removeItem('fixture.auth'); setUser(null); };
      return React.createElement(AuthContext.Provider,{value:{user,loading:false,firebaseError:'',register:signIn,login:signIn,loginWithGoogle:signIn,logout,sendPasswordReset:async()=>{}}},children);
    }` }));
  await page.route('**/src/api/client.js', route => route.fulfill({ contentType: 'application/javascript', body: `
    export const api = {billing:{subscription:async()=>({plan:'free',status:'free',hasCustomer:false}),checkout:async()=>({destination:'/dashboard'}),portal:async()=>({url:'/dashboard/settings'})},health:async()=>({status:'ok'}),auth:{sync:async()=>({})},notes:{list:async()=>[]}};` }));
  await page.goto(`${base}/dashboard`);
  await page.waitForURL('**/login');
  results.push({ protectedDashboardRedirectsUnauthenticatedUser: true });
  await page.evaluate(() => sessionStorage.setItem('fixture.auth', 'yes'));
  await page.goto(`${base}/dashboard`);
  await page.getByRole('heading', { name: 'Welcome to NoteFlow AI' }).waitFor();
  results.push({ authenticatedUserCanOpenDashboard: true });
  await page.locator('.dashboard-profile-dropdown summary').click();
  await page.getByRole('button', { name: 'Log out' }).click();
  await page.waitForURL(url => url.pathname === '/');
  await page.goto(`${base}/dashboard`);
  await page.waitForURL('**/login');
  results.push({ logoutRevokesClientSessionAndProtectsDashboard: true });
  for (const [plan, label, mode] of [['plus', 'Plus', 'register'], ['team', 'Pro', 'login']]) {
    await page.goto(base); await page.evaluate(() => sessionStorage.clear()); await page.reload();
    await page.locator('.pricing-card').filter({ has: page.locator('.pricing-plan', { hasText: new RegExp(`^${label}$`, 'i') }) }).getByRole('button').click();
    await page.waitForURL('**/register'); await page.reload();
    assert.equal(await page.evaluate(() => sessionStorage.getItem('noteflow.billing.plan')), plan);
    if (mode === 'login') await page.locator('.auth-mode-switch button').click();
    else {
      await page.locator('[name="fullName"]').fill('Test Person');
      await page.locator('[name="confirmPassword"]').fill('test-password-123');
    }
    await page.locator('[name="email"]').fill('fixture@example.test');
    await page.locator('[name="password"]').fill('test-password-123');
    await page.locator('.auth-submit').click();
    await page.waitForURL(`**/checkout?plan=${plan}`);
    results.push({ flow: `${label} → ${mode} → checkout (${plan} billing ID)`, passed: true });
  }
  for (const width of [320, 375, 768, 1024, 1440, 2560]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const path of ['/', '/pricing', '/checkout?plan=plus', '/checkout/cancel?plan=plus', '/checkout/success', '/dashboard/settings']) {
      await page.goto(base + path); await page.locator('h1').first().waitFor();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `overflow ${path} at ${width}`);
      if (path === '/' || path === '/pricing') {
        const cards = await page.locator('.pricing-card').evaluateAll(nodes => nodes.map(n => { const r = n.getBoundingClientRect(); return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,height:r.height}; }));
        assert.ok(!cards.some((a,i) => cards.slice(i+1).some(b => a.left < b.right-1 && a.right > b.left+1 && a.top < b.bottom-1 && a.bottom > b.top+1)));
      }
      if (path.startsWith('/checkout?')) await page.screenshot({ path: `artifacts/billing/checkout-${width}.png`, fullPage: true });
      results.push({ width, path, overflow: false });
    }
  }
  await page.goto(base + '/checkout/cancel?plan=plus');
  await page.getByRole('link', { name: 'Retry checkout' }).click(); await page.waitForURL('**/checkout?plan=plus');
  await page.goto(base + '/checkout/success');
  await page.getByRole('heading', { name: 'Waiting for confirmation.' }).waitFor();
  results.push({ cancellationRetry: true, successUrlDoesNotGrantAccess: true });
  await writeFile('artifacts/billing/results.json', JSON.stringify(results, null, 2));
  console.log(`Passed ${results.length} billing browser checks (mocked Firebase/API, real app UI).`);
} finally { await browser.close(); }
