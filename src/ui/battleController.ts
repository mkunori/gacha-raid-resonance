import { createInitialGameState, executeNormalPulls, executeSpecialPulls, resumePendingNormalPulls, resumePendingSpecialPulls } from '../game/engine'
import { setFocus } from '../game/progression'
import { purchaseUpgrade, respecUpgrades } from '../game/upgrades'
import type { Focus, GameState, NormalPullBatchResult, NormalPullCount, RandomSource, SpecialPullBatchResult, SpecialPullCount, Upgrade } from '../types/game'

export type Operation = { kind: 'normal'; count: NormalPullCount } | { kind: 'special'; count: SpecialPullCount }
export type ResultSummary = { kind: 'normal'; value: NormalPullBatchResult['summary'] } | { kind: 'special'; value: SpecialPullBatchResult['summary'] }
/** Per start/resume call, including CHAIN; not a game-balance limit. */
export const UI_AUTO_PULL_LIMIT = 10_000
export interface BattleSnapshot { state: GameState; busy: boolean; paused: boolean; error: string | null; notice: { kind: 'success' | 'error'; text: string } | null; result: ResultSummary | null; highlight: { id: number; result: ResultSummary } | null; startStage: number }

/** Fixed-size aggregates: latest pending replaces; clear is OR; counters add. */
export function mergeSummary(previous: ResultSummary | null, next: ResultSummary): ResultSummary {
  if (!previous || previous.kind !== next.kind) return next
  if (previous.kind === 'normal' && next.kind === 'normal') {
    const a = previous.value, b = next.value
    return { kind: 'normal', value: { actualPulls: a.actualPulls + b.actualPulls, chainAdded: a.chainAdded + b.chainAdded,
      pendingPulls: b.pendingPulls, stagesAdvanced: a.stagesAdvanced + b.stagesAdvanced, clearedGame: a.clearedGame || b.clearedGame,
      earnedShards: a.earnedShards + b.earnedShards, ssrCount: a.ssrCount + b.ssrCount, jackpotCount: a.jackpotCount + b.jackpotCount,
      resonanceCounts: { FLAME_STORM: a.resonanceCounts.FLAME_STORM + b.resonanceCounts.FLAME_STORM, THUNDER_STORM: a.resonanceCounts.THUNDER_STORM + b.resonanceCounts.THUNDER_STORM, OVERLOAD: a.resonanceCounts.OVERLOAD + b.resonanceCounts.OVERLOAD },
      effectCounts: { NONE: a.effectCounts.NONE + b.effectCounts.NONE, CHAIN: a.effectCounts.CHAIN + b.effectCounts.CHAIN, CHARGE: a.effectCounts.CHARGE + b.effectCounts.CHARGE, BOOST: a.effectCounts.BOOST + b.effectCounts.BOOST } } }
  }
  if (previous.kind === 'special' && next.kind === 'special') {
    const a = previous.value, b = next.value
    return { kind: 'special', value: { actualPulls: a.actualPulls + b.actualPulls, pendingPulls: b.pendingPulls,
      stagesAdvanced: a.stagesAdvanced + b.stagesAdvanced, clearedGame: a.clearedGame || b.clearedGame,
      earnedShards: a.earnedShards + b.earnedShards, gaugeSpent: a.gaugeSpent + b.gaugeSpent,
      resultCounts: { STRIKE: a.resultCounts.STRIKE + b.resultCounts.STRIKE, BURST: a.resultCounts.BURST + b.resultCounts.BURST, MEGA_BURST: a.resultCounts.MEGA_BURST + b.resultCounts.MEGA_BURST } } }
  }
  return next
}

function yieldToBrowser(signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const finish = () => { clearTimeout(timer); signal.removeEventListener('abort', finish); resolve() }
    const timer = setTimeout(finish, 16)
    signal.addEventListener('abort', finish, { once: true })
    if (signal.aborted) finish()
  })
}

/** Event-driven store. Snapshots are immutable; one RNG stream continues after errors.
 * No pulls in render, effects or React updater callbacks. */
