import { expect, it } from 'vitest'
import { seededRng, sequenceRng } from './random'

it('fails on exhausted fixed sequences', () => {
  const rng = sequenceRng([0, 0.5])
  expect(rng()).toBe(0)
  expect(rng()).toBe(0.5)
  expect(() => rng()).toThrow('Test RNG sequence exhausted')
})

it('pins Mulberry32 outputs for seed 1', () => {
  const rng = seededRng(1)
  expect(Array.from({ length: 3 }, rng)).toEqual([
    0.6270739405881613, 0.002735721180215478, 0.5274470399599522,
  ])
})
