import { chromium } from '../node_modules/.browser-check/node_modules/playwright/index.mjs';

const browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE_PATH, headless: true });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  for (const width of [320, 375, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('http://127.0.0.1:5173/gacha-raid-resonance/');
    await page.getByRole('heading', { name: '累積統計', exact: true }).waitFor();
    // Separate local-only fixture root; never inject cheats into product code.
    await page.evaluate(async () => {
      const { createBattleController } = await import('/gacha-raid-resonance/src/ui/battleController.ts');
      const { createInitialGameState } = await import('/gacha-raid-resonance/src/game/engine.ts');
      const { calculateBossMaxHp } = await import('/gacha-raid-resonance/src/game/boss.ts');
      const { default: App } = await import('/gacha-raid-resonance/src/App.tsx');
      const rootModule = await import('/gacha-raid-resonance/node_modules/.vite/deps/react-dom_client.js');
      const reactModule = await import('/gacha-raid-resonance/node_modules/.vite/deps/react.js');
      const { createRoot } = rootModule.default ?? rootModule;
      const { createElement, StrictMode } = reactModule.default ?? reactModule;
      const state = { ...createInitialGameState(), stage: 20, highestStage: 50, bossHp: calculateBossMaxHp(20), specialGauge: 90, stacks: { FIRE: 3, WIND: 3, THUNDER: 3 }, jackpot: { pullsInWindow: 99, ssrInWindow: 2 } };
      window.effectsController = createBattleController({ initialState: state, rng: () => .999 });
      window.effectsRoot = createRoot(document.body.appendChild(document.createElement('div')));
      document.getElementById('root').remove();
      window.effectsRoot.render(createElement(StrictMode, null, createElement(App, { controller: window.effectsController })));
    });
    await page.getByRole('button', { name: 'NORMAL ×1', exact: true }).click();
    const live = page.getByRole('status', { name: '結果ハイライト' });
    await live.getByText('SSR獲得 1回', { exact: true }).waitFor();
    await live.getByText('JACKPOT！ 1回', { exact: true }).waitFor();
    if (!(await live.innerText()).includes('共鳴')) throw new Error('Missing resonance');
    const count = await page.getByText('累積NORMAL PULL', { exact: true }).locator('..').locator('dd').innerText();
    if (count !== '1') throw new Error('Statistics mismatch');
    const before = await page.evaluate(() => JSON.stringify(window.effectsController.getSnapshot()));
    await page.getByLabel('演出軽減', { exact: true }).check();
    if (await page.locator('.result-highlight').evaluate(e => getComputedStyle(e).animationName) !== 'none') throw new Error('Reduction failed');
    await page.getByLabel('演出軽減', { exact: true }).uncheck();
    await page.emulateMedia({ reducedMotion: 'reduce' });
    if (await page.locator('.result-highlight').evaluate(e => getComputedStyle(e).animationName) !== 'none') throw new Error('OS preference ignored');
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.getByRole('button', { name: '演出をスキップ' }).click();
    if (await page.locator('.result-highlight').evaluate(e => getComputedStyle(e).animationName) !== 'none') throw new Error('Skip failed');
    if (await page.evaluate(() => JSON.stringify(window.effectsController.getSnapshot())) !== before) throw new Error('Display changed battle state');
    await page.screenshot({ path: `node_modules/.browser-check/effects-${width}.png`, fullPage: true });
    await page.getByRole('button', { name: 'SPECIAL ×1', exact: true }).click();
    await live.getByText('MEGA_BURST 1回', { exact: true }).waitFor();
    // New controller for the one-time Stage50 clear fixture.
    await page.evaluate(async () => {
      const { createBattleController } = await import('/gacha-raid-resonance/src/ui/battleController.ts');
      const { createInitialGameState } = await import('/gacha-raid-resonance/src/game/engine.ts');
      const { default: App } = await import('/gacha-raid-resonance/src/App.tsx');
      const reactModule = await import('/gacha-raid-resonance/node_modules/.vite/deps/react.js');
      const { createElement, StrictMode } = reactModule.default ?? reactModule;
      window.effectsRoot.unmount();
      const rootModule = await import('/gacha-raid-resonance/node_modules/.vite/deps/react-dom_client.js');
      const { createRoot } = rootModule.default ?? rootModule;
      window.effectsRoot = createRoot(document.body.appendChild(document.createElement('div')));
      window.effectsController = createBattleController({ initialState: { ...createInitialGameState(), stage: 50, highestStage: 50, bossHp: 1 }, rng: () => .999 });
      window.effectsRoot.render(createElement(StrictMode, null, createElement(App, { controller: window.effectsController })));
    });
    await page.getByRole('button', { name: 'NORMAL ×1', exact: true }).click();
    await live.getByText('Stage 50 初回クリア！ おめでとうございます。', { exact: true }).waitFor();
    await page.screenshot({ path: `node_modules/.browser-check/clear-${width}.png`, fullPage: true });
    await page.getByRole('button', { name: 'NORMAL ×1', exact: true }).click();
    await page.waitForFunction(() => window.effectsController.getSnapshot().state.statistics.totalNormalPulls === 2 && !window.effectsController.getSnapshot().busy);
    if ((await live.innerText()).includes('初回クリア')) throw new Error('Clear replayed');
    if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw new Error('Horizontal overflow');
    console.log(JSON.stringify({ width, ssr: 'pass', resonance: 'pass', jackpot: 'pass', special: 'pass', statistics: 'pass', reducedAndSkip: 'pass', osReducedMotion: 'pass', firstClearOnly: 'pass', overflow: false }));
  }
  if (errors.length) throw new Error(errors.join('; '));
  console.log(JSON.stringify({ pageErrors: errors }));
} finally { await browser.close(); }
