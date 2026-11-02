import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || undefined });
const widths = [320, 375, 390, 430, 768, 1024, 1280, 1366, 1440, 1536, 1920, 2560];
const results = [];
await mkdir('artifacts/responsive', { recursive: true });
try {
  const page = await browser.newPage({ reducedMotion: 'reduce' });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('requestfailed', request => errors.push(`Failed request: ${request.url()}`));
  page.on('response', response => { if (response.status() >= 400) errors.push(`HTTP ${response.status()}: ${response.url()}`); });
  for (const width of widths) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto('http://127.0.0.1:5174');
    await page.getByRole('heading', { level: 1 }).waitFor();
    const theme = await page.evaluate(() => ({
      background: getComputedStyle(document.body).backgroundColor,
      card: getComputedStyle(document.querySelector('.main-feature')).backgroundColor,
      font: getComputedStyle(document.body).fontFamily,
      stylesheets: document.querySelectorAll('style[data-vite-dev-id]').length,
    }));
    if (theme.background !== 'rgb(9, 7, 15)' || theme.card !== 'rgb(27, 20, 40)' || theme.stylesheets < 7 || !theme.font.includes('system-ui')) {
      throw new Error(`Theme or CSS loading regression: ${JSON.stringify(theme)}`);
    }
    const layout = await page.evaluate(() => {
      const rect = selector => document.querySelector(selector).getBoundingClientRect();
      const overflow = [...document.querySelectorAll('body *')].filter(el => {
        const r = el.getBoundingClientRect();
        return r.width && (r.left < -1 || r.right > innerWidth + 1 || el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).display !== 'inline');
      }).map(el => el.className || el.tagName);
      const cards = [...document.querySelectorAll('.main-feature')].map(el => el.getBoundingClientRect());
      const overlap = cards.some((a, i) => cards.slice(i + 1).some(b => a.left < b.right - 1 && a.right > b.left + 1 && a.top < b.bottom - 1 && a.bottom > b.top + 1));
      return { overflow, overlap, columns: getComputedStyle(document.querySelector('.main-feature-grid')).gridTemplateColumns.split(' ').length, container: rect('.main-content').width, aligned: Math.abs(rect('.navbar').left - rect('.main-content').left) < 1 && Math.abs(rect('.site-footer').left - rect('.main-content').left) < 1, textareaFont: getComputedStyle(document.querySelector('textarea')).fontSize };
    });
    const expectedColumns = width >= 1024 ? 3 : width >= 768 ? 2 : 1;
    if (layout.overflow.length || layout.overlap || !layout.aligned || layout.columns !== expectedColumns) throw new Error(JSON.stringify({ width, ...layout }));
    if (await page.locator('.nav-menu-toggle').isVisible()) await page.locator('.nav-menu-toggle').click();
    await page.locator('.nav-links a[href="#features"]').click();
    if (!page.url().endsWith('#features')) throw new Error('Feature navigation failed');
    await page.locator('.main-actions a[href="#playground"]').click();
    await page.getByLabel('Your quick note').fill('Responsive note at ' + width);
    await page.getByRole('button', { name: 'Keep this thought' }).click();
    if (!(await page.getByRole('status').textContent()).includes('Responsive note at ' + width)) throw new Error('Note save failed');
    await page.getByLabel('Your quick note').fill('x'.repeat(1000));
    await page.getByRole('button', { name: 'Keep this thought' }).click();
    if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw new Error('Long note overflow');
    await page.goto('http://127.0.0.1:5174');
    await page.getByRole('heading', { level: 1 }).waitFor();
    if ([375, 768, 1440, 2560].includes(width)) await page.screenshot({ path: `artifacts/responsive/${width}.png`, fullPage: true });
    results.push({ width, ...layout, theme, noteSave: 'passed', longNote: 'passed', navigation: 'passed' });
  }
  if (errors.length) throw new Error(errors.join('\n'));
  await writeFile('artifacts/responsive/results.json', JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
} finally { await browser.close(); }