export function createBattleController(options: { initialState?: GameState; rng?: RandomSource; chunkSize?: number; yieldFrame?: (signal: AbortSignal) => Promise<void> } = {}) {
  const rng = options.rng ?? Math.random
  const limit = options.chunkSize ?? 100
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new RangeError('UI chunk size must be 1–500')
  const wait = options.yieldFrame ?? yieldToBrowser
  const state = options.initialState ?? createInitialGameState()
  let snapshot: BattleSnapshot = { state, busy: false, paused: false, error: null, notice: null, result: null, highlight: null, startStage: state.stage }
  let highlightId = 0
  const listeners = new Set<() => void>()
  let active: AbortController | null = null
  const publish = (next: BattleSnapshot) => { snapshot = next; listeners.forEach((listener) => listener()) }
  const pending = () => snapshot.state.pendingNormalPulls + snapshot.state.pendingSpecialPulls
  /** Rendered state is an optimistic concurrency token, never an alternative source.
   * Validate against the latest state; no RNG, queued updates or partial commits. */
  function update(expectedState: Readonly<GameState>, transform: (current: GameState) => GameState, message: string): boolean {
    try {
      if (snapshot.busy) throw new Error('PULL処理中は変更できません')
      if (pending()) throw new Error('保留PULLをすべて再開してから変更してください')
      if (expectedState !== snapshot.state) throw new Error('表示が更新されました。最新の内容を確認して操作してください')
      const next = transform(snapshot.state)
      publish({ ...snapshot, state: next, notice: { kind: 'success', text: message } })
      return true
    } catch (error) {
      publish({ ...snapshot, notice: { kind: 'error', text: `操作できません：${error instanceof Error ? error.message : '不明なエラー'}` } })
      return false
    }
  }
  async function run(operation?: Operation): Promise<boolean> {
    if (snapshot.busy || (operation && pending()) || (!operation && !pending())) return false
    const token = new AbortController()
    active = token
    // Only committed chunks in this start/resume call: never replay prior totals.
    let boundaryResult: ResultSummary | null = null
    publish({ ...snapshot, busy: true, paused: false, error: null, notice: null, result: operation ? null : snapshot.result, startStage: operation ? snapshot.state.stage : snapshot.startStage })
    try {
      await wait(token.signal)
      let first = true
      let processed = 0
      do {
        if (token.signal.aborted) return false
        const current = snapshot.state
        const chunkLimit = Math.min(limit, UI_AUTO_PULL_LIMIT - processed)
        let nextState: GameState
        let summary: ResultSummary
        if ((first && operation?.kind === 'normal') || (!operation && current.pendingNormalPulls) || (!first && current.pendingNormalPulls)) {
          const result = first && operation?.kind === 'normal' ? executeNormalPulls(current, operation.count, rng, chunkLimit) : resumePendingNormalPulls(current, rng, chunkLimit)
          nextState = result.state
          summary = { kind: 'normal', value: result.summary }
        } else {
          const result = first && operation?.kind === 'special' ? executeSpecialPulls(current, operation.count, rng, chunkLimit) : resumePendingSpecialPulls(current, rng, chunkLimit)
          nextState = result.state
          summary = { kind: 'special', value: result.summary }
        }
        boundaryResult = mergeSummary(boundaryResult, summary)
        publish({ ...snapshot, state: nextState, result: mergeSummary(snapshot.result, summary) })
        processed += summary.value.actualPulls
        first = false
        if (pending() && processed >= UI_AUTO_PULL_LIMIT) {
          publish({ ...snapshot, paused: true })
          return true
        }
        if (pending()) await wait(token.signal)
      } while (pending())
      return true
    } catch (error) {
      if (!token.signal.aborted) publish({ ...snapshot, error: `処理を停止しました：${error instanceof Error ? error.message : '不明なエラー'}。最後に確定した状態を保持しています。` })
      return false
    } finally {
      if (active === token) {
        active = null
        publish({ ...snapshot, busy: false, highlight: boundaryResult ? { id: ++highlightId, result: boundaryResult } : snapshot.highlight })
      }
    }
  }
  return {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
        if (!listeners.size && active) {
          active.abort(); active = null
          snapshot = { ...snapshot, busy: false }
        }
      }
    },
    start: (operation: Operation) => run(operation),
    resume: () => run(),
    purchase: (upgrade: Upgrade, expectedState: Readonly<GameState>) => update(expectedState, (current) => purchaseUpgrade(current, upgrade), `${upgrade.replaceAll('_', ' ')}を1Lv購入しました。`),
    respec: (expectedState: Readonly<GameState>) => update(expectedState, respecUpgrades, 'RESPEC完了：全強化をLv0に戻し、支払済みRSを全額返還しました。'),
    changeFocus: (focus: Focus, expectedState: Readonly<GameState>) => update(expectedState, (current) => setFocus(current, focus), `Focusを${focus}に変更しました（無料）。`),
  }
}
export type BattleController = ReturnType<typeof createBattleController>
