// @vitest-environment jsdom
import { StrictMode } from 'react'
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import { createInitialGameState, executeNormalPulls, executeSpecialPulls } from '../game/engine'
import { setFocus } from '../game/progression'
import { purchaseUpgrade, respecUpgrades } from '../game/upgrades'
import { seededRng } from '../test/random'
import type { Focus } from '../types/game'
import { createBattleController } from './battleController'

afterEach(() => { cleanup(); vi.useRealTimers() })
describe('integrated UX endurance', () => {
  it('100 mixed operations with progression preserve core state, ledger and one latest notification under StrictMode', async () => {
    let expected = { ...createInitialGameState(), highestStage: 50, resonanceShards: 10_000, specialGauge: 90 }
    const expectedRng = seededRng(21)
    const rng = vi.fn(seededRng(21))
    const controller = createBattleController({ initialState: expected, rng, yieldFrame: async () => {} })
    render(<StrictMode><App controller={controller} /></StrictMode>)
    const ids = new Set<number>()
    for (let index = 0; index < 100; index++) {
      await act(async () => {
        if (index % 10 === 0) {
          const before = controller.getSnapshot().state
          expect(controller.purchase('PULL_POWER', before)).toBe(true)
          expect(controller.purchase('PULL_POWER', before)).toBe(false)
          expected = purchaseUpgrade(expected, 'PULL_POWER')
        }
        if (index % 15 === 0) {
          expect(controller.respec(controller.getSnapshot().state)).toBe(true)
          expected = respecUpgrades(expected)
        }
        const focus = (['BALANCED', 'FIRE_WIND', 'WIND_THUNDER', 'THUNDER_FIRE'] as Focus[])[index % 4]
        expect(controller.changeFocus(focus, controller.getSnapshot().state)).toBe(true)
        expected = setFocus(expected, focus)
        if (index % 5 === 0) {
          expected = executeSpecialPulls(expected, 1, expectedRng).state
          await controller.start({ kind: 'special', count: 1 })
        } else {
          expected = executeNormalPulls(expected, 10, expectedRng).state
          await controller.start({ kind: 'normal', count: 10 })
        }
      })
      const snapshot = controller.getSnapshot()
      expect(snapshot.state).toEqual(expected)
      expect(snapshot.error).toBeNull()
      ids.add(snapshot.highlight!.id)
      expect(document.querySelectorAll('.result-highlight').length).toBeLessThanOrEqual(1)
    }
    expect(ids.size).toBe(100)
    expect(rng).toHaveBeenCalledTimes(expected.statistics.totalNormalPulls * 3 + expected.statistics.totalSpecialPulls)
    expect(screen.getByText('累積NORMAL PULL').nextElementSibling?.textContent).toBe(expected.statistics.totalNormalPulls.toLocaleString('en-US'))
  })
  it('repeated StrictMode mount/unmount during initial waiting leaves no timer or RNG work', async () => {
    vi.useFakeTimers()
    const rng = vi.fn(() => 0)
    const controller = createBattleController({ rng })
    for (let index = 0; index < 20; index++) {
      const view = render(<StrictMode><App controller={controller} /></StrictMode>)
      let running!: Promise<boolean>
      act(() => { running = controller.start({ kind: 'normal', count: 10 }) })
      expect(controller.getSnapshot().busy).toBe(true)
      view.unmount()
      await running
      expect(vi.getTimerCount()).toBe(0)
      expect(controller.getSnapshot().busy).toBe(false)
    }
    expect(rng).not.toHaveBeenCalled()
    expect(controller.getSnapshot().state).toEqual(createInitialGameState())
  })
})
