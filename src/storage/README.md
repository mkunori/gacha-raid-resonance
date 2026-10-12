# 保存形式・JSON検証・RNGチェックポイント

Phase 8-A / Issue #23を実装済み。React、window、document、localStorageに依存しない。
ブラウザ保存・Controller接続は8-B、Export/Import・削除UIは8-C。現在の画面は再読込で初期化される。

```ts
import { createCheckpointRandom } from './random'
import { serializeSaveData, deserializeSaveData } from './saveCodec'
import { createInitialGameState } from '../game/engine'

const state = createInitialGameState()
const settings = { reducedEffects: false }
const rng = createCheckpointRandom({ algorithm: 'mulberry32-v1', state: 123 })
// engineにはrng.randomを渡す。成功した処理の直後にstateと一緒に取得する。
const json = serializeSaveData({ saveVersion: 1, state, settings, rng: rng.getCheckpoint() })
const restored = deserializeSaveData(json)
const continued = createCheckpointRandom(restored.rng)
// restored.stateとcontinued.randomで保留キューを手動再開する。
```

- `validateSaveData(input: unknown): SaveDataV1`：全ネストが独立した検証済みコピー。
- `serializeSaveData(data: SaveDataV1): string`：書出し時も完全検証。
- `deserializeSaveData(json: string): SaveDataV1`：サイズ確認→パース→完全検証。
- `nextRandom(checkpoint)`：純粋な1ステップ（valueと次のcheckpoint）。
- `createCheckpointRandom(checkpoint)`：RandomSource互換randomと独立コピーgetCheckpoint。初期化・snapshotで乱数を進めない。

形式は`{ saveVersion: 1, state: GameState, settings: { reducedEffects: boolean }, rng: { algorithm: 'mulberry32-v1', state: uint32 } }`。
RNG状態は次の抽選直前の内部状態であり、初期seedだけではない。0と2^32−1を含む。
アルゴリズム変更には新しい識別子と明示的対応が必要。非暗号学的RNG。

必須キー/型/列挙値/数値範囲を固定スキーマで検査し、余分なキー・配列・null・文字列数値・アクセサー・特殊プロトタイプ・symbol/非列挙キーを拒否する。
Stage/HP/解放/スタック/一時効果/資源/台帳/統計/JACKPOT/キューを検証し、小数HPは丸めない。
NORMALのbase+chain合計、SPECIAL予約のゲージ充足と両キュー排他を検証する。予約回数を再計算しない。
台帳は各Lvの既存ceil価格を加算した正確な合計と一致させ、全額返還後RSのオーバーフローも拒否する。
現行指数価格は110Lv未満で安全整数範囲を超え、巨大Lvでも検証が無制限に反復しない。
検証は整合性の確認であり、クライアント上の改ざん・購入履歴を認証するものではない。

JSON上限は65,536 UTF-16コード単位（通常2 KiB未満、文字列本体で最大128 KiB相当）。パース前に確認する。
`SaveDataError`には日本語messageとcode（SYNTAX / SIZE / VERSION / SCHEMA / STATE）がある。
未来版をv1として読み直したり、旧版・不正台帳を自動修復したりしない。失敗時は入力不変・部分復元なし・RNG消費なし。

8-Bは**同じ成功チャンク境界のGameStateとRNG**を対で保持・保存すること。
失敗チャンク後のlive RNGは既存契約どおり巻き戻さないが、その進んだ状態を以前の確定GameStateと組み合わせて保存しない。
最後の成功境界のチェックポイントを保存用に別途保持する。無失敗の分割/復元は一致するが、例外後live再開と再読込再開の一致は保証しない。
設定はreducedEffectsのみ保存。busy・summary・highlight・スキップ・初回クリア演出は保存しない。
復元時に過去のハイライトやクリア演出を再通知せず、新規確定分だけ通知する。破損/未来版を無断で上書き・削除しない。

詳細は[技術設計](../../docs/TECHNICAL_DESIGN.md)を参照。
