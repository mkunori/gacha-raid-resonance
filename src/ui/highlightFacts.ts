import type { ResultSummary } from './battleController'
import { formatNumber as n } from './format'

/** Aggregate facts only: no inferred individual rarity, attribute or chronology. */
export function highlightFacts(result: ResultSummary): string[] {
  const facts: string[] = []
  if (result.value.clearedGame) facts.push('Stage 50 初回クリア！ おめでとうございます。')
  if (result.kind === 'normal') {
    if (result.value.ssrCount) facts.push(`SSR獲得 ${n(result.value.ssrCount)}回`)
    for (const [name, count] of Object.entries(result.value.resonanceCounts)) if (count) facts.push(`${name}共鳴 ${n(count)}回`)
    if (result.value.effectCounts.CHAIN) facts.push(`CHAIN発動 ${n(result.value.effectCounts.CHAIN)}回・追加 ${n(result.value.chainAdded)} PULL`)
    if (result.value.jackpotCount) facts.push(`JACKPOT！ ${n(result.value.jackpotCount)}回`)
  } else {
    for (const [name, count] of Object.entries(result.value.resultCounts)) if (count) facts.push(`${name} ${n(count)}回`)
  }
  if (result.value.stagesAdvanced) facts.push(`ボス撃破 ${n(result.value.stagesAdvanced)}体`)
  return facts
}

