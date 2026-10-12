# 保存形式・JSON検証・RNGチェックポイント

Phase 8-A / Issue #23のcodec/randomはブラウザ非依存。Phase 8-B / Issue #24のアダプターでブラウザ画面の自動保存・復元を接続済み。
8-CとしてExport/Import・確認付き削除/復旧UIを接続済み。破損時も自動削除・初期化しない。

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

8-Bは**同じ成功チャンク境界のGameStateとRNG**を対で保持・保存する。
失敗チャンク後のlive RNGは既存契約どおり巻き戻さないが、その進んだ状態を以前の確定GameStateと組み合わせて保存しない。
最後の成功境界のチェックポイントを保存用に別途保持する。無失敗の分割/復元は一致するが、例外後live再開と再読込再開の一致は保証しない。
設定はreducedEffectsのみ保存。busy・summary・highlight・スキップ・初回クリア演出は保存しない。
復元時に過去のハイライトやクリア演出を再通知せず、新規確定分だけ通知する。破損/未来版を無断で上書き・削除しない。

詳細は[技術設計](../../docs/TECHNICAL_DESIGN.md)を参照。

## ブラウザ接続（8-B）

- `openLocalSave(getStorage)`：起動時の厳密ロード、元raw値の保持、write時codec検証と比較、外部変更による保存停止。I/Oを注入できる。
- `createAutosave(controller, adapter, { window, document })`：保存状態ストア、connect/cleanup、flush。最後の確定checkpoint1件だけを保持する。
- `createBrowserSession()`：React起動前に呼び、保存データまたはWeb Crypto生成seedでControllerと保存ストアを作る。
- `Controller.getCheckpoint()`：成功チャンク/同期操作/設定変更の不変SaveDataV1。live RNGを任意のタイミングで読むAPIではない。旧来の独立rng注入ではnull。
- `Controller.setReducedEffects(boolean)`：GameState/RNGを変更せず設定を更新する。AppはControllerの設定をResultEffectsへ渡す。

キーは`SAVE_STORAGE_KEY = 'gacha-raid-resonance:save'`。500msデバウンスと最大2秒で保存し、pagehide・visibilitychange(hidden)・接続解除時もflushする。
setItem成功前に保存済みとしない。容量/権限/検証失敗は通知し、次の更新や離脱で再試行する。
読込失敗・未来版・破損では新規ゲームをプレイできるが保存は停止し、元データを保護する。復旧はセーブ管理のバックアップ/確認付きImport・削除で行う。
storageイベントと書込直前のraw比較で他タブの更新を検知し、保存を停止する。別Storage/キーのイベントは無視する。
比較とsetItemは原子的CASではなく、真に同時な書込の完全排他や自動マージは保証しない。競合後は再読込が必要。
StrictModeの再接続に対応し、解除時にタイマー・イベント・Controller購読をすべて解除する。
ロード直後はbusy=false、highlight/result=null。保留予約があれば手動再開し、SPECIAL ×MAXを再計算しない。

## セーブ管理（8-C）

`createSaveManagement(controller, persistence, getStorage, reload)`はI/Oと再読込を注入できる。

- `exportCurrent()`：serializeSaveDataを使い、保存先の値ではなく現在の最新確定checkpointを出力。busyは拒否し、未保存/blockedでも利用可能。
- `backupRaw()`：保存先文字列を無変換で取得。未検証データとして別名・警告付きダウンロード。読取不能/保存なしは明示エラー。
- `prepareImport(file)`：size上限128 KiBを読込前に確認→text→codec完全検証→独立した対象プレビューと確認トークン。文字数上限は既存65,536 UTF-16コード単位。
- `prepareDelete()`：現在のcheckpoint/rawを固定した削除確認トークン。
- `confirm(token)`：busy/最新checkpoint/所有トークンを確認→Autosave.suspend→raw再照合→setItemまたは対象キーだけremoveItem→retire→reload。書込/削除失敗時は元raw/stateを保持してresume。

Autosaveの`suspend`はflushせずタイマーを止め、`resume`は失敗/取消後に通常保存へ戻すためのAPI。`retire`は永久に保存を無効化し、購読/イベントを解除する。retire後は旧flush・cleanup・再connectでも書き戻せない。通常のApp解除は従来どおりflushする。

確認中の通常Autosaveによるraw変更も再確認対象。blockedを解除して通常保存に流用せず、現在rawへの明示確認付き置換を別経路で行う。完全同時書込みのCASは保証しない。
成功後は通常起動を使ってstate/RNG/settingsを一括復元し、保留キューは手動再開。削除後は新しいseedで新規開始し、その後の自動保存で初期状態を保存する。取消/Escでは管理操作による変更なし。ゲーム状態を含むJSONは暗号化されていない。
