// @vitest-environment jsdom
import { StrictMode } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import App from './App'
import { calculateBossMaxHp } from './game/boss'
import { createInitialGameState } from './game/engine'
import { purchaseUpgrade } from './game/upgrades'
import type { Focus } from './types/game'
import { createBattleController } from './ui/battleController'

const showModalDescriptor = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'showModal')
const closeDescriptor = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'close')
// jsdom models open state, but native modal focus/inert behavior is verified in Edge.
beforeAll(() => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value(this: HTMLDialogElement) { this.open = true } })
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value(this: HTMLDialogElement) { this.open = false } })
})
afterAll(() => {
  if (showModalDescriptor) Object.defineProperty(HTMLDialogElement.prototype, 'showModal', showModalDescriptor)
  else Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal')
  if (closeDescriptor) Object.defineProperty(HTMLDialogElement.prototype, 'close', closeDescriptor)
  else Reflect.deleteProperty(HTMLDialogElement.prototype, 'close')
})
afterEach(cleanup)
function funded(stage = 8, rs = 1000) {
  return { ...createInitialGameState(), stage, highestStage: stage, bossHp: calculateBossMaxHp(stage), resonanceShards: rs, specialGauge: 90 }
}
const frame = async () => {}
function buy(name = 'PULL POWER') { return screen.getByRole('button', { name: `${name} +1購入` }) as HTMLButtonElement }
function radio(focus: Focus) { return screen.getByRole('radio', { name: new RegExp(`^${focus}`) }) as HTMLInputElement }

