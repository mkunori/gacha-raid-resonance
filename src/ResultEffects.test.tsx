// @vitest-environment jsdom
import { StrictMode } from 'react'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { ResultEffects } from './components/ResultEffects'
import { highlightFacts } from './ui/highlightFacts'
import { StatisticsPanel } from './components/StatisticsPanel'
import { calculateBossMaxHp } from './game/boss'
import { createInitialGameState, executeNormalPulls, executeSpecialPulls } from './game/engine'
import { purchaseUpgrade } from './game/upgrades'
import { seededRng } from './test/random'
import { createBattleController, type ResultSummary } from './ui/battleController'

afterEach(cleanup)
const frame = async () => {}
function initial(stage = 50) {
  return { ...createInitialGameState(), stage, highestStage: stage, bossHp: calculateBossMaxHp(stage), specialGauge: 30_000, resonanceShards: 1000 }
}
function normal(): ResultSummary & { kind: 'normal' } {
  return { kind: 'normal', value: { actualPulls: 10, pendingPulls: 0, chainAdded: 0, stagesAdvanced: 0, clearedGame: false, earnedShards: 0, ssrCount: 0, jackpotCount: 0, resonanceCounts: { FLAME_STORM: 0, THUNDER_STORM: 0, OVERLOAD: 0 }, effectCounts: { NONE: 10, CHAIN: 0, CHARGE: 0, BOOST: 0 } } }
}

describe('aggregate facts and accessible effects', () => {
  it.each([0, 1, 7])('SSR count %s is factual and contains no invented attribute/order', count => {
    const result = normal(); result.value.ssrCount = count
    expect(highlightFacts(result)).toEqual(count ? [`SSR獲得 ${count}回`] : [])
  })
  it.each(['FLAME_STORM', 'THUNDER_STORM', 'OVERLOAD'] as const)('highlights %s separately', resonance => {
    const result = normal(); result.value.resonanceCounts[resonance] = 3
    render(<ResultEffects highlight={{ id: 1, result }} />)
    expect(screen.getByRole('status', { name: '結果ハイライト' }).textContent).toContain(`${resonance}共鳴 3回`)
  })
  it.each([0, 1, 4])('JACKPOT %s, CHAIN and defeated bosses are aggregate facts', count => {
    const result = normal(); result.value.jackpotCount = count; result.value.effectCounts.CHAIN = 2; result.value.chainAdded = 6; result.value.stagesAdvanced = 3
    const facts = highlightFacts(result)
    expect(facts).toContain('CHAIN発動 2回・追加 6 PULL')
    expect(facts).toContain('ボス撃破 3体')
    expect(facts.some(fact => fact.startsWith('JACKPOT'))).toBe(count > 0)
  })
  it.each(['STRIKE', 'BURST', 'MEGA_BURST'] as const)('shows exact SPECIAL %s counts', special => {
    const result: ResultSummary = { kind: 'special', value: { actualPulls: 2, pendingPulls: 0, stagesAdvanced: 0, clearedGame: false, earnedShards: 0, gaugeSpent: 60, resultCounts: { STRIKE: 0, BURST: 0, MEGA_BURST: 0 } } }
    result.value.resultCounts[special] = 2
    expect(highlightFacts(result)).toEqual([`${special} 2回`])
  })
  it('keeps important text after reduction/skip, and uses one bounded keyed banner', () => {
    const result = normal(); result.value.ssrCount = 2; result.value.clearedGame = true
    const view = render(<StrictMode><ResultEffects highlight={{ id: 1, result }} /></StrictMode>)
    fireEvent.click(screen.getByLabelText('演出軽減'))
    expect(document.querySelector('.reduced-effects')).toBeTruthy()
    fireEvent.click(screen.getByLabelText('演出軽減'))
    expect(document.querySelector('.reduced-effects')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '演出をスキップ' }))
    expect(document.querySelector('.reduced-effects')).toBeTruthy()
    expect(screen.getByText('Stage 50 初回クリア！ おめでとうございます。')).toBeTruthy()
    view.rerender(<StrictMode><ResultEffects highlight={{ id: 2, result }} /></StrictMode>)
    expect(document.querySelector('.reduced-effects')).toBeNull()
    expect(document.querySelectorAll('.result-highlight')).toHaveLength(1)
  })
  it('does not animate or announce an empty highlight', () => {
    render(<ResultEffects highlight={{ id: 1, result: normal() }} />)
    expect(document.querySelector('.result-highlight')).toBeNull()
    expect((screen.getByRole('button', { name: '演出をスキップ' }) as HTMLButtonElement).disabled).toBe(true)
  })
  it('shows every cumulative field directly, distinct from the last operation', () => {
    const state = initial(51)
    state.statistics = { totalNormalPulls: 1234, totalSpecialPulls: 12, ssrCount: 34, resonanceCounts: { FLAME_STORM: 5, THUNDER_STORM: 6, OVERLOAD: 7 }, bossesDefeated: 50, jackpotCount: 8 }
    const before = structuredClone(state)
    render(<StatisticsPanel state={state} />)
    const region = screen.getByRole('region', { name: '累積統計' })
    for (const [label, value] of [['累積NORMAL PULL', '1,234'], ['累積SPECIAL PULL', '12'], ['SSR累積数', '34'], ['FLAME_STORM累積', '5'], ['THUNDER_STORM累積', '6'], ['OVERLOAD累積', '7'], ['ボス撃破数', '50'], ['JACKPOT累積', '8'], ['最高到達Stage', '51']]) {
      expect(within(region).getByText(label).nextElementSibling?.textContent).toBe(value)
    }
    expect(state).toEqual(before)
  })
  it('renders zero statistics without fabricated lifetime CHAIN or rarity counts', () => {
    render(<StatisticsPanel state={createInitialGameState()} />)
    expect(screen.getAllByText('0')).toHaveLength(8)
    expect(screen.queryByText(/CHAIN累積/)).toBeNull()
  })
})

