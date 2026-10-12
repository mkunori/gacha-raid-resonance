import type { RandomSource, RngCheckpoint } from '../types/game'
import { safeInteger } from '../game/validation'

/** Deterministic, non-cryptographic RNG. Changing the algorithm requires a new ID. */
export function nextRandom(checkpoint: Readonly<RngCheckpoint>): { value: number; checkpoint: RngCheckpoint } {
  if (checkpoint.algorithm !== 'mulberry32-v1') throw new RangeError('Unsupported RNG algorithm')
  safeInteger(checkpoint.state, 'RNG state', 0, 0xffffffff)
  const state = (checkpoint.state + 0x6d2b79f5) >>> 0
  let value = Math.imul(state ^ (state >>> 15), state | 1)
  value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
  return { value: ((value ^ (value >>> 14)) >>> 0) / 0x100000000,
    checkpoint: { algorithm: 'mulberry32-v1', state } }
}

/** Stateful adapter for the existing RandomSource contract; never shares checkpoints.
 * Capture together with the committed GameState. Browser/controller wiring is Phase 8-B.
 */
export function createCheckpointRandom(initial: Readonly<RngCheckpoint>): {
  random: RandomSource
  getCheckpoint: () => RngCheckpoint
} {
  // Validate without consuming a draw.
  nextRandom(initial)
  let checkpoint: RngCheckpoint = { algorithm: initial.algorithm, state: initial.state }
  return {
    random: () => {
      const next = nextRandom(checkpoint)
      checkpoint = next.checkpoint
      return next.value
    },
    getCheckpoint: () => ({ ...checkpoint }),
  }
}