describe('upgrade and Focus UI', () => {
  it.each([1, 5, 6, 7, 8, 51])('derives upgrade and Focus unlocks from Stage%s', (stage) => {
    render(<App controller={createBattleController({ initialState: funded(stage) })} />)
    expect(buy().disabled).toBe(false)
    expect(buy('RESONANCE POWER').disabled).toBe(stage < 6)
    expect(buy('SPECIAL POWER').disabled).toBe(stage < 8)
    expect(radio('BALANCED').checked).toBe(true)
    expect(radio('FIRE_WIND').closest('fieldset')?.disabled).toBe(stage < 6)
    expect(screen.getByText(/^解放条件：Stage 5撃破（Stage 6到達）/)).toBeTruthy()
  })
  it.each([0, 13, 14])('shows exact affordability for %s RS', (rs) => {
    render(<App controller={createBattleController({ initialState: funded(1, rs) })} />)
    expect(buy().disabled).toBe(rs < 14)
    const card = screen.getByRole('article', { name: /PULL POWER/ })
    expect(within(card).getByText(rs < 14 ? 'RS不足' : '購入可能')).toBeTruthy()
  })
  it.each(['PULL POWER', 'RESONANCE POWER', 'SPECIAL POWER'])('purchases %s once under StrictMode and updates level, RS and next price', (name) => {
    const controller = createBattleController({ initialState: funded() })
    render(<StrictMode><App controller={controller} /></StrictMode>)
    fireEvent.click(buy(name), { detail: 1 })
    fireEvent.click(buy(name), { detail: 2 })
    const card = screen.getByRole('article', { name: new RegExp(`^${name}`) })
    expect(within(card).getByText('Lv 1')).toBeTruthy()
    const cost = name === 'PULL POWER' ? 14 : name === 'RESONANCE POWER' ? 30 : 40
    const next = name === 'PULL POWER' ? 20 : name === 'RESONANCE POWER' ? 52 : 69
    expect(controller.getSnapshot().state.resonanceShards).toBe(1000 - cost)
    expect(within(card).getByText(new RegExp(`次価格：${next} RS`))).toBeTruthy()
    expect(screen.getByRole('status', { name: '育成操作の通知' }).textContent).toContain('1Lv購入')
  })
  it('shows numeric-limit price without NaN, zero price or enabled purchase', () => {
    const state = funded()
    state.upgradeLevels.PULL_POWER = 106
    state.spentShards.PULL_POWER = 2000
    render(<App controller={createBattleController({ initialState: state })} />)
    expect(buy().disabled).toBe(true)
    expect(screen.getByText('数値上限のため購入不可')).toBeTruthy()
    expect(screen.getByText(/次価格：数値上限/)).toBeTruthy()
  })
  it('updates Stage5 defeat unlocks in place and purchased NORMAL power is used by combat', async () => {
    const state = { ...funded(5), bossHp: 1 }
    const controller = createBattleController({ initialState: state, rng: () => 0, yieldFrame: frame })
    render(<App controller={controller} />)
    expect(buy('RESONANCE POWER').disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'NORMAL ×1' }))
    await waitFor(() => expect(controller.getSnapshot().state.stage).toBe(6))
    expect(buy('RESONANCE POWER').disabled).toBe(false)
    expect(radio('FIRE_WIND').closest('fieldset')?.disabled).toBe(false)
    fireEvent.click(buy())
    const hp = controller.getSnapshot().state.bossHp
    fireEvent.click(screen.getByRole('button', { name: 'NORMAL ×1' }))
    await waitFor(() => expect(controller.getSnapshot().busy).toBe(false))
    expect(hp - controller.getSnapshot().state.bossHp).toBeCloseTo(12)
  })
  it('disables pointless RESPEC when no payment exists', () => {
    render(<App />)
    expect((screen.getByRole('button', { name: '無料RESPEC' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText('返還対象の支払済みRSはありません。')).toBeTruthy()
  })
  it('unlocks SPECIAL POWER immediately on Stage7 defeat and uses highestStage for unlocks', async () => {
    const controller = createBattleController({ initialState: { ...funded(7), bossHp: 1 }, rng: () => 0, yieldFrame: frame })
    render(<App controller={controller} />)
    expect(buy('SPECIAL POWER').disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'NORMAL ×1' }))
    await waitFor(() => expect(controller.getSnapshot().state.stage).toBe(8))
    expect(buy('SPECIAL POWER').disabled).toBe(false)
    cleanup()
    render(<App controller={createBattleController({ initialState: { ...funded(1), highestStage: 8 } })} />)
    expect(buy('SPECIAL POWER').disabled).toBe(false)
    expect(radio('FIRE_WIND').closest('fieldset')?.disabled).toBe(false)
  })
  it('confirms levels, actual refund and free cost; cancel/Esc return focus without mutations or RNG', async () => {
    let state = purchaseUpgrade(funded(), 'PULL_POWER')
    state = purchaseUpgrade(state, 'SPECIAL_POWER')
    const rng = vi.fn(() => 0)
    const controller = createBattleController({ initialState: state, rng })
    const user = userEvent.setup()
    render(<StrictMode><App controller={controller} /></StrictMode>)
    const opener = screen.getByRole('button', { name: '無料RESPEC' })
    for (const action of ['cancel', 'escape']) {
      await user.click(opener)
      const dialog = screen.getByRole('dialog', { name: '無料RESPECの確認' })
      expect(within(dialog).getByText('返還予定：54 RS')).toBeTruthy()
      expect(within(dialog).getByText(/全3種類の強化をLv0/)).toBeTruthy()
      expect(within(dialog).getByText('PULL POWER：Lv 1 → 0')).toBeTruthy()
      expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'キャンセル' }))
      await user.tab({ shift: true })
      expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'RESPECを確定' }))
      await user.tab()
      expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'キャンセル' }))
      if (action === 'cancel') await user.click(within(dialog).getByRole('button', { name: 'キャンセル' }))
      else await user.keyboard('{Escape}')
      expect(screen.queryByRole('dialog')).toBeNull()
      expect(document.activeElement).toBe(opener)
      expect(controller.getSnapshot().state).toBe(state)
    }
    expect(rng).not.toHaveBeenCalled()
  })
  it('commits RESPEC once, disables further refund, and preserves prior PULL summary', async () => {
    const controller = createBattleController({ initialState: purchaseUpgrade(funded(), 'PULL_POWER'), rng: () => 0, yieldFrame: frame })
    render(<StrictMode><App controller={controller} /></StrictMode>)
    fireEvent.click(screen.getByRole('button', { name: 'NORMAL ×1' }))
    await waitFor(() => expect(controller.getSnapshot().busy).toBe(false))
    const summary = controller.getSnapshot().result
    fireEvent.click(screen.getByRole('button', { name: '無料RESPEC' }))
    const confirm = screen.getByRole('button', { name: 'RESPECを確定' })
    fireEvent.click(confirm)
    fireEvent.click(confirm)
    expect(controller.getSnapshot().state.resonanceShards).toBe(1000)
    expect(Object.values(controller.getSnapshot().state.upgradeLevels)).toEqual([0, 0, 0])
    expect(controller.getSnapshot().result).toBe(summary)
    expect((screen.getByRole('button', { name: '無料RESPEC' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByRole('status', { name: '育成操作の通知' }).textContent).toContain('RESPEC完了')
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: '強化 / 共通RS 1,000' }))
  })
  it('revalidates RESPEC against a PULL begun after the dialog opened', async () => {
    let release!: () => void
    const controller = createBattleController({ initialState: purchaseUpgrade(funded(), 'PULL_POWER'), yieldFrame: () => new Promise<void>((resolve) => { release = resolve }), rng: () => 0 })
    render(<App controller={controller} />)
    fireEvent.click(screen.getByRole('button', { name: '無料RESPEC' }))
    let running!: Promise<boolean>
    act(() => { running = controller.start({ kind: 'normal', count: 1 }) })
    fireEvent.click(screen.getByRole('button', { name: 'RESPECを確定' }))
    expect(controller.getSnapshot().state.upgradeLevels.PULL_POWER).toBe(1)
    expect(screen.getByRole('status', { name: '育成操作の通知' }).textContent).toContain('PULL処理中')
    await act(async () => { release(); await running })
  })
  it('uses latest refund data if state changes while confirmation is open', () => {
    const controller = createBattleController({ initialState: purchaseUpgrade(funded(), 'PULL_POWER') })
    render(<App controller={controller} />)
    fireEvent.click(screen.getByRole('button', { name: '無料RESPEC' }))
    act(() => { controller.purchase('SPECIAL_POWER', controller.getSnapshot().state) })
    expect(screen.getByText('返還予定：54 RS')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'RESPECを確定' }))
    expect(controller.getSnapshot().state.resonanceShards).toBe(1000)
  })
  it('switches all four free Focus modes with probability labels and native keyboard input', async () => {
    const rng = vi.fn(() => 0)
    const controller = createBattleController({ initialState: funded(6), rng })
    const user = userEvent.setup()
    render(<StrictMode><App controller={controller} /></StrictMode>)
    for (const focus of ['FIRE_WIND', 'WIND_THUNDER', 'THUNDER_FIRE', 'BALANCED'] as Focus[]) {
      await user.click(radio(focus))
      expect(radio(focus).checked).toBe(true)
      expect(controller.getSnapshot().state.focus).toBe(focus)
      expect(screen.getByText('現在のFocus').nextElementSibling?.textContent).toBe(focus)
    }
    expect(screen.getByText('炎 FIRE 34% · 風 WIND 33% · 雷 THUNDER 33%')).toBeTruthy()
    expect(screen.getByText('炎 FIRE 45% · 風 WIND 45% · 雷 THUNDER 10%')).toBeTruthy()
    await user.keyboard('{ArrowRight}')
    expect(radio('FIRE_WIND').checked).toBe(true)
    expect(rng).not.toHaveBeenCalled()
  })
  it.each(['chain', 'special'] as const)('disables progression and gives reasons for pending %s', (kind) => {
    const state = purchaseUpgrade(funded(), 'PULL_POWER')
    if (kind === 'chain') { state.pendingNormalPulls = 1; state.normalPullQueue.chain = 1 }
    else state.pendingSpecialPulls = 1
    render(<App controller={createBattleController({ initialState: state })} />)
    expect(buy().disabled).toBe(true)
    expect((screen.getByRole('button', { name: '無料RESPEC' }) as HTMLButtonElement).disabled).toBe(true)
    expect(radio('BALANCED').closest('fieldset')?.disabled).toBe(true)
    expect(screen.getAllByText('保留PULLを再開してください')).toHaveLength(3)
  })
})
