// @vitest-environment jsdom
import { Profiler, StrictMode } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { BattlePanel } from './components/BattlePanel'
import { calculateBossMaxHp } from './game/boss'
import { createInitialGameState, executeNormalPulls } from './game/engine'
import { seededRng } from './test/random'
import { createBattleController } from './ui/battleController'

afterEach(cleanup)
const instant = async () => {}
function stateAt(stage: number, gauge = 60) {
  return { ...createInitialGameState(), stage, highestStage: stage, bossHp: calculateBossMaxHp(stage), specialGauge: gauge }
}
function button(label: string) { return screen.getByRole('button', { name: label }) as HTMLButtonElement }

describe('battle UI and unlocks', () => {
  it('starts at Stage1 with usable NORMAL1/10, locked counts, insufficient gauge and a reload notice', () => {
    render(<StrictMode><App /></StrictMode>)
    expect(button('NORMAL ×1').disabled).toBe(false)
    expect(button('NORMAL ×10').disabled).toBe(false)
    expect(button('NORMAL ×100').disabled).toBe(true)
    expect(button('NORMAL ×100').textContent).toContain('Stage 15')
    expect(button('NORMAL ×1000').textContent).toContain('Stage 50')
    expect(button('SPECIAL ×1').disabled).toBe(true)
    expect(button('SPECIAL ×MAX').textContent).toContain('Stage 10')
    expect(screen.getByText(/再読込すると最初から/)).toBeTruthy()
    expect(screen.getByRole('progressbar').getAttribute('aria-valuetext')).toBe('1,100 / 1,100')
    for (const attribute of ['FIRE', 'WIND', 'THUNDER']) expect(screen.getByText(attribute)).toBeTruthy()
  })
  it.each([9, 10, 14, 15, 49, 50])('shows unlock controls at Stage%s', (stage) => {
    render(<App controller={createBattleController({ initialState: stateAt(stage) })} />)
    expect(button('NORMAL ×100').disabled).toBe(stage < 15)
    expect(button('NORMAL ×1000').disabled).toBe(stage < 50)
    expect(button('SPECIAL ×MAX').disabled).toBe(stage < 10)
    expect(button('SPECIAL ×1').disabled).toBe(false)
  })
  it.each([1, 10, 100, 1000] as const)('NORMAL ×%s updates the actual screen from core state under StrictMode', async (count) => {
    const initial = stateAt(count === 1000 ? 50 : count === 100 ? 15 : 1, 0)
    const rng = vi.fn(seededRng(42))
    const expected = executeNormalPulls(initial, count, seededRng(42))
    const controller = createBattleController({ initialState: initial, rng, yieldFrame: instant, chunkSize: 100 })
    render(<StrictMode><App controller={controller} /></StrictMode>)
    expect(rng).not.toHaveBeenCalled()
    fireEvent.click(button(`NORMAL ×${count}`))
    fireEvent.click(button(`NORMAL ×${count}`))
    await waitFor(() => expect(controller.getSnapshot().busy).toBe(false))
    expect(controller.getSnapshot().state).toEqual(expected.state)
    expect(rng).toHaveBeenCalledTimes(expected.summary.actualPulls * 3)
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe(String(expected.state.bossHp / calculateBossMaxHp(expected.state.stage) * 100))
    expect(screen.getByRole('heading', { name: new RegExp(`^Stage ${expected.state.stage} `) })).toBeTruthy()
    const summary = screen.getByRole('region', { name: '今回の結果' })
    expect(within(summary).getByText('実PULL').nextElementSibling?.textContent).toBe(expected.summary.actualPulls.toLocaleString('ja-JP'))
    const resources = screen.getByRole('region', { name: 'リソースと共鳴' })
    expect(within(resources).getByText('RS').nextElementSibling?.textContent).toBe(expected.state.resonanceShards.toLocaleString('ja-JP'))
    expect(within(resources).getByText('SPECIAL GAUGE').nextElementSibling?.textContent).toContain(expected.state.specialGauge.toLocaleString('ja-JP'))
  })
  it.each([1, 'MAX'] as const)('SPECIAL ×%s uses the existing API and shows consumed gauge and result counts', async (count) => {
    const controller = createBattleController({ initialState: stateAt(10, 90), rng: () => 0, yieldFrame: instant, chunkSize: 1 })
    render(<App controller={controller} />)
    fireEvent.click(button(`SPECIAL ×${count}`))
    await waitFor(() => expect(controller.getSnapshot().busy).toBe(false))
    expect(controller.getSnapshot().state.specialGauge).toBe(count === 1 ? 60 : 0)
    expect(screen.getByText(`消費ゲージ ${count === 1 ? 30 : 90}`)).toBeTruthy()
    expect(screen.getByText(/STRIKE .*BURST .*MEGA_BURST/)).toBeTruthy()
  })
  it('supports keyboard activation and a visible busy guard before execution', async () => {
    let release!: () => void
    const rng = vi.fn(() => 0)
    const controller = createBattleController({ rng, yieldFrame: () => new Promise<void>((resolve) => { release = resolve }) })
    const user = userEvent.setup()
    render(<StrictMode><App controller={controller} /></StrictMode>)
    await user.tab()
    expect(document.activeElement).toBe(button('NORMAL ×1'))
    await user.keyboard('{Enter}')
    expect(screen.getByRole('status').textContent).toContain('処理中')
    expect(screen.getAllByRole('button').every((element) => (element as HTMLButtonElement).disabled)).toBe(true)
    expect(rng).not.toHaveBeenCalled()
    await act(async () => { release(); await Promise.resolve() })
    expect(rng).toHaveBeenCalledTimes(3)
  })
  it('displays failed chunks, disables new operations, and resumes the retained queue', async () => {
    let fail = true, calls = 0
    const controller = createBattleController({ chunkSize: 1, yieldFrame: instant, rng: () => { calls++; if (fail && calls === 4) throw new Error('RNG failure'); return 0 } })
    render(<App controller={controller} />)
    fireEvent.click(button('NORMAL ×10'))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('RNG failure'))
    expect(button('NORMAL ×1').disabled).toBe(true)
    expect(screen.getByText(/未実行 9 PULL/)).toBeTruthy()
    fail = false
    fireEvent.click(screen.getByRole('button', { name: '保留PULLを再開' }))
    await waitFor(() => expect(controller.getSnapshot().state.statistics.totalNormalPulls).toBe(10))
    expect(screen.queryByRole('alert')).toBeNull()
    expect(button('NORMAL ×1').disabled).toBe(false)
  })
  it('shows a normal safety pause and remaining CHAIN, then offers manual resume', async () => {
    let index = 0
    const controller = createBattleController({ yieldFrame: instant, rng: () => { const position = index++; return position < 30_000 && position % 3 === 2 ? 0.93 : 0 } })
    render(<StrictMode><App controller={controller} /></StrictMode>)
    fireEvent.click(button('NORMAL ×1'))
    await waitFor(() => expect(controller.getSnapshot().busy).toBe(false))
    expect(screen.getByRole('status').textContent).toContain('10,000実PULLの安全上限で一時停止')
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByText(/未実行 20,001 PULL/)).toBeTruthy()
    expect(button('NORMAL ×1').disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '保留PULLを再開' }))
    await waitFor(() => expect(controller.getSnapshot().busy).toBe(false))
    expect(controller.getSnapshot().result?.value.actualPulls).toBe(20_000)
    expect(screen.getByRole('status').textContent).toContain('一時停止')
    expect(screen.getByText(/未実行 10,001 PULL/)).toBeTruthy()
  })
  it('unmount cancels queued work and does not consume RNG during StrictMode mounting', async () => {
    let release!: () => void
    const rng = vi.fn(() => 0)
    const controller = createBattleController({ rng, yieldFrame: () => new Promise<void>((resolve) => { release = resolve }) })
    const view = render(<StrictMode><App controller={controller} /></StrictMode>)
    fireEvent.click(button('NORMAL ×10'))
    view.unmount()
    await act(async () => { release(); await Promise.resolve() })
    expect(rng).not.toHaveBeenCalled()
    expect(controller.getSnapshot().busy).toBe(false)
  })
  it('bounds React commits by chunk count rather than actual PULL count', async () => {
    const controller = createBattleController({ initialState: stateAt(50), rng: seededRng(42) })
    const commits = vi.fn()
    render(<Profiler id="battle" onRender={commits}><App controller={controller} /></Profiler>)
    fireEvent.click(button('NORMAL ×1000'))
    await waitFor(() => expect(controller.getSnapshot().busy).toBe(false))
    expect(controller.getSnapshot().result?.value.actualPulls).toBeGreaterThanOrEqual(1000)
    expect(commits.mock.calls.length).toBeLessThanOrEqual(16)
  })
  it('shows catalyst, buffs, Focus, JACKPOT window, and the derived clear state', () => {
    const state = stateAt(51)
    state.catalyst = 2
    state.temporary = { boostCount: 2, thunderStormReserved: true, flameStormPullsRemaining: 7 }
    state.jackpot = { pullsInWindow: 47, ssrInWindow: 2 }
    render(<App controller={createBattleController({ initialState: state })} />)
    expect(screen.getByText(/Stage 50 クリア済み/)).toBeTruthy()
    expect(screen.getByText(/BOOST 2.*THUNDER予約 あり/)).toBeTruthy()
    expect(screen.getByText(/JACKPOT区間 47.*SSR 2/)).toBeTruthy()
    expect(screen.getByText('BALANCED')).toBeTruthy()
    expect(screen.getByText('CATALYST').nextElementSibling?.textContent).toBe('2 / 3')
  })
  it.each([-10, 2000])('clamps HP bar percentage for display (%s)', (hp) => {
    render(<BattlePanel state={{ ...createInitialGameState(), bossHp: hp }} />)
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe(hp < 0 ? '0' : '100')
  })
})
