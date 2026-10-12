import { chromium } from '../node_modules/.browser-check/node_modules/playwright/index.mjs';

const browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE_PATH, headless: true });
try {
  const touch = process.env.UI_TOUCH === '1';
  const page = await browser.newPage({ hasTouch: touch, isMobile: touch });
  const activate = locator => touch ? locator.tap() : locator.click();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const url = process.env.BATTLE_UI_URL ?? 'http://127.0.0.1:5173/gacha-raid-resonance/';
  for (const width of (process.env.UI_WIDTHS?.split(',').map(Number) ?? [320, 375, 1280])) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(url);
    await page.getByRole('button', { name: 'PULL POWER +1購入' }).waitFor();
    if (await page.getByRole('button', { name: 'PULL POWER +1購入' }).isEnabled()) throw new Error('Initial RS0 must block purchase');
    if (await page.getByRole('radio', { name: /^FIRE_WIND/ }).isEnabled()) throw new Error('Initial Focus must be locked');
    // Separate test root, never a production cheat/query parameter.
    await page.evaluate(async () => {
      const { createBattleController } = await import('/gacha-raid-resonance/src/ui/battleController.ts');
      const { createInitialGameState } = await import('/gacha-raid-resonance/src/game/engine.ts');
      const { calculateBossMaxHp } = await import('/gacha-raid-resonance/src/game/boss.ts');
      const { default: App } = await import('/gacha-raid-resonance/src/App.tsx');
      const rootModule = await import('/gacha-raid-resonance/node_modules/.vite/deps/react-dom_client.js');
      const reactModule = await import('/gacha-raid-resonance/node_modules/.vite/deps/react.js');
      const { createRoot } = rootModule.default ?? rootModule;
      const { createElement, StrictMode } = reactModule.default ?? reactModule;
      const state = { ...createInitialGameState(), stage: 8, highestStage: 8, bossHp: calculateBossMaxHp(8), resonanceShards: 1000, specialGauge: 90 };
      window.progressionTest = createBattleController({ initialState: state, rng: () => 0 });
      const container = document.createElement('div');
      document.body.replaceChildren(container);
      createRoot(container).render(createElement(StrictMode, null, createElement(App, { controller: window.progressionTest })));
    });
    const buy = page.getByRole('button', { name: 'PULL POWER +1購入' });
    await buy.dblclick();
    if (await page.evaluate(() => window.progressionTest.getSnapshot().state.upgradeLevels.PULL_POWER) !== 1) throw new Error('Double purchase');
    await activate(page.getByRole('button', { name: 'RESONANCE POWER +1購入' }));
    await activate(page.getByRole('button', { name: 'SPECIAL POWER +1購入' }));
    for (const focus of ['FIRE_WIND', 'WIND_THUNDER', 'THUNDER_FIRE', 'BALANCED']) {
      await activate(page.getByRole('radio', { name: new RegExp(`^${focus}`) }));
      if (await page.evaluate(() => window.progressionTest.getSnapshot().state.focus) !== focus) throw new Error('Focus failed');
    }
    await page.keyboard.press('ArrowRight');
    if (!(await page.getByRole('radio', { name: /^FIRE_WIND/ }).isChecked())) throw new Error('Radio keyboard failed');
    const opener = page.getByRole('button', { name: '無料RESPEC', exact: true });
    await activate(opener);
    const dialog = page.getByRole('dialog', { name: '無料RESPECの確認' });
    await dialog.getByText('返還予定：84 RS').waitFor();
    const dialogRect = await page.locator('dialog').evaluate(element => { const rect = element.getBoundingClientRect(); return { width: rect.width, height: rect.height, left: rect.left, right: rect.right }; });
    if (dialogRect.left < 0 || dialogRect.right > width) throw new Error('Dialog clipped');
    if (!(await page.locator('dialog').evaluate(element => element.matches(':modal')))) throw new Error('Native modal not active');
    if (await page.locator(':focus').innerText() !== 'キャンセル') throw new Error('Initial dialog focus');
    await page.keyboard.press('Shift+Tab');
    if (await page.locator(':focus').innerText() !== 'RESPECを確定') throw new Error('Focus trap');
    await page.keyboard.press('Tab');
    if (await page.locator(':focus').innerText() !== 'キャンセル') throw new Error('Focus wrap');
    await page.screenshot({ path: `node_modules/.browser-check/respec-${width}.png`, fullPage: true });
    await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
    const enlarged = await page.evaluate(() => {
      const dialog = document.querySelector('dialog');
      const rect = dialog.getBoundingClientRect();
      return { scroll: document.documentElement.scrollWidth, width: innerWidth, dialogScroll: dialog.scrollWidth, dialogClient: dialog.clientWidth, top: rect.top, bottom: rect.bottom, height: innerHeight,
        clipped: [...document.querySelectorAll('button, dd')].filter(element => element.scrollWidth > element.clientWidth + 1).map(element => element.textContent) };
    });
    if (enlarged.scroll > enlarged.width || enlarged.dialogScroll > enlarged.dialogClient + 1 || enlarged.top < 0 || enlarged.bottom > enlarged.height || enlarged.clipped.length) throw new Error(`200% clipping: ${JSON.stringify(enlarged)}`);
    await page.getByRole('button', { name: 'RESPECを確定', exact: true }).scrollIntoViewIfNeeded();
    await page.evaluate(() => { document.documentElement.style.fontSize = ''; });
    await page.keyboard.press('Escape');
    if (await page.locator(':focus').innerText() !== '無料RESPEC') throw new Error('Focus not restored');
    if (await page.evaluate(() => window.progressionTest.getSnapshot().state.resonanceShards) !== 916) throw new Error('Cancel mutated RS');
    await activate(opener);
    await activate(page.getByRole('button', { name: 'RESPECを確定', exact: true }));
    if (await page.evaluate(() => window.progressionTest.getSnapshot().state.resonanceShards) !== 1000) throw new Error('Refund failed');
    if (await page.locator(':focus').getAttribute('id') !== 'upgrade-title') throw new Error('Confirm fallback focus failed');
    if (await opener.isEnabled()) throw new Error('Empty refund should be disabled');
    // Repeated touch controls after progression operations; no fixture mutations.
    for (const name of ['NORMAL ×1', 'NORMAL ×10', 'SPECIAL ×1']) {
      await activate(page.getByRole('button', { name, exact: true }));
      await page.waitForFunction(() => !window.progressionTest.getSnapshot().busy);
    }
    const dimensions = await page.evaluate(() => ({ viewport: innerWidth, scroll: document.documentElement.scrollWidth }));
    if (dimensions.scroll > width) throw new Error('Horizontal overflow');
    const toggle = page.getByLabel('演出軽減', { exact: true });
    const beforeDisplay = await page.evaluate(() => JSON.stringify(window.progressionTest.getSnapshot()));
    await toggle.focus(); await page.keyboard.press('Space');
    if (!(await toggle.isChecked())) throw new Error('Checkbox Space failed');
    if (await page.evaluate(() => JSON.stringify(window.progressionTest.getSnapshot())) !== beforeDisplay) throw new Error('Display mutated battle');
    await page.screenshot({ path: `node_modules/.browser-check/progression-${width}.png`, fullPage: true });
    console.log(JSON.stringify({ width, ...dimensions, touch, dialog: dialogRect, text200: 'pass', purchase: 'pass', doubleClick: 'pass', fourFocus: 'pass', keyboard: 'pass', modal: 'pass', escape: 'pass', refund: 'pass', normalSpecialSequence: 'pass' }));
  }
  if (errors.length) throw new Error(errors.join('; '));
  console.log(JSON.stringify({ pageErrors: errors }));
} finally { await browser.close(); }
