import type { RandomSource } from '../types/game'

/** Test-only sequence. Exhaustion fails rather than silently recycling values. */
export function sequenceRng(values: readonly number[]): RandomSource {
  let index = 0
  return () => {
    if (index >= values.length) throw new Error('Test RNG sequence exhausted')
    return values[index++]
  }
}

/** Test-only Mulberry32, using a fixed unsigned 32-bit seed. Not for security. */
export function seededRng(seed: number): RandomSource {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let value = Math.imul(state ^ (state >>> 15), state | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 0x100000000
  }
}
