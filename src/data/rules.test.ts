import { describe, expect, it } from 'vitest'
import { EFFECT_PROBABILITIES, FOCUS_PROBABILITIES, NORMAL_RARITIES, SPECIAL_RESULTS } from './rules'

describe('v0.6 probability data', () => {
  const distributions = [
    Object.values(NORMAL_RARITIES).map((rule) => rule.probability),
    Object.values(EFFECT_PROBABILITIES),
    Object.values(SPECIAL_RESULTS).map((rule) => rule.probability),
    ...Object.values(FOCUS_PROBABILITIES).map((rule) => Object.values(rule)),
  ]

  it.each(distributions.map((probabilities, index) => ({ probabilities, index })))(
    'distribution $index contains valid probabilities totaling 100%',
    ({ probabilities }) => {
      expect(probabilities.reduce((sum, probability) => sum + probability, 0)).toBeCloseTo(1, 12)
      for (const probability of probabilities) {
        expect(probability).toBeGreaterThanOrEqual(0)
        expect(probability).toBeLessThanOrEqual(1)
      }
    },
  )
})
