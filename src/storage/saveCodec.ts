import { CORE_RULES, NORMAL_RARITIES, RESONANCE_ORDER, UPGRADE_RULES } from '../data/rules'
import { calculateBossMaxHp } from '../game/boss'
import { createInitialGameState } from '../game/engine'
import { isFeatureUnlocked, isUpgradeUnlocked } from '../game/progression'
import { calculateUpgradeCost } from '../game/upgrades'
import { finiteNumber, safeInteger, validateFocus, validateJackpotWindow, validatePullQueues,
  validateStacks, validateTemporary } from '../game/validation'
import type { GameState, SaveDataV1, Upgrade } from '../types/game'

/** Fixed-size save is normally <2 KiB. 64 Ki UTF-16 code units leaves ample room;
 * at most 128 KiB of string storage, checked before JSON.parse (no history arrays).
 */
export const MAX_SAVE_JSON_LENGTH = 65_536
export type SaveErrorCode = 'SYNTAX' | 'SIZE' | 'VERSION' | 'SCHEMA' | 'STATE'

export class SaveDataError extends Error {
  constructor(readonly code: SaveErrorCode, message: string) {
    super(message)
    this.name = 'SaveDataError'
  }
}

const TEMPLATE: SaveDataV1 = {
  saveVersion: 1, state: createInitialGameState(), settings: { reducedEffects: false },
  rng: { algorithm: 'mulberry32-v1', state: 0 },
}

function record(input: unknown, path: string): Record<string, unknown> {
  if (input === null || typeof input !== 'object' || Array.isArray(input)
    || (Object.getPrototypeOf(input) !== Object.prototype && Object.getPrototypeOf(input) !== null)) {
    throw new SaveDataError('SCHEMA', `${path}: 通常のJSONオブジェクトが必要です。`)
  }
  return input as Record<string, unknown>
}

/** Rebuild exactly the fixed schema, rejecting accessors, symbols and hidden keys too.
 * The assertion follows a recursive structural check, never trusts external GameState.
 */
function copyShape<T>(input: unknown, template: T, path: string): T {
  if (typeof template !== 'object' || template === null) {
    if (typeof input !== typeof template) throw new SaveDataError('SCHEMA', `${path}: 値の型が不正です。`)
    return input as T
  }
  const source = record(input, path)
  const keys = Object.keys(template)
  if (Reflect.ownKeys(source).length !== keys.length || keys.some(key => !Object.hasOwn(source, key))) {
    throw new SaveDataError('SCHEMA', `${path}: 必須キーの欠損または未知のキーがあります。`)
  }
  const result: Record<string, unknown> = {}
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(source, key)
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
      throw new SaveDataError('SCHEMA', `${path}.${key}: 通常のデータ値が必要です。`)
    }
    result[key] = copyShape(descriptor.value, (template as Record<string, unknown>)[key], `${path}.${key}`)
  }
  return result as T
}

