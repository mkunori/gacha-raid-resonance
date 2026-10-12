import { chromium } from '../node_modules/.browser-check/node_modules/playwright/index.mjs';

const browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE_PATH, headless: true });
const url = process.env.BATTLE_UI_URL ?? 'http://127.0.0.1:5173/gacha-raid-resonance/';
const key = 'gacha-raid-resonance:save';
try {
  const context = await browser.newContext();
  await context.addInitScript(() => {
    window.saveTestWrites = 0;
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) {
      if (key === 'gacha-raid-resonance:save') window.saveTestWrites++;
      return original.call(this, key, value);
    };
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const stored = () => page.evaluate(key => JSON.parse(localStorage.getItem(key)), key);
  const flush = () => page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  async function idle() { await page.waitForFunction(() => !document.querySelector('button[aria-label="NORMAL ×1"]').disabled); }
  async function savedReload() {
    await flush();
    await page.getByLabel('保存状態', { exact: true }).filter({ hasText: '保存済み' }).waitFor();
    const before = await stored();
    await page.reload();
    await page.getByLabel('保存状態', { exact: true }).filter({ hasText: '復元しました' }).waitFor();
    if (JSON.stringify(await stored()) !== JSON.stringify(before)) throw new Error('Reload changed checkpoint');
    if (await page.locator('.result-highlight').count()) throw new Error('Replayed old highlight');
    return before;
  }
  for (const width of [320, 375, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(url);
    // Isolated browser context only; no production reset/import affordance is added.
    await page.evaluate(key => localStorage.removeItem(key), key);
    await page.reload();
    await page.getByRole('button', { name: 'NORMAL ×1', exact: true }).click();
    await idle();
    const first = await savedReload();
    if (!first.state.statistics.totalNormalPulls) throw new Error('PULL not saved');
    for (let i = 0; i < 200; i++) {
      await page.getByRole('button', { name: 'NORMAL ×10', exact: true }).click();
      await idle();
      await flush();
      const current = await stored();
      if (current.state.highestStage >= 6 && current.state.resonanceShards >= 14) break;
      if (i === 199) throw new Error('Could not reach Focus unlock');
    }
    await page.getByRole('button', { name: 'PULL POWER +1購入', exact: true }).click();
    const purchased = await savedReload();
    if (purchased.state.upgradeLevels.PULL_POWER !== 1 || purchased.state.spentShards.PULL_POWER !== 14) throw new Error('Purchase was lost');
    await page.getByRole('heading', { name: 'PULL POWER Lv 1', exact: true }).waitFor();
    await page.getByRole('button', { name: '無料RESPEC', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'RESPECを確定', exact: true }).click();
    const refunded = await savedReload();
    if (refunded.state.resonanceShards !== purchased.state.resonanceShards + 14 || refunded.state.upgradeLevels.PULL_POWER !== 0) throw new Error('RESPEC restore mismatch');
    await page.getByRole('radio', { name: /^WIND_THUNDER/ }).check();
    await page.getByLabel('演出軽減', { exact: true }).check();
    const settings = await savedReload();
    if (settings.state.focus !== 'WIND_THUNDER' || !settings.settings.reducedEffects) throw new Error('Focus/settings lost');
    if (!(await page.getByRole('radio', { name: /^WIND_THUNDER/ }).isChecked()) || !(await page.getByLabel('演出軽減', { exact: true }).isChecked())) throw new Error('Restored controls disagree');
    const metrics = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth }));
    if (metrics.scroll > width) throw new Error('Horizontal overflow');
    await page.screenshot({ path: `node_modules/.browser-check/save-${width}.png`, fullPage: true });
    console.log(JSON.stringify({ ...metrics, pullReload: 'pass', purchaseRespec: 'pass', focusSettings: 'pass' }));
  }

  async function installFixture(kind) {
    return page.evaluate(async ({ key, kind }) => {
      const { createInitialGameState } = await import('/gacha-raid-resonance/src/game/engine.ts');
      const { calculateBossMaxHp } = await import('/gacha-raid-resonance/src/game/boss.ts');
      const { serializeSaveData } = await import('/gacha-raid-resonance/src/storage/saveCodec.ts');
      const state = { ...createInitialGameState(), stage: 50, highestStage: 50, bossHp: calculateBossMaxHp(50), specialGauge: 600030 };
      state.statistics.totalNormalPulls = 49; state.statistics.bossesDefeated = 49;
      if (kind === 'normal') { state.pendingNormalPulls = 10100; state.normalPullQueue = { base: 10090, chain: 10 }; }
      if (kind === 'special') state.pendingSpecialPulls = 10020;
      const data = { saveVersion: 1, state, settings: { reducedEffects: true }, rng: { algorithm: 'mulberry32-v1', state: 12345678 } };
      localStorage.setItem(key, serializeSaveData(data));
      return data;
    }, { key, kind });
  }
  for (const kind of ['normal', 'special']) {
    const initial = await installFixture(kind);
    await page.reload();
    await page.getByRole('button', { name: '保留PULLを再開', exact: true }).waitFor();
    if (JSON.stringify(await stored()) !== JSON.stringify(initial)) throw new Error('Queue auto-executed on load');
    const expected = await page.evaluate(async ({ initial, kind }) => {
      const { resumePendingNormalPulls, resumePendingSpecialPulls } = await import('/gacha-raid-resonance/src/game/engine.ts');
      const { createCheckpointRandom } = await import('/gacha-raid-resonance/src/storage/random.ts');
      const rng = createCheckpointRandom(initial.rng);
      const result = (kind === 'normal' ? resumePendingNormalPulls : resumePendingSpecialPulls)(initial.state, rng.random);
      return { ...initial, state: result.state, rng: rng.getCheckpoint() };
    }, { initial, kind });
    const start = Date.now();
    await page.getByRole('button', { name: '保留PULLを再開', exact: true }).click();
    await page.getByLabel('PULL実行状態', { exact: true }).filter({ hasText: '安全上限' }).waitFor();
    await flush();
    const paused = await stored();
    const writesAtCap = await page.evaluate(() => window.saveTestWrites);
    if (!paused.state.pendingNormalPulls && !paused.state.pendingSpecialPulls) throw new Error('Queue lost at cap');
    await page.reload();
    if (await page.locator('.result-highlight').count()) throw new Error('Past cap highlight replay');
    await page.getByRole('button', { name: '保留PULLを再開', exact: true }).click();
    await idle();
    await flush();
    const actual = await stored();
    if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${kind} resumed state/RNG mismatch`);
    console.log(JSON.stringify({ kind, capReloadResume: 'pass', milliseconds: Date.now() - start, writesAtCap, remainingAtCap: paused.state.pendingNormalPulls + paused.state.pendingSpecialPulls }));
  }
  const thousandInitial = await installFixture('fresh');
  await page.reload();
  const expectedThousand = await page.evaluate(async initial => {
    const { executeNormalPulls } = await import('/gacha-raid-resonance/src/game/engine.ts');
    const { createCheckpointRandom } = await import('/gacha-raid-resonance/src/storage/random.ts');
    const rng = createCheckpointRandom(initial.rng);
    const result = executeNormalPulls(initial.state, 1000, rng.random);
    return { data: { ...initial, state: result.state, rng: rng.getCheckpoint() }, pulls: result.summary.actualPulls };
  }, thousandInitial);
  const thousandStart = Date.now();
  await page.evaluate(() => { window.saveTestFrames = 0; window.saveTestCounting = true; const tick = () => { if (window.saveTestCounting) { window.saveTestFrames++; requestAnimationFrame(tick); } }; requestAnimationFrame(tick); });
  await page.getByRole('button', { name: 'NORMAL ×1000', exact: true }).click();
  await idle();
  await flush();
  if (JSON.stringify(await stored()) !== JSON.stringify(expectedThousand.data)) throw new Error('1000+CHAIN checkpoint mismatch');
  const thousandMetrics = await page.evaluate(() => { window.saveTestCounting = false; return { frames: window.saveTestFrames, writes: window.saveTestWrites }; });
  console.log(JSON.stringify({ normal1000Saved: 'pass', pulls: expectedThousand.pulls, milliseconds: Date.now() - thousandStart, ...thousandMetrics }));
  // Real navigation during a live batch: pagehide flushes a successful chunk.
  await installFixture('fresh');
  await page.reload();
  await page.getByRole('button', { name: 'NORMAL ×1000', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[aria-label="PULL実行状態"]').textContent.includes('処理中'));
  await page.waitForTimeout(100);
  await page.reload();
  await page.getByRole('button', { name: '保留PULLを再開', exact: true }).waitFor();
  const interrupted = await stored();
  if (!interrupted.state.pendingNormalPulls || interrupted.state.statistics.totalNormalPulls <= 49) throw new Error('No committed batch checkpoint on reload');
  await page.getByRole('button', { name: '保留PULLを再開', exact: true }).click();
  await idle();
  console.log(JSON.stringify({ reloadDuringBatch: 'pass', pending: interrupted.state.pendingNormalPulls }));

  const tab = await context.newPage();
  await flush();
  await tab.goto(url);
  await page.getByLabel('演出軽減', { exact: true }).uncheck();
  await flush();
  await tab.getByLabel('保存状態', { exact: true }).filter({ hasText: '別のタブ' }).waitFor();
  await tab.close();
  if (errors.length) throw new Error(JSON.stringify(errors));
  console.log('multiTab=pass, pageErrors=0, realDevice=untested');
} finally { await browser.close(); }
