import { chromium } from '../node_modules/.browser-check/node_modules/playwright/index.mjs';
const browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE_PATH, headless: true });
const page = await browser.newPage();
await page.addInitScript(() => localStorage.removeItem('gacha-raid-resonance:save'));
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const url = process.env.BATTLE_UI_URL ?? 'http://127.0.0.1:5173/gacha-raid-resonance/';
for (const width of [320, 375, 1280]) {
  await page.setViewportSize({ width, height: 900 });
  await page.goto(url);
  await page.getByRole('button', { name: 'NORMAL ×1', exact: true }).waitFor();
  const dimensions = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth, minButtonHeight: Math.min(...[...document.querySelectorAll('button')].map(b => b.getBoundingClientRect().height)) }));
  if (dimensions.scroll > width || dimensions.minButtonHeight < 44) throw new Error(JSON.stringify(dimensions));
  await page.keyboard.press('Tab');
  if (await page.locator(':focus').getAttribute('aria-label') !== 'NORMAL ×1') throw new Error('Keyboard focus failed');
  const before = await page.getByRole('progressbar').getAttribute('aria-valuetext');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('[aria-label="PULL実行状態"]').textContent.includes('次のPULL'));
  const after = await page.getByRole('progressbar').getAttribute('aria-valuetext');
  if (before === after) throw new Error('HP did not update');
  await page.getByRole('button', { name: 'NORMAL ×10', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[aria-label="PULL実行状態"]').textContent.includes('次のPULL'));
  await page.screenshot({ path: `node_modules/.browser-check/battle-${width}.png`, fullPage: true });
  console.log(JSON.stringify({ viewport: width, ...dimensions, keyboard: 'pass', normal1and10: 'pass', hpBefore: before, hpAfter: after }));
}
await page.evaluate(async () => {
  const { createBattleController } = await import('/gacha-raid-resonance/src/ui/battleController.ts');
  const { createInitialGameState } = await import('/gacha-raid-resonance/src/game/engine.ts');
  const { default: App } = await import('/gacha-raid-resonance/src/App.tsx');
  const rootModule = await import('/gacha-raid-resonance/node_modules/.vite/deps/react-dom_client.js'); const createRoot = rootModule.createRoot ?? rootModule.default.createRoot;
  const reactModule = await import('/gacha-raid-resonance/node_modules/.vite/deps/react.js'); const createElement = reactModule.createElement ?? reactModule.default.createElement;
  const state = createInitialGameState(); state.highestStage = 50;
  let seed = 12345678;
  const rng = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  window.battleTest = createBattleController({ initialState: state, rng });
  const container = document.createElement('div');
  document.body.replaceChildren(container);
  createRoot(container).render(createElement(App, { controller: window.battleTest }));
});
await page.getByRole('button', { name: 'NORMAL ×1000', exact: true }).waitFor();
const performanceResult = await page.evaluate(async () => {
  let frames = 0, renders = 0;
  const stop = window.battleTest.subscribe(() => renders++);
  let running = true;
  function tick() { if (running) { frames++; requestAnimationFrame(tick); } }
  requestAnimationFrame(tick);
  const start = performance.now();
  await window.battleTest.start({ kind: 'normal', count: 1000 });
  running = false; stop();
  const snapshot = window.battleTest.getSnapshot();
  return { milliseconds: performance.now()-start, frames, storeNotifications: renders, summaryBytes: JSON.stringify(snapshot.result).length, actualPulls: snapshot.result.value.actualPulls, stage: snapshot.state.stage, error: snapshot.error };
});
if (performanceResult.error || performanceResult.frames < 2 || performanceResult.summaryBytes > 1000 || performanceResult.storeNotifications > 30) throw new Error(JSON.stringify(performanceResult));
console.log(JSON.stringify({ normal1000: performanceResult }));
await page.getByRole('button', { name: 'SPECIAL ×MAX', exact: true }).click();
await page.waitForFunction(() => document.querySelector('[aria-label="PULL実行状態"]').textContent.includes('次のPULL'));
console.log(JSON.stringify({ specialMax: 'pass', consoleErrors: errors }));
if (errors.length) throw new Error(errors.join('; '));
await browser.close();
