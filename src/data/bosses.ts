import { CORE_RULES } from './rules'

/** v0.6 chapter 5. Compound traits remain separate factors and are multiplied. */
export const SPECIAL_BOSSES = {
  5: { name: 'ゴーレム', normal: [0.75], resonance: [1.25] },
  10: { name: '炎竜', fire: 0.5, thunderStorm: 1.5 },
  15: { name: '虚空の術師', normal: [0.85], special: 1.8 },
  20: { name: '共鳴封印獣', normal: [1.7], resonance: [0.7] },
  25: { name: '雷獣', overload: CORE_RULES.overloadSpecialBossGaugeGain },
  30: { name: '裂界竜', fire: 0.8, thunderStorm: 1.5 },
  35: { name: 'ゴーレム＋術師複合', normal: [0.75, 0.85], resonance: [1.25], special: 1.8 },
  40: { name: '炎竜＋封印複合', fire: 0.5, normal: [1.7], thunderStorm: 1.5, resonance: [0.7] },
  45: { name: '術師＋雷獣複合', normal: [0.85], special: 1.8, overload: CORE_RULES.overloadSpecialBossGaugeGain },
  50: { name: '裂界竜強化', fire: 0.8, thunderStorm: 1.5 },
} as const satisfies Record<number, BossDefinition>

export interface BossDefinition {
  readonly name: string
  readonly normal?: readonly number[]
  readonly fire?: number
  readonly resonance?: readonly number[]
  readonly thunderStorm?: number
  readonly special?: number
  readonly overload?: number
}