describe('boundary notifications preserve battle contracts', () => {
  it.each([1, 10, 100, 1000] as const)('NORMAL x%s yields exactly one final highlight regardless of chunks', async count => {
    const state = initial(); const rng = vi.fn(seededRng(234))
    const controller = createBattleController({ initialState: state, rng, chunkSize: 7, yieldFrame: frame })
    const ids = new Set<number>()
    const stop = controller.subscribe(() => { const h = controller.getSnapshot().highlight; if (h) ids.add(h.id) })
    await controller.start({ kind: 'normal', count })
    const expected = executeNormalPulls(state, count, seededRng(234))
    expect(controller.getSnapshot().state).toEqual(expected.state)
    expect(controller.getSnapshot().highlight?.result).toEqual({ kind: 'normal', value: expected.summary })
    expect(ids.size).toBe(1)
    expect(rng).toHaveBeenCalledTimes(expected.summary.actualPulls * 3)
    stop()
  })
  it('long CHAIN resumes notify only new facts, never the OR-ed clear a second time', async () => {
    let index = 0
    const state = { ...initial(), bossHp: 1 }
    const rng = vi.fn(() => { const position = index++; return position < 30_000 && position % 3 === 2 ? .93 : .999 })
    const controller = createBattleController({ initialState: state, rng, yieldFrame: frame })
    await controller.start({ kind: 'normal', count: 1 })
    const first = controller.getSnapshot()
    expect(first.highlight?.result.value.actualPulls).toBe(10_000)
    expect(first.highlight?.result.value.clearedGame).toBe(true)
    expect(first.state.pendingNormalPulls).toBe(20_001)
    await controller.resume()
    const second = controller.getSnapshot()
    expect(second.highlight?.id).not.toBe(first.highlight?.id)
    expect(second.highlight?.result.value.actualPulls).toBe(10_000)
    expect(second.highlight?.result.value.clearedGame).toBe(false)
    expect(second.result?.value.clearedGame).toBe(true)
    expect(second.result?.value.actualPulls).toBe(20_000)
    expect(rng).toHaveBeenCalledTimes(60_000)
  })
  it('huge SPECIAL reservations notify new counts at each safety boundary', async () => {
    const state = initial(); state.specialGauge = 10_001 * 30
    const rng = vi.fn(() => .999)
    const controller = createBattleController({ initialState: state, rng, yieldFrame: frame })
    await controller.start({ kind: 'special', count: 'MAX' })
    expect(controller.getSnapshot().highlight?.result.value.actualPulls).toBe(10_000)
    await controller.resume()
    const last = controller.getSnapshot()
    expect(last.highlight?.result.value.actualPulls).toBe(1)
    expect(last.result?.value.actualPulls).toBe(10_001)
    expect(last.state).toEqual(executeSpecialPulls(state, 'MAX', () => .999).state)
    expect(rng).toHaveBeenCalledTimes(10_001)
  })
  it('error commits only successful chunks; retry does not replay their highlights', async () => {
    let calls = 0
    const rng = () => { if (++calls === 4) throw new Error('failed chunk'); return .999 }
    const controller = createBattleController({ initialState: initial(), rng, chunkSize: 1, yieldFrame: frame })
    await controller.start({ kind: 'normal', count: 10 })
    expect(controller.getSnapshot().highlight?.result.value.actualPulls).toBe(1)
    expect(controller.getSnapshot().state.pendingNormalPulls).toBe(9)
    await controller.resume()
    const next = controller.getSnapshot()
    expect(next.highlight?.result.value.actualPulls).toBe(9)
    expect(next.result?.value.actualPulls).toBe(10)
    expect(next.error).toBeNull()
  })
  it('StrictMode display changes never call RNG or modify state/summary/pending; unmount cancels', async () => {
    let release!: () => void
    const rng = vi.fn(() => .999)
    const controller = createBattleController({ initialState: initial(), rng, yieldFrame: () => new Promise<void>(resolve => { release = resolve }) })
    const view = render(<StrictMode><App controller={controller} /></StrictMode>)
    let running!: Promise<boolean>
    act(() => { running = controller.start({ kind: 'normal', count: 1000 }) })
    const before = controller.getSnapshot()
    fireEvent.click(screen.getByLabelText('演出軽減'))
    expect(controller.getSnapshot()).toBe(before)
    expect(rng).not.toHaveBeenCalled()
    view.unmount(); release(); await running
    expect(rng).not.toHaveBeenCalled()
    expect(controller.getSnapshot().highlight).toBeNull()
  })
  it('clear banner occurs once, subsequent operations and progression cannot replay it', async () => {
    const controller = createBattleController({ initialState: { ...initial(), bossHp: 1 }, rng: () => .999, yieldFrame: frame })
    render(<StrictMode><App controller={controller} /></StrictMode>)
    await act(async () => { await controller.start({ kind: 'normal', count: 1 }) })
    expect(screen.getAllByText('Stage 50 初回クリア！ おめでとうございます。')).toHaveLength(1)
    const highlight = controller.getSnapshot().highlight
    act(() => { controller.purchase('PULL_POWER', controller.getSnapshot().state) })
    expect(controller.getSnapshot().highlight).toBe(highlight)
    await act(async () => { await controller.start({ kind: 'special', count: 1 }) })
    expect(screen.queryByText('Stage 50 初回クリア！ おめでとうございます。')).toBeNull()
    expect(screen.getByText(/Stage 50 クリア済み/)).toBeTruthy()
  })
  it('RESPEC and Focus preserve cumulative statistics and the last highlight', async () => {
    const controller = createBattleController({ initialState: purchaseUpgrade(initial(), 'PULL_POWER'), rng: seededRng(4), yieldFrame: frame })
    await controller.start({ kind: 'normal', count: 10 })
    const { state, highlight } = controller.getSnapshot()
    expect(controller.respec(state)).toBe(true)
    expect(controller.changeFocus('WIND_THUNDER', controller.getSnapshot().state)).toBe(true)
    expect(controller.getSnapshot().state.statistics).toEqual(state.statistics)
    expect(controller.getSnapshot().highlight).toBe(highlight)
  })
  it('JACKPOT and SSR highlights match the committed core results', async () => {
    const state = initial(20); state.jackpot = { pullsInWindow: 99, ssrInWindow: 2 }
    const rng = vi.fn(() => .999)
    const controller = createBattleController({ initialState: state, rng, yieldFrame: frame })
    render(<App controller={controller} />)
    await act(async () => { await controller.start({ kind: 'normal', count: 1 }) })
    const region = screen.getByRole('status', { name: '結果ハイライト' })
    expect(within(region).getByText('SSR獲得 1回')).toBeTruthy()
    expect(within(region).getByText('JACKPOT！ 1回')).toBeTruthy()
    expect(controller.getSnapshot().state).toEqual(executeNormalPulls(state, 1, () => .999).state)
    expect(rng).toHaveBeenCalledTimes(3)
    const before = controller.getSnapshot()
    fireEvent.click(screen.getByRole('button', { name: '演出をスキップ' }))
    fireEvent.click(screen.getByLabelText('演出軽減'))
    expect(controller.getSnapshot()).toBe(before)
    expect(rng).toHaveBeenCalledTimes(3)
  })
  it('SPECIAL can issue the first clear without adding any NORMAL statistics', async () => {
    const state = { ...initial(), bossHp: 1 }
    const controller = createBattleController({ initialState: state, rng: () => .999, yieldFrame: frame })
    await controller.start({ kind: 'special', count: 1 })
    const snapshot = controller.getSnapshot()
    expect(snapshot.highlight?.result.value.clearedGame).toBe(true)
    expect(snapshot.state.statistics.totalNormalPulls).toBe(0)
    expect(highlightFacts(snapshot.highlight!.result)).toContain('MEGA_BURST 1回')
  })
  it('display changes during chunk processing leave the completed result and RNG identical', async () => {
    let release!: () => void
    const state = initial()
    const rng = vi.fn(seededRng(48))
    const controller = createBattleController({ initialState: state, rng, chunkSize: 3, yieldFrame: () => new Promise<void>(resolve => { release = resolve }) })
    render(<StrictMode><App controller={controller} /></StrictMode>)
    let running!: Promise<boolean>
    act(() => { running = controller.start({ kind: 'normal', count: 10 }) })
    fireEvent.click(screen.getByLabelText('演出軽減'))
    while (controller.getSnapshot().busy) { await act(async () => { release(); await Promise.resolve() }) }
    await running
    const expected = executeNormalPulls(state, 10, seededRng(48))
    expect(controller.getSnapshot().state).toEqual(expected.state)
    expect(controller.getSnapshot().result).toEqual({ kind: 'normal', value: expected.summary })
    expect(rng).toHaveBeenCalledTimes(expected.summary.actualPulls * 3)
  })
})
