import { createInitialGameState, executeNormalPulls, executeSpecialPulls, resumePendingNormalPulls, resumePendingSpecialPulls } from '../game/engine'
import type { GameState, NormalPullBatchResult, NormalPullCount, RandomSource, SpecialPullBatchResult, SpecialPullCount } from '../types/game'

export type Operation = { kind: 'normal'; count: NormalPullCount } | { kind: 'special'; count: SpecialPullCount }
export type ResultSummary = { kind: 'normal'; value: NormalPullBatchResult['summary'] } | { kind: 'special'; value: SpecialPullBatchResult['summary'] }
export interface BattleSnapshot { state: GameState; busy: boolean; error: string | null; result: ResultSummary | null; startStage: number }

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
  let snapshot: BattleSnapshot = { state, busy: false, error: null, result: null, startStage: state.stage }
  const listeners = new Set<() => void>()
  let active: AbortController | null = null
  const publish = (next: BattleSnapshot) => { snapshot = next; listeners.forEach((listener) => listener()) }
  const pending = () => snapshot.state.pendingNormalPulls + snapshot.state.pendingSpecialPulls
  async function run(operation?: Operation): Promise<boolean> {
    if (snapshot.busy || (operation && pending()) || (!operation && !pending())) return false
    const token = new AbortController()
    active = token
    publish({ ...snapshot, busy: true, error: null, result: operation ? null : snapshot.result, startStage: operation ? snapshot.state.stage : snapshot.startStage })
    try {
      await wait(token.signal)
      let first = true
      do {
        if (token.signal.aborted) return false
        const current = snapshot.state
        let nextState: GameState
        let summary: ResultSummary
        if ((first && operation?.kind === 'normal') || (!operation && current.pendingNormalPulls) || (!first && current.pendingNormalPulls)) {
          const result = first && operation?.kind === 'normal' ? executeNormalPulls(current, operation.count, rng, limit) : resumePendingNormalPulls(current, rng, limit)
          nextState = result.state
          summary = { kind: 'normal', value: result.summary }
        } else {
          const result = first && operation?.kind === 'special' ? executeSpecialPulls(current, operation.count, rng, limit) : resumePendingSpecialPulls(current, rng, limit)
          nextState = result.state
          summary = { kind: 'special', value: result.summary }
        }
        publish({ ...snapshot, state: nextState, result: mergeSummary(snapshot.result, summary) })
        first = false
        if (pending()) await wait(token.signal)
      } while (pending())
      return true
    } catch (error) {
      if (!token.signal.aborted) publish({ ...snapshot, error: `処理を停止しました：${error instanceof Error ? error.message : '不明なエラー'}。最後に確定した状態を保持しています。` })
      return false
    } finally {
      if (active === token) { active = null; publish({ ...snapshot, busy: false }) }
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
  }
}
export type BattleController = ReturnType<typeof createBattleController>
