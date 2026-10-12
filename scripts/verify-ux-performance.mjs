import { chromium } from '../node_modules/.browser-check/node_modules/playwright/index.mjs';
import { writeFile } from 'node:fs/promises';

// Optional local Edge/Playwright check; no timing thresholds or product debug API.
const browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE_PATH, headless: true });
const report = { browser: browser.version(), platform: process.platform, layout: [], workloads: [] };
const baseline = process.env.UX_BASELINE === '1';
const assert = (condition, message) => { if (!condition) throw new Error(message); };
try {
  for (const width of [280, 320, 375, 390, 768, 1280]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, hasTouch: true, isMobile: width < 768, deviceScaleFactor: 1 });
    const page = await context.newPage();
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto('http://127.0.0.1:5173/gacha-raid-resonance/');
    const pull = page.getByRole('button', { name: 'NORMAL ×10', exact: true });
    await pull.tap();
    await page.waitForFunction(() => document.querySelector('[aria-label="PULL実行状態"]').textContent.includes('次のPULL'));
    const dimensions = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth, pageHeight: document.documentElement.scrollHeight, toggleHeight: document.querySelector('input[type=checkbox]').closest('label').getBoundingClientRect().height, minButtonHeight: Math.min(...Array.from(document.querySelectorAll('button'), b => b.getBoundingClientRect().height)) }));
    assert(dimensions.scroll <= width && dimensions.minButtonHeight >= 44, `layout ${width}: ${JSON.stringify(dimensions)}`);
    await page.getByRole('heading', { name: '累積統計', exact: true }).scrollIntoViewIfNeeded();
    const returnLink = page.getByRole('link', { name: 'PULLへ戻る', exact: true });
    const hasReturn = await returnLink.count() > 0;
    if (hasReturn) {
      await returnLink.tap();
      assert(await page.locator(':focus').getAttribute('id') === 'pull-title', 'Return link must focus PULL heading');
      await page.keyboard.press('Tab');
      assert(await page.locator(':focus').getAttribute('aria-label') === 'NORMAL ×1', 'Return must restore keyboard operation path');
    }
    await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
    const zoomScroll = await page.evaluate(() => document.documentElement.scrollWidth);
    if (!baseline) assert(zoomScroll <= width && dimensions.toggleHeight >= 44 && hasReturn, `zoom/touch/navigation ${width}`);
    await page.screenshot({ path: `node_modules/.browser-check/ux-${baseline ? 'before' : 'after'}-${width}.png`, fullPage: true });
    report.layout.push({ ...dimensions, width, text200Scroll: zoomScroll, hasReturn, errors });
    assert(errors.length === 0, errors.join(';'));
    await context.close();
  }

  console.log(JSON.stringify({ layout: report.layout }));
  const page = await browser.newPage({ viewport: { width: 390, height: 900 }, hasTouch: true, isMobile: true });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => {
    const nativeSet = window.setTimeout.bind(window), nativeClear = window.clearTimeout.bind(window);
    const pending = new Set();
    window.setTimeout = (callback, delay, ...args) => {
      const id = nativeSet(() => { pending.delete(id); callback(...args); }, delay);
      pending.add(id); return id;
    };
    window.clearTimeout = id => { pending.delete(id); nativeClear(id); };
    window.uxTimers = pending;
  });
  await page.goto('http://127.0.0.1:5173/gacha-raid-resonance/');
  await page.getByRole('button', { name: 'NORMAL ×1', exact: true }).waitFor();
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  const metrics = async () => {
    await cdp.send('HeapProfiler.collectGarbage');
    const { metrics } = await cdp.send('Performance.getMetrics');
    return Object.fromEntries(metrics.filter(m => ['JSHeapUsedSize', 'Nodes', 'JSEventListeners'].includes(m.name)).map(m => [m.name, m.value]));
  };
  async function fixture(kind) {
    await page.evaluate(async kind => {
      const { createBattleController } = await import('/gacha-raid-resonance/src/ui/battleController.ts');
      const core = await import('/gacha-raid-resonance/src/game/engine.ts');
      const { default: App } = await import('/gacha-raid-resonance/src/App.tsx');
      const reactModule = await import('/gacha-raid-resonance/node_modules/.vite/deps/react.js');
      const { createElement, StrictMode, Profiler } = reactModule.default ?? reactModule;
      const rootModule = await import('/gacha-raid-resonance/node_modules/.vite/deps/react-dom_client.js');
      const { createRoot } = rootModule.default ?? rootModule;
      window.uxRoot?.unmount();
      const container = document.createElement('div'); document.body.replaceChildren(container);
      const initial = core.createInitialGameState(); initial.highestStage = 50; initial.resonanceShards = 10_000;
      if (kind === 'special') initial.specialGauge = 20_001 * 30;
      const stream = () => {
        let position = 0, seed = 12345678;
        return () => {
          if (kind === 'chain') { const index = position++; return index < 30_000 && index % 3 === 2 ? .93 : 0; }
          seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
          return seed / 4294967296;
        };
      };
      let calls = 0; const rng = stream();
      window.ux = { core, expected: initial, expectedRng: stream(), calls: () => calls, commits: 0, notifications: 0, ids: new Set() };
      window.ux.controller = createBattleController({ initialState: initial, rng: () => { calls++; return rng(); } });
      window.ux.subscriptions = 0;
      const subscribe = window.ux.controller.subscribe;
      window.ux.controller.subscribe = listener => {
        window.ux.subscriptions++;
        const stop = subscribe(listener); let active = true;
        return () => { if (active) { active = false; window.ux.subscriptions--; stop(); } };
      };
      window.ux.stop = window.ux.controller.subscribe(() => { window.ux.notifications++; const h = window.ux.controller.getSnapshot().highlight; if (h) window.ux.ids.add(h.id); });
      window.uxRoot = createRoot(container);
      window.uxRoot.render(createElement(StrictMode, null, createElement(Profiler, { id: 'ux', onRender: () => window.ux.commits++ }, createElement(App, { controller: window.ux.controller }))));
    }, kind);
    await page.getByRole('button', { name: 'NORMAL ×1', exact: true }).waitFor();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  }
  async function operation(operation, resume = false) {
    return page.evaluate(async ({ operation, resume }) => {
      const u = window.ux, c = u.controller;
      const expected = resume
        ? (u.expected.pendingNormalPulls ? u.core.resumePendingNormalPulls(u.expected, u.expectedRng, 10_000) : u.core.resumePendingSpecialPulls(u.expected, u.expectedRng, 10_000))
        : (operation.kind === 'normal' ? u.core.executeNormalPulls(u.expected, operation.count, u.expectedRng, 10_000) : u.core.executeSpecialPulls(u.expected, operation.count, u.expectedRng, 10_000));
      u.expected = expected.state;
      let frames = 0, active = true, handle;
      const tick = () => { if (active) { frames++; handle = requestAnimationFrame(tick); } }; handle = requestAnimationFrame(tick);
      const commits = u.commits, notifications = u.notifications, calls = u.calls();
      const start = performance.now();
      const running = resume ? c.resume() : c.start(operation);
      const conflict = c.start({ kind: 'normal', count: 1 });
      const state = c.getSnapshot().state;
      const rejected = !c.purchase('PULL_POWER', state) && !c.respec(state) && !c.changeFocus('FIRE_WIND', state);
      await running; const milliseconds = performance.now() - start;
      active = false; cancelAnimationFrame(handle);
      if (await conflict || !rejected) throw new Error('Competing operation accepted');
      const snapshot = c.getSnapshot();
      if (JSON.stringify(snapshot.state) !== JSON.stringify(expected.state)) throw new Error('Core state mismatch');
      const canonical = value => value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
      if (JSON.stringify(canonical(snapshot.highlight.result.value)) !== JSON.stringify(canonical(expected.summary))) throw new Error('Boundary summary mismatch');
      const actualPulls = expected.summary.actualPulls;
      if (u.calls() - calls !== actualPulls * (snapshot.highlight.result.kind === 'normal' ? 3 : 1)) throw new Error('RNG count mismatch');
      return { milliseconds, frames, commits: u.commits - commits, notifications: u.notifications - notifications, actualPulls, stage: snapshot.state.stage, pending: snapshot.state.pendingNormalPulls + snapshot.state.pendingSpecialPulls, paused: snapshot.paused, summaryBytes: JSON.stringify(snapshot.result).length, highlightNodes: document.querySelectorAll('.result-highlight').length, timers: window.uxTimers.size };
    }, { operation, resume });
  }
  for (const kind of ['normal', 'chain', 'special']) {
    await fixture(kind);
    const before = await metrics();
    const runs = [];
    runs.push(await operation({ kind: kind === 'special' ? 'special' : 'normal', count: kind === 'special' ? 'MAX' : kind === 'chain' ? 1 : 1000 }));
    while (await page.evaluate(() => window.ux.controller.getSnapshot().state.pendingNormalPulls + window.ux.controller.getSnapshot().state.pendingSpecialPulls > 0)) runs.push(await operation(null, true));
    if (kind === 'chain') assert(JSON.stringify(runs.map(r => r.actualPulls)) === '[10000,10000,10000,1]', 'CHAIN pause/resume counts');
    if (kind === 'special') assert(JSON.stringify(runs.map(r => r.actualPulls)) === '[10000,10000,1]', 'SPECIAL fixed reservations');
    assert(runs.every(r => r.frames > 0 && r.summaryBytes < 1000 && r.highlightNodes <= 1), 'Bounded UI and rendering opportunity');
    report.workloads.push({ kind, before, runs, after: await metrics() });
    await page.evaluate(() => window.ux.stop());
  }
  // Repeat the same seeded stream across 100 real operations; compare every state.
  await fixture('normal');
  const repeatBefore = await metrics();
  const started = Date.now();
  let repeatMiddle;
  for (let i = 0; i < 100; i++) { await operation({ kind: 'normal', count: 10 }); if (i === 49) repeatMiddle = await metrics(); }
  const repeatAfter = await metrics();
  const repeated = await page.evaluate(() => ({ operations: window.ux.ids.size, commits: window.ux.commits, notifications: window.ux.notifications, normalPulls: window.ux.controller.getSnapshot().state.statistics.totalNormalPulls, stage: window.ux.controller.getSnapshot().state.stage, shards: window.ux.controller.getSnapshot().state.resonanceShards, highlights: document.querySelectorAll('.result-highlight').length, timers: window.uxTimers.size }));
  assert(repeated.operations === 100 && repeated.highlights <= 1, 'Unbounded or duplicated notifications');
  report.repeated = { ...repeated, milliseconds: Date.now() - started, before: repeatBefore, middle50: repeatMiddle, after: repeatAfter };
  report.cleanup = await page.evaluate(() => { window.ux.stop(); window.uxRoot.unmount(); window.uxRoot = null; return { subscriptions: window.ux.subscriptions, timers: window.uxTimers.size }; });
  assert(report.cleanup.subscriptions === 0 && report.cleanup.timers === 0, 'Subscriptions/timers retained after unmount');
  report.unmounted = await metrics();
  report.errors = errors; assert(errors.length === 0, errors.join(';'));
  await writeFile(`node_modules/.browser-check/ux-${baseline ? 'before' : 'after'}.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally { await browser.close(); }
