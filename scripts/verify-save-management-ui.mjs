import { chromium } from '../node_modules/.browser-check/node_modules/playwright/index.mjs';
import { readFile } from 'node:fs/promises';

const browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE_PATH, headless: true });
const url = process.env.BATTLE_UI_URL ?? 'http://127.0.0.1:5173/gacha-raid-resonance/';
const key = 'gacha-raid-resonance:save';
try {
  const context = await browser.newContext(); // disposable profile, never user's existing data
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const stored = () => page.evaluate(key => localStorage.getItem(key), key);
  const flush = () => page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  const idle = () => page.waitForFunction(() => !document.querySelector('button[aria-label="NORMAL ×1"]').disabled);
  const status = () => page.getByLabel('セーブ管理の通知', { exact: true });
  const choose = json => page.getByLabel(/JSONファイルをImport/).setInputFiles({ name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(json) });
  async function exported(raw = false) {
    const waiting = page.waitForEvent('download');
    await page.getByRole('button', { name: raw ? '未検証の保存元データをバックアップ' : '現在の進行をExport', exact: true }).click();
    const download = await waiting;
    if (!download.suggestedFilename().endsWith('.json') || (raw && !download.suggestedFilename().includes('UNVERIFIED'))) throw Error('Filename');
    return readFile(await download.path(), 'utf8');
  }
  async function confirmReload(name) {
    const loading = page.waitForEvent('load');
    await page.getByRole('dialog').getByRole('button', { name, exact: true }).click();
    await loading;
    await page.getByRole('heading', { name: 'セーブデータ管理', exact: true }).waitFor();
  }
  for (const [index, width] of [320, 375, 1280].entries()) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(url);
    // Legal dev-only fixture: retain upgrades, ledger, Focus, settings and a queue.
    const data = await page.evaluate(async ({ key, index }) => {
      const { createInitialGameState } = await import('/gacha-raid-resonance/src/game/engine.ts');
      const { calculateBossMaxHp } = await import('/gacha-raid-resonance/src/game/boss.ts');
      const { purchaseUpgrade } = await import('/gacha-raid-resonance/src/game/upgrades.ts');
      const { serializeSaveData } = await import('/gacha-raid-resonance/src/storage/saveCodec.ts');
      let state = { ...createInitialGameState(), stage: 51, highestStage: 51, bossHp: calculateBossMaxHp(51), resonanceShards: 1000, specialGauge: 307 };
      state.statistics.totalNormalPulls = 50; state.statistics.bossesDefeated = 50;
      for (const kind of ['PULL_POWER', 'RESONANCE_POWER', 'SPECIAL_POWER']) state = purchaseUpgrade(state, kind);
      state.focus = 'WIND_THUNDER';
      if (index === 1) state.pendingSpecialPulls = 10;
      else { state.pendingNormalPulls = 203; state.normalPullQueue = { base: 200, chain: 3 }; }
      const data = { saveVersion: 1, state, settings: { reducedEffects: true }, rng: { algorithm: 'mulberry32-v1', state: 12345678 } };
      localStorage.setItem(key, serializeSaveData(data));
      localStorage.setItem('unrelated-save-test', 'keep');
      return data;
    }, { key, index });
    await page.reload();
    const expected = await stored();
    const backup = await exported();
    if (backup !== expected) throw Error('Export not latest checkpoint');
    const opener = page.getByRole('button', { name: 'セーブを削除して最初から', exact: true });
    await opener.click(); await page.keyboard.press('Escape');
    if (await stored() !== expected) throw Error('Esc changed data');
    await opener.focus(); await page.keyboard.press('Enter');
    await page.getByRole('dialog').getByRole('button', { name: 'キャンセル', exact: true }).waitFor();
    await page.keyboard.press('Tab');
    if (!await page.getByRole('button', { name: '削除して最初から', exact: true }).evaluate(e => e === document.activeElement)) throw Error('Dialog Tab');
    await page.keyboard.press('Shift+Tab'); await page.keyboard.press('Enter');
    if (!await opener.evaluate(e => e === document.activeElement)) throw Error('Focus return');
    await opener.click(); await confirmReload('削除して最初から');
    await flush();
    const fresh = JSON.parse(await stored());
    if (fresh.state.stage !== 1 || fresh.state.statistics.totalNormalPulls !== 0 || fresh.rng.state === data.rng.state) throw Error('Delete did not start fresh');
    if (await page.evaluate(() => localStorage.getItem('unrelated-save-test')) !== 'keep') throw Error('Other key deleted');
    const beforeImport = await stored();
    await choose(backup); await page.getByRole('dialog').waitFor();
    await page.getByRole('dialog').getByText('Importする進行', { exact: true }).waitFor();
    await page.getByRole('dialog').getByRole('button', { name: 'キャンセル', exact: true }).click();
    if (await stored() !== beforeImport) throw Error('Import cancel changed data');
    await choose(backup); await confirmReload('Importを確定');
    if (await stored() !== backup) throw Error('Imported checkpoint differs');
    if (await page.locator('.result-highlight').count()) throw Error('Past highlight replay');
    await page.getByText(/Stage 50 クリア済み/).waitFor();
    await page.getByRole('button', { name: '保留PULLを再開', exact: true }).click();
    await idle(); await flush();
    const actual = JSON.parse(await stored());
    const expectedResume = await page.evaluate(async data => {
      const engine = await import('/gacha-raid-resonance/src/game/engine.ts');
      const { createCheckpointRandom } = await import('/gacha-raid-resonance/src/storage/random.ts');
      const rng = createCheckpointRandom(data.rng);
      const result = data.state.pendingNormalPulls ? engine.resumePendingNormalPulls(data.state, rng.random) : engine.resumePendingSpecialPulls(data.state, rng.random);
      return { ...data, state: result.state, rng: rng.getCheckpoint() };
    }, data);
    if (JSON.stringify(actual) !== JSON.stringify(expectedResume)) throw Error('Imported queue resume differs');
    if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw Error('Overflow');
    await page.screenshot({ path: `node_modules/.browser-check/manage-${width}.png`, fullPage: true });
    console.log(JSON.stringify({ width, exportDeleteImportReloadResume: 'pass', keyboard: 'pass', queue: index === 1 ? 'special' : 'normal/chain', pageErrors: errors.length }));
  }
  // Size, JSON, future version and save failure do not replace existing raw.
  const valid = await exported();
  for (const invalid of ['{', '{"saveVersion":99}', 'x'.repeat(131073)]) {
    const before = await stored(); await choose(invalid);
    await status().filter({ hasText: 'Import不可' }).waitFor();
    if (await stored() !== before || await page.getByRole('dialog').count()) throw Error('Invalid import changed data');
  }
  await choose(valid); await page.getByRole('dialog').waitFor();
  const beforeFailure = await stored();
  await page.evaluate(() => { window.originalSet = Storage.prototype.setItem; Storage.prototype.setItem = function() { throw new DOMException('injected quota', 'QuotaExceededError'); }; });
  await page.getByRole('button', { name: 'Importを確定', exact: true }).click();
  await status().filter({ hasText: '変更できません' }).waitFor();
  if (await stored() !== beforeFailure) throw Error('Failed write altered raw');
  await page.evaluate(() => { Storage.prototype.setItem = window.originalSet; });
  // Other tab changes data while deletion dialog is open.
  await page.getByRole('button', { name: 'セーブを削除して最初から', exact: true }).click();
  const tab = await context.newPage(); await tab.goto(url);
  await tab.getByLabel('演出軽減', { exact: true }).uncheck();
  await tab.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  const external = await stored();
  await page.getByRole('button', { name: '削除して最初から', exact: true }).click();
  await status().filter({ hasText: '保存データが変更' }).waitFor();
  if (await stored() !== external) throw Error('Overwrote other tab');
  await tab.close();
  // Protected raw backup and explicit recovery. No deletion before user confirmation.
  await page.evaluate(key => localStorage.setItem(key, '{broken original'), key); await page.reload();
  await page.getByLabel('保存状態', { exact: true }).filter({ hasText: '読み込めません' }).waitFor();
  if (await exported(true) !== '{broken original') throw Error('Raw backup changed');
  await choose(valid); await confirmReload('Importを確定');
  if (await stored() !== valid) throw Error('Corrupt recovery failed');
  if (errors.length) throw Error(JSON.stringify(errors));
  console.log('invalid/oversize/quota/tab-conflict/raw-backup/recovery=pass; realDevice=untested');
} finally { await browser.close(); }
