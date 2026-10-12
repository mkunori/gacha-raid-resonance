/** UI-independent core contracts. Persistence and later features remain separate. */
export type Element = 'FIRE' | 'WIND' | 'THUNDER'
export type Rarity = 'N' | 'R' | 'SR' | 'SSR'
export type AdditionalEffect = 'NONE' | 'CHAIN' | 'CHARGE' | 'BOOST'
export type Focus = 'BALANCED' | 'FIRE_WIND' | 'WIND_THUNDER' | 'THUNDER_FIRE'
export type Resonance = 'FLAME_STORM' | 'THUNDER_STORM' | 'OVERLOAD'
export type SpecialResult = 'STRIKE' | 'BURST' | 'MEGA_BURST'
export type Upgrade = 'PULL_POWER' | 'RESONANCE_POWER' | 'SPECIAL_POWER'
/** Returns a number in [0, 1). Seeded implementations can be injected in tests. */
export type RandomSource = () => number

export interface NormalPullResult {
  element: Element
  rarity: Rarity
  additionalEffect: AdditionalEffect
}

export interface GameState {
  stage: number
  highestStage: number
  bossHp: number
  stacks: Record<Element, number>
  specialGauge: number
  resonanceShards: number
  upgradeLevels: Record<Upgrade, number>
  /** Actual paid integer RS, refunded exactly once by RESPEC. */
  spentShards: Record<Upgrade, number>
  catalyst: number
  focus: Focus
  temporary: {
    boostCount: number
    thunderStormReserved: boolean
    flameStormPullsRemaining: number
  }
  jackpot: { pullsInWindow: number; ssrInWindow: number }
  /** Includes unprocessed requested pulls and CHAIN additions. */
  pendingNormalPulls: number
  /** CHAIN group is drained before the next requested base pull. Sum equals pendingNormalPulls. */
  normalPullQueue: { base: number; chain: number }
  /** Fixed remaining SPECIAL count; never recomputed from gauge on resume. */
  pendingSpecialPulls: number
  statistics: {
    totalNormalPulls: number
    totalSpecialPulls: number
    ssrCount: number
    resonanceCounts: Record<Resonance, number>
    bossesDefeated: number
    jackpotCount: number
  }
}

export interface DisplaySettings {
  reducedEffects: boolean
}

export interface SaveDataV1 {
  saveVersion: 1
  state: GameState
  settings: DisplaySettings
}

export type CombatEvent =
  | { type: 'normal-pull'; stage: number; result: NormalPullResult }
  | { type: 'normal-damage'; stage: number; damage: number }
  | { type: 'resonance'; stage: number; resonance: Resonance; damage: number; catalystConsumed?: true; boostConsumed?: number }
  | { type: 'catalyst-gained'; stage: number; amount: number }
  | { type: 'gauge-gained'; stage: number; amount: number; source: 'normal' | 'overload' | 'charge' | 'jackpot' }
  | { type: 'additional-effect'; stage: number; effect: AdditionalEffect; applied: boolean; amount?: number }
  | { type: 'boss-defeated'; stage: number; reward: number }
  | { type: 'game-cleared'; stage: number }
  | { type: 'stage-started'; stage: number; maxHp: number }
  | { type: 'special-pull'; stage: number; result: SpecialResult }
  | { type: 'gauge-spent'; stage: number; amount: number; source: 'special' }
  | { type: 'special-damage'; stage: number; damage: number }
  | { type: 'jackpot-window'; stage: number; ssrCount: number; triggered: boolean; damage: number; gaugeGain: number }

export interface CombatResult {
  state: GameState
  events: CombatEvent[]
}

export type NormalPullCount = 1 | 10 | 100 | 1000

/** Bounded-size aggregate: no per-pull event history is retained. Counts cover this invocation only. */
export interface NormalPullBatchResult {
  state: GameState
  summary: {
    actualPulls: number
    chainAdded: number
    pendingPulls: number
    stagesAdvanced: number
    /** True only when this invocation emitted game-cleared. Combine chunks with OR. */
    clearedGame: boolean
    earnedShards: number
    ssrCount: number
    jackpotCount: number
    resonanceCounts: Record<Resonance, number>
    effectCounts: Record<AdditionalEffect, number>
  }
}

export type SpecialPullCount = 1 | 'MAX'

export interface SpecialPullBatchResult {
  state: GameState
  summary: {
    actualPulls: number
    pendingPulls: number
    gaugeSpent: number
    stagesAdvanced: number
    clearedGame: boolean
    earnedShards: number
    resultCounts: Record<SpecialResult, number>
  }
}
