import { UPGRADE_RULES } from '../data/rules'
import type { GameState, Upgrade } from '../types/game'
import { isUpgradeUnlocked } from './progression'
import { safeInteger, validatePullQueues } from './validation'

const UPGRADES: readonly Upgrade[] = ['PULL_POWER', 'RESONANCE_POWER', 'SPECIAL_POWER']

export type PurchaseBlockReason = 'PENDING_PULLS' | 'LOCKED' | 'NUMERIC_LIMIT' | 'INSUFFICIENT_RS'

export interface UpgradeInfo {
  readonly upgrade: Upgrade
  readonly level: number
  /** Null when the next price cannot be represented as a safe integer. */
  readonly nextCost: number | null
  readonly unlocked: boolean
  readonly resonanceShards: number
  readonly spentShards: number
  readonly canPurchase: boolean
  readonly purchaseBlockReason: PurchaseBlockReason | null
}

function validateUpgrade(upgrade: Upgrade): void {
  if (!Object.hasOwn(UPGRADE_RULES, upgrade)) throw new RangeError('Unknown upgrade')
}

/** O(1) calculation; no cost-history reconstruction or level-sized allocation. */
export function calculateUpgradeCost(upgrade: Upgrade, currentLevel: number): number {
  validateUpgrade(upgrade)
  safeInteger(currentLevel, 'upgrade level')
  const rule = UPGRADE_RULES[upgrade]
  return safeInteger(Math.ceil(rule.baseCost * rule.costGrowth ** currentLevel), 'upgrade price', 1)
}

/** Validate this module's domain; full save-schema validation belongs to storage. */
function validateUpgradeState(state: Readonly<GameState>): number {
  safeInteger(state.stage, 'stage', 1)
  safeInteger(state.highestStage, 'highestStage', state.stage)
  safeInteger(state.resonanceShards, 'RS')
  validatePullQueues(state)
  let paid = 0
  for (const upgrade of UPGRADES) {
    const level = safeInteger(state.upgradeLevels[upgrade], upgrade + ' level')
    const spent = safeInteger(state.spentShards[upgrade], upgrade + ' paid RS')
    // Every v0.6 level costs at least baseCost. Trust the recorded amount above
    // this lower bound, without equating it to a reconstructed price history.
    const minimumPaid = safeInteger(UPGRADE_RULES[upgrade].baseCost * level, 'minimum paid RS')
    if ((level === 0 && spent !== 0) || spent < minimumPaid) throw new RangeError('Inconsistent upgrade ledger')
    if (level > 0 && !isUpgradeUnlocked(state, upgrade)) throw new RangeError('Locked upgrade has a paid level')
    paid = safeInteger(paid + spent, 'total paid RS')
  }
  safeInteger(state.resonanceShards + paid, 'refundable RS total')
  return paid
}

/** UI preview only; invalid state throws. Valid unavailable operations have a reason.
 * Priority: pending pulls, locked, numeric limit, insufficient RS.
 */
export function getUpgradeInfo(state: Readonly<GameState>, upgrade: Upgrade): UpgradeInfo {
  validateUpgrade(upgrade)
  validateUpgradeState(state)
  const level = state.upgradeLevels[upgrade]
  let nextCost: number | null = null
  try {
    nextCost = calculateUpgradeCost(upgrade, level)
  } catch (error) {
    if (!(error instanceof RangeError)) throw error
  }
  const unlocked = isUpgradeUnlocked(state, upgrade)
  const purchaseBlockReason: PurchaseBlockReason | null = state.pendingNormalPulls || state.pendingSpecialPulls
    ? 'PENDING_PULLS' : !unlocked ? 'LOCKED' : nextCost === null ? 'NUMERIC_LIMIT'
      : state.resonanceShards < nextCost ? 'INSUFFICIENT_RS' : null
  return { upgrade, level, nextCost, unlocked, resonanceShards: state.resonanceShards,
    spentShards: state.spentShards[upgrade], canPurchase: purchaseBlockReason === null, purchaseBlockReason }
}

/** One atomic, RNG-free manual purchase. Unchanged combat fields are shared
 * immutable snapshots; clone them before imperative edits (same as setFocus).
 */
export function purchaseUpgrade(state: Readonly<GameState>, upgrade: Upgrade): GameState {
  const info = getUpgradeInfo(state, upgrade)
  if (!info.canPurchase || info.nextCost === null) throw new RangeError('Cannot purchase upgrade: ' + info.purchaseBlockReason)
  const level = safeInteger(info.level + 1, 'next upgrade level')
  const spent = safeInteger(info.spentShards + info.nextCost, 'paid RS')
  const resonanceShards = safeInteger(state.resonanceShards - info.nextCost, 'remaining RS')
  return { ...state, resonanceShards,
    upgradeLevels: { ...state.upgradeLevels, [upgrade]: level },
    spentShards: { ...state.spentShards, [upgrade]: spent } }
}

/** Refund recorded payments exactly once, never recomputing prices.
 * Unchanged nested combat fields are shared immutable snapshots.
 */
export function respecUpgrades(state: Readonly<GameState>): GameState {
  const refund = validateUpgradeState(state)
  if (state.pendingNormalPulls || state.pendingSpecialPulls) throw new RangeError('Resume pending pulls before RESPEC')
  const resonanceShards = safeInteger(state.resonanceShards + refund, 'refunded RS')
  return { ...state, resonanceShards,
    upgradeLevels: { PULL_POWER: 0, RESONANCE_POWER: 0, SPECIAL_POWER: 0 },
    spentShards: { PULL_POWER: 0, RESONANCE_POWER: 0, SPECIAL_POWER: 0 } }
}
