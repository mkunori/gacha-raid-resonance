/** Core contracts only. Gameplay and persistence are implemented in later PRs. */
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
