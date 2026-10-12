import { describe, expect, it } from 'vitest'
import { createCheckpointRandom, nextRandom } from './random'
import { seededRng } from '../test/random'

describe('mulberry32-v1 checkpoints', () => {
  it.each([0, 1, 0x12345678, 0xffffffff])('matches the existing fixed-seed sequence, seed %s', state => {
    const original = seededRng(state)
    const rng = createCheckpointRandom({ algorithm: 'mulberry32-v1', state })
    for (let i = 0; i < 1000; i++) expect(rng.random()).toBe(original())
  })

  it('has a stable known first output for seed 1', () => {
    expect(nextRandom({ algorithm: 'mulberry32-v1', state: 1 }).value).toBe(0.6270739405881613)
  })

  it('resumes the next value, not the beginning, and detaches snapshots', () => {
    const initial = { algorithm: 'mulberry32-v1' as const, state: 17 }
    const rng = createCheckpointRandom(initial)
    initial.state = 99
    for (let i = 0; i < 17; i++) rng.random()
    const saved = rng.getCheckpoint()
    const resumed = createCheckpointRandom(JSON.parse(JSON.stringify(saved)))
    saved.state = 0
    for (let i = 0; i < 100; i++) expect(resumed.random()).toBe(rng.random())
  })

  it('pure nextRandom does not mutate or share the input', () => {
    const input = Object.freeze({ algorithm: 'mulberry32-v1' as const, state: 0xffffffff })
    const a = nextRandom(input)
    expect(nextRandom(input)).toEqual(a)
    expect(a.checkpoint).not.toBe(input)
    expect(input.state).toBe(0xffffffff)
    expect(a.value).toBeGreaterThanOrEqual(0)
    expect(a.value).toBeLessThan(1)
  })

  it.each([-1, 0.5, 0x100000000, NaN, Infinity, Number.MAX_SAFE_INTEGER])('rejects invalid state %s', state => {
    expect(() => createCheckpointRandom({ algorithm: 'mulberry32-v1', state })).toThrow(RangeError)
    expect(() => nextRandom({ algorithm: 'mulberry32-v1', state })).toThrow(RangeError)
  })

  it('rejects an unknown algorithm', () => {
    expect(() => createCheckpointRandom({ algorithm: 'other' as 'mulberry32-v1', state: 1 })).toThrow(RangeError)
  })
})
