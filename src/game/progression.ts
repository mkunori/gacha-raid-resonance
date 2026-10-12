import { GAME_CLEAR_STAGE, UNLOCK_STAGES, UPGRADE_RULES } from '../data/rules'
import type { Focus, GameState, Upgrade } from '../types/game'
import { safeInteger, validateFocus, validatePullQueues } from './validation'

const FEATURE_STAGES = {
  NORMAL_1: 1, NORMAL_10: 1, SPECIAL_1: 1,
  FOCUS: UNLOCK_STAGES.focus, SPECIAL_MAX: UNLOCK_STAGES.specialMax,
  NORMAL_100: UNLOCK_STAGES.normal100, NORMAL_1000: UNLOCK_STAGES.normal1000,
  JACKPOT: UNLOCK_STAGES.jackpot,
} as const
export type Feature = keyof typeof FEATURE_STAGES

export function isFeatureUnlocked(state: Readonly<Pick<GameState, 'highestStage'>>, feature: Feature): boolean {
  safeInteger(state.highestStage, 'highestStage', 1)
  if (!Object.hasOwn(FEATURE_STAGES, feature)) throw new RangeError('Unknown feature')
  return state.highestStage >= FEATURE_STAGES[feature]
}

export function isUpgradeUnlocked(state: Readonly<Pick<GameState, 'highestStage'>>, upgrade: Upgrade): boolean {
  safeInteger(state.highestStage, 'highestStage', 1)
  if (!Object.hasOwn(UPGRADE_RULES, upgrade)) throw new RangeError('Unknown upgrade')
  return state.highestStage >= UPGRADE_RULES[upgrade].unlockStage
}

export function hasClearedGame(state: Readonly<Pick<GameState, 'highestStage'>>): boolean {
  safeInteger(state.highestStage, 'highestStage', 1)
  return state.highestStage > GAME_CLEAR_STAGE
}

/** Immutable snapshots: unchanged nested fields are shared. No queue may be pending. */
export function setFocus(state: Readonly<GameState>, focus: Focus): GameState {
  safeInteger(state.stage, 'stage', 1)
  safeInteger(state.highestStage, 'highestStage', state.stage)
  validateFocus(state.focus)
  validateFocus(focus)
  validatePullQueues(state)
  const unlocked = isFeatureUnlocked(state, 'FOCUS')
  if (!unlocked && (focus !== 'BALANCED' || state.focus !== 'BALANCED')) throw new RangeError('Focus is locked')
  if (state.pendingNormalPulls || state.pendingSpecialPulls) throw new RangeError('Resume pending pulls before changing focus')
  return { ...state, focus }
}