function validateState(state: GameState): void {
  const maxHp = calculateBossMaxHp(state.stage)
  safeInteger(state.highestStage, '最高Stage', state.stage)
  calculateBossMaxHp(state.highestStage)
  finiteNumber(state.bossHp, 'ボスHP')
  if (state.bossHp <= 0 || state.bossHp > maxHp) throw new RangeError('ボスHPは現在Stageの最大HP以下の正数が必要です')
  validateStacks(state.stacks)
  validateTemporary(state.temporary)
  validateFocus(state.focus)
  if (!isFeatureUnlocked(state, 'FOCUS') && state.focus !== 'BALANCED') throw new RangeError('属性Focusが未解放です')
  safeInteger(state.catalyst, 'CATALYST', 0, CORE_RULES.catalystCap)
  safeInteger(state.resonanceShards, 'RS')
  validatePullQueues(state)
  validateJackpotWindow(state.jackpot, state.stage)

  let totalPaid = 0
  for (const upgrade of Object.keys(UPGRADE_RULES) as Upgrade[]) {
    const level = safeInteger(state.upgradeLevels[upgrade], `${upgrade} Lv`)
    const paid = safeInteger(state.spentShards[upgrade], `${upgrade} 支払台帳`)
    if (level > 0 && !isUpgradeUnlocked(state, upgrade)) throw new RangeError(`${upgrade}が未解放です`)
    let expected = 0
    // Exponential prices hit MAX_SAFE_INTEGER after <110 levels. Each iteration
    // checks price and total, so hostile huge levels cannot cause unbounded work.
    for (let current = 0; current < level; current++) {
      expected = safeInteger(expected + calculateUpgradeCost(upgrade, current), `${upgrade} 累積価格`)
    }
    if (paid !== expected) throw new RangeError(`${upgrade}の支払台帳が各Lvの実価格合計と一致しません`)
    totalPaid = safeInteger(totalPaid + paid, '全支払台帳')
  }
  safeInteger(state.resonanceShards + totalPaid, '全額返還後のRS')

  const stats = state.statistics
  for (const key of ['totalNormalPulls', 'totalSpecialPulls', 'ssrCount', 'bossesDefeated', 'jackpotCount'] as const) {
    safeInteger(stats[key], key)
  }
  let resonances = 0
  for (const resonance of RESONANCE_ORDER) {
    resonances = safeInteger(resonances + safeInteger(stats.resonanceCounts[resonance], resonance), '共鳴合計')
  }
  const stackCost = 2 * CORE_RULES.resonanceStackCost
  const maxStacks = Math.max(...Object.values(NORMAL_RARITIES).map(rule => rule.stacks))
  // Quotient/remainder keeps the integer bound exact near MAX_SAFE_INTEGER.
  const maxResonances = Math.floor(stats.totalNormalPulls / stackCost) * maxStacks
    + Math.floor((stats.totalNormalPulls % stackCost) * maxStacks / stackCost)
  if (stats.ssrCount > stats.totalNormalPulls || state.catalyst > stats.ssrCount
    || stats.jackpotCount > Math.floor(stats.totalNormalPulls / CORE_RULES.jackpotWindow)
    || stats.jackpotCount > Math.floor(stats.ssrCount / CORE_RULES.jackpotSsrThreshold)
    || stats.jackpotCount > Math.floor((stats.totalNormalPulls - state.jackpot.pullsInWindow) / CORE_RULES.jackpotWindow)
    || stats.jackpotCount > Math.floor((stats.ssrCount - state.jackpot.ssrInWindow) / CORE_RULES.jackpotSsrThreshold)
    || (!isFeatureUnlocked(state, 'JACKPOT') && stats.jackpotCount !== 0)
    || state.jackpot.pullsInWindow > stats.totalNormalPulls
    || state.jackpot.ssrInWindow > stats.ssrCount
    || stats.bossesDefeated < state.highestStage - 1
    // Subtraction avoids overflowing a potentially valid pair of lifetime counters.
    || stats.bossesDefeated - stats.totalNormalPulls > stats.totalSpecialPulls
    || resonances > maxResonances) {
    throw new RangeError('累積統計・Stage・触媒・JACKPOT区間が矛盾しています')
  }
}

/** Validates unknown input and returns a fully detached, fixed-schema copy.
 * No repairs, migrations, browser I/O, RNG draws or mutation of the input.
 */
export function validateSaveData(input: unknown): SaveDataV1 {
  const root = record(input, 'save')
  const version = Object.getOwnPropertyDescriptor(root, 'saveVersion')
  if (version && Object.hasOwn(version, 'value') && typeof version.value === 'number' && version.value !== 1) {
    throw new SaveDataError('VERSION', '未対応の保存バージョンです。元データを保持してください。')
  }
  const save = copyShape(input, TEMPLATE, 'save')
  try {
    if (save.saveVersion !== 1) throw new RangeError('保存バージョンが不正です')
    if (save.rng.algorithm !== 'mulberry32-v1') throw new RangeError('未対応のRNGアルゴリズムです')
    safeInteger(save.rng.state, 'RNG状態', 0, 0xffffffff)
    validateState(save.state)
  } catch (error) {
    if (!(error instanceof RangeError)) throw error
    throw new SaveDataError('STATE', `保存状態が不正です: ${error.message}`)
  }
  return save
}

export function serializeSaveData(data: SaveDataV1): string {
  const json = JSON.stringify(validateSaveData(data))
  if (json.length > MAX_SAVE_JSON_LENGTH) throw new SaveDataError('SIZE', '保存JSONが文字数上限を超えています。')
  return json
}

export function deserializeSaveData(json: string): SaveDataV1 {
  if (typeof json !== 'string') throw new SaveDataError('SCHEMA', '保存JSONは文字列が必要です。')
  if (json.length > MAX_SAVE_JSON_LENGTH) throw new SaveDataError('SIZE', '保存JSONが文字数上限を超えています。')
  let input: unknown
  try {
    input = JSON.parse(json)
  } catch {
    throw new SaveDataError('SYNTAX', '保存JSONの構文が壊れています。元データを保持してください。')
  }
  return validateSaveData(input)
}
