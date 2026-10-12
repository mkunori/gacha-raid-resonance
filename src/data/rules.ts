import type { AdditionalEffect, Element, Focus, Rarity, Resonance, SpecialResult, Upgrade } from '../types/game'

/** v0.6 values only; these definitions do not implement gameplay. */
export const NORMAL_RARITIES = {
  N: { probability: 0.74, damageMultiplier: 1, stacks: 1 },
  R: { probability: 0.20, damageMultiplier: 2, stacks: 1 },
  SR: { probability: 0.05, damageMultiplier: 5, stacks: 2 },
  SSR: { probability: 0.01, damageMultiplier: 12, stacks: 4 },
} as const satisfies Record<Rarity, { probability: number; damageMultiplier: number; stacks: number }>

export const FOCUS_PROBABILITIES = {
  BALANCED: { FIRE: 0.34, WIND: 0.33, THUNDER: 0.33 },
  FIRE_WIND: { FIRE: 0.45, WIND: 0.45, THUNDER: 0.10 },
  WIND_THUNDER: { FIRE: 0.10, WIND: 0.45, THUNDER: 0.45 },
  THUNDER_FIRE: { FIRE: 0.45, WIND: 0.10, THUNDER: 0.45 },
} as const satisfies Record<Focus, Record<Element, number>>

export const EFFECT_PROBABILITIES = {
  NONE: 0.92, CHAIN: 0.02, CHARGE: 0.03, BOOST: 0.03,
} as const satisfies Record<AdditionalEffect, number>

export const SPECIAL_RESULTS = {
  STRIKE: { probability: 0.75, damageMultiplier: 20 },
  BURST: { probability: 0.20, damageMultiplier: 40 },
  MEGA_BURST: { probability: 0.05, damageMultiplier: 100 },
} as const satisfies Record<SpecialResult, { probability: number; damageMultiplier: number }>

export const UPGRADE_RULES = {
  PULL_POWER: { multiplier: 1.20, baseCost: 14, costGrowth: 1.38, unlockStage: 1 },
  RESONANCE_POWER: { multiplier: 1.08, baseCost: 30, costGrowth: 1.72, unlockStage: 6 },
  SPECIAL_POWER: { multiplier: 1.10, baseCost: 40, costGrowth: 1.72, unlockStage: 8 },
} as const satisfies Record<Upgrade, { multiplier: number; baseCost: number; costGrowth: number; unlockStage: number }>

export const CORE_RULES = {
  initialAttack: 10,
  bossHpBase: 1100,
  rewardBase: 18,
  stageGrowth: 1.36,
  stackCap: 12,
  resonanceStackCost: 3,
  resonanceBase: 6 * 4,
  catalystCap: 3,
  catalystMultiplier: 1.5,
  normalGaugeGain: 1,
  specialGaugeCost: 30,
  chargeGaugeGain: 5,
  chainPulls: 3,
  operationPullLimit: 100_000,
  boostCap: 3,
  boostPerStack: 0.25,
  flameResonanceMultiplier: 1.50,
  flameNormalMultiplier: 1.15,
  flameDurationPulls: 10,
  thunderReservedMultiplier: 1.40,
  overloadGaugeGain: 12,
  overloadSpecialBossGaugeGain: 24,
  jackpotWindow: 100,
  jackpotSsrThreshold: 3,
  jackpotAttackMultiplier: 180,
  jackpotGaugeGain: 30,
} as const

/** First defeat records clear; subsequent stages continue with ordinary bosses. */
export const GAME_CLEAR_STAGE = 50

/** Stage 5 defeat is represented as arrival at Stage 6. */
export const UNLOCK_STAGES = {
  resonancePower: 6, focus: 6, specialPower: 8, specialMax: 10,
  normal100: 15, jackpot: 20, normal1000: 50,
} as const

export const RESONANCE_PAIRS = {
  FLAME_STORM: ['FIRE', 'WIND'],
  THUNDER_STORM: ['WIND', 'THUNDER'],
  OVERLOAD: ['THUNDER', 'FIRE'],
} as const satisfies Record<Resonance, readonly [Element, Element]>

export const RESONANCE_ORDER = ['FLAME_STORM', 'THUNDER_STORM', 'OVERLOAD'] as const

export const FOCUS_RESONANCE = {
  BALANCED: null,
  FIRE_WIND: 'FLAME_STORM',
  WIND_THUNDER: 'THUNDER_STORM',
  THUNDER_FIRE: 'OVERLOAD',
} as const satisfies Record<Focus, Resonance | null>
