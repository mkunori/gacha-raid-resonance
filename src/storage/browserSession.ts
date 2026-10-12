import { createInitialGameState } from '../game/engine'
import { createBattleController } from '../ui/battleController'
import { createCheckpointRandom } from './random'
import { openLocalSave } from './localSave'
import { createAutosave } from './autosave'

/** Called once before React renders, never from render/Effect/state updaters. */
export function createBrowserSession() {
  const adapter = openLocalSave(() => window.localStorage)
  const saved = adapter.data
  const checkpointRandom = createCheckpointRandom(saved?.rng ?? {
    algorithm: 'mulberry32-v1', state: crypto.getRandomValues(new Uint32Array(1))[0],
  })
  const controller = createBattleController({ initialState: saved?.state ?? createInitialGameState(),
    settings: saved?.settings, checkpointRandom })
  return { controller, persistence: createAutosave(controller, adapter, { window, document }) }
}
