# 技術設計

仕様の正本: [GAME_SPEC v0.6](GAME_SPEC.md)。[Issue #1](https://github.com/mkunori/gacha-raid-resonance/issues/1)はCLOSEDの仕様作成履歴。
本書の将来設計は実装済み機能ではない。ゲームの数値・解放順・1PULL順序はGAME_SPECを正とする。

## 構成

```text
.github/workflows/       CIとmain専用Pagesデプロイ
docs/                   仕様、設計、段階的な計画
src/
  components/           表示と操作のコンポーネント
  ui/                   戦闘操作ストア・チャンク実行・集計結合・表示用数値整形
  data/rules.ts         v0.6確率・倍率・コスト・解放設定（初期定義）
  data/bosses.ts        10特殊ボスの名前・補正因子
  game/                 通常抽選・H1/H2・戦闘・追加効果・一括PULL実装済み
    gacha.ts            独立抽選とH1スタック加算
    resonance.ts        3共鳴・予約効果・H2/BOOST消費・反復判定
    combat.ts           基礎A・通常/共鳴ダメージ
    special.ts          独立SPECIAL抽選・火力・MAX予約数
    jackpot.ts          Stage20以降の区間集計・ボーナス計算
    boss.ts             特性取得・PULL終了後のStage進行/クリアイベント
    progression.ts      highestStageによる解放/クリア判定・Focus切替
    validation.ts       数値・スタック・一時効果・区間/キュー整合性の検証
    upgrades.ts         1Lv価格・購入情報・手動購入・台帳・全額RESPEC
    engine.ts           初期状態・実PULL統合・CHAINキュー・一括/再開・集計
  storage/              saveCodec（完全検証・JSON変換）、random（RNGチェックポイント）
  types/game.ts         UI非依存のゲーム・保存型契約
  test/                 テスト専用の固定列・固定シードRNG
  App.tsx               画面の構成
  main.tsx              React起動
  styles.css            レスポンシブな表示
```

不要な空モジュール・ゲームエンジン・状態管理ライブラリは追加しない。
共鳴ペアとフォーカス優先・固定順はsrc/data/rules.tsに集約済み。
特殊ボス表はsrc/data/bosses.tsに集約し、GAME_SPEC第5章の独立した期待値と照合する。

## Reactの責務と状態の境界

Phase 7-AではAppがBattlePanel（HP・Stage・耐性・クリア）、ResourcePanel（属性・一時効果・RS・ゲージ）、
PullControls（解放条件・操作・進捗・エラー・再開）、PullResultSummary（固定サイズ集計）を構成する。
Phase 7-BではUpgradePanel（3強化・不可理由）、RespecDialog（無料全返還確認）、FocusPanel（4分布選択）も接続済み。
Phase 7-CではResultEffects（集計ハイライト・表示設定）とStatisticsPanel（累積統計）を接続済み。
Reactは表示・入力・確認ダイアログ・結果集計のみを担当し、抽選式を持たない。

まずReact標準の状態管理で十分。アクション実行の境界でコアを呼び、
操作完了時または安全な分割境界で新しいGameStateをまとめて反映する。
RNGはイベントハンドラーでコアに渡し、再描画中やReactの再実行可能な更新関数内で乱数を消費しない。
大量抽選はチャンクで実行し、実行中の競合操作をガードする。1件ずつDOM更新しない。
Web Workerは実測で必要になった場合のみ検討する。

### Phase 7-Aの実行制御（Issue #15）

`src/ui/battleController.ts`はReact非依存の操作ストア。Appは`useSyncExternalStore`で確定スナップショットを購読する。
`createBattleController`は初期状態・RNG・チャンクサイズ・描画待ち関数を注入可能。通常はcreateInitialGameStateとMath.randomを使用する。
作成・購読・render・Effect・React更新関数では抽選しない。ボタンのイベントでstart/resumeを呼び、同期的にbusyを立てて二重受付を拒否する。
NORMAL/SPECIALの新規操作は保留中も拒否する。7-Bの強化・RESPEC・Focus操作も同じbusy/保留ガードを共有する。

最初はexecuteNormalPulls/executeSpecialPulls、以降はresumePendingNormalPulls/resumePendingSpecialPullsを呼ぶ。
既定100実PULL（テスト注入は1〜500）で1チャンクとし、最初の処理前と各チャンク間に16msのsetTimeoutで描画・入力処理へ制御を返す。
最後に成功したGameStateをストアへ即時コミットし、次は必ずその状態と同じRNG関数の続きで実行する。毎PULLのReact更新はしない。
mergeSummaryは固定の種別別カウンターを加算し、pendingPullsは最新値、clearedGameはORで結合する。イベント履歴を保持しない。
UIのstart/resume 1呼び出しはCHAIN込み累積10,000実PULLまで自動実行する。最後のチャンクは残り予算まで短縮し、完全なPULL/チャンク境界で停止する。
予約が残ればUIスナップショットのpausedをtrue、busyをfalseとして正常な一時停止を表示する（errorではない）。NORMAL/CHAIN/SPECIAL予約・累積集計・RNGを保持し、新規操作は拒否する。
手動resumeは同じストリームの続きから最大10,000実PULLを処理する。上限ちょうどで予約が空なら完了扱い。GameStateやコアの100,000上限・バランスは変更しない。
statusライブ領域は開始/完了/保留の状態変化を通知し、進捗数値は通常テキストで表示する。

例外時は失敗チャンクをコミットせず最後の成功状態・集計を保持してerrorを表示する。保留キューがあればresumeで再開できる。
初回チャンクが失敗した場合は新規予約も未コミットとなるため、保留再開ではなく新規操作を再試行する。
コアの契約どおり失敗チャンクで消費済みのRNGは巻き戻さない。例外を含む実行が無失敗実行と一致する保証はなく、
無失敗のチャンク分割は同一ストリームで一括実行と一致する。整合性違反が残る場合、再開もコアが拒否して再度停止する。

最後の購読解除（画面破棄）でAbortControllerを中止し、待機タイマーを解除する。古い継続処理は中止トークンを検査し、新しい操作に状態を書き戻さない。
StrictModeの購読解除/再購読だけでは操作を開始しない。予約が残る場合は明示再開が必要。
スナップショットは直接変更しない。保存・RNG永続化はPhase 8まで未実装で、再読込時には初期化されることを画面に明示する。

表示専用formatNumberは大数を科学表記、小数を最大2桁へ整形し、非有限値は「—」とする。HPバー割合は0〜100にクランプし数値・ARIAテキストを併記する。
Vitestの既存node環境を維持し、React UIテストだけjsdom・Testing Library・user-eventを使う。固定RNGとストア注入で実際のコア/API接続・StrictMode・競合・再開・キーボードを検証する。

### Phase 7-Bの同期操作と確認UI（Issue #17）

Controllerに`purchase(upgrade, expectedState)`、`respec(expectedState)`、`changeFocus(focus, expectedState)`を追加。
expectedStateは表示時のGameState参照で、更新対象ではなく楽観的排他用のトークン。busy → 保留キュー → 最新stateとの参照一致を検証し、
最新stateをそれぞれpurchaseUpgrade / respecUpgrades / setFocusへ渡す。成功時は戻り値を1回publishしtrue、失敗時はstate・PULL summary・RNGを保持して通知のみ更新しfalse。
正常な安全一時停止やエラー後でも保留中なら育成操作を拒否する。各同期APIはRNGを使わず、10,000上限やチャンク再開を変更しない。
古い参照での重複送信は拒否する。最新参照を取り直した操作は新しい1操作として扱う。

UpgradePanelはgetUpgradeInfo / isUpgradeUnlocked / UPGRADE_RULESから価格・理由・解放・倍率を表示する。RS/Lvの独自更新は行わない。
クリックdetailが2以上の購入イベントは無視し、通常のダブルクリックを1購入として扱う。キーボードや新しい単発クリックで手動1Lvずつ購入できる。
前回PULLのsummaryは育成操作では変更せず「直前のPULL結果」として表示し、育成の成功・失敗は別のライブ領域noticeで通知する。

RESPECはローカルReact stateに確認の開閉のみを持つ。native dialog.showModalで背景をinertにし、キャンセルを初期フォーカスとする。
台帳の表示合計・全3種の現Lv・全Lv0・無料を提示。確認中も表示は最新stateから導出し、確定時にControllerが再検証する。
確定ハンドラーはrefで1回に限定し、確定前のstateを二重送信しない。キャンセル/Escはコアを呼ばない。Tab/Shift+Tabを2ボタン間で循環する。
閉じたら元ボタンへフォーカスを戻す。確定後に元ボタンが無効になった場合は強化見出しへ戻す。台帳0ならRESPECボタンを無効化する。
jsdomではdialogのopen状態のみ模擬し、実際のモーダル・背景抑制・フォーカスはEdgeで確認する。

FocusPanelは既存FOCUS_PROBABILITIESから4種類の属性確率を表示し、state.focusをラジオの唯一の選択値とする。
highestStageで解放判定しStage6前はBALANCED固定。busy/保留中はfieldsetごと無効化する。
7-Bの範囲には保存・演出・統計画面・×MAX強化・自動購入を含めない。演出と統計は下記7-Cで追加した。

### Phase 7-Cの集計演出・統計（Issue #19）

BattleSnapshot.highlightはUI専用の`{ id, result: ResultSummary } | null`。GameStateや保存データには追加しない。
各start/resume呼び出し内で、成功したチャンクのsummaryだけを固定サイズで結合し、完了・10,000安全一時停止・エラー停止のfinallyで一度publishする。
従来のresultは操作全体の累積を維持し、highlightはその呼び出しの増分のみ。再開前のSSR/共鳴/JACKPOTやclearedGameの累積ORを再通知しない。
成功チャンク0の失敗では以前のhighlight参照/idを維持する。破棄時は既存abort契約に従い、古い非同期処理から通知しない。
画面は「直近の確定結果」と明示し、新しい確定分のない失敗では以前の結果が残る旨をライブ領域の外に説明する。以前のバナーを再生成・再通知しない。
購入/RESPEC/Focus変更でもhighlightを更新しない。RNG・戦闘コア・チャンク処理・排他・安全上限の意味は変更しない。

highlightFactsは集計からSSR・共鳴種別・CHAIN件数/追加数・JACKPOT・SPECIAL全種類・討伐・初回クリアの事実だけを生成する表示専用関数。
各属性・SSR出現位置・発生順・発生Stageは表示しない。×1でもCHAINを含む確定集計として扱う。
ResultEffectsは最新1件のみを保持するライブ領域と、idをkeyとする短いCSSアニメーション（600ms、非モーダル）を表示する。
履歴配列・タイマー・演出待機・演出用RNGはなく、連続操作で古いバナーを蓄積しない。クリア済み状態は従来どおりhighestStageから継続表示する。

DisplaySettings.reducedEffectsとスキップ対象idはReact内の一時的な表示状態。軽減/スキップ時は動きだけを除き、重要な集計テキストは残す。
OSのprefers-reduced-motionはCSSで尊重し、表示設定の変更はbusy中も可能。スキップは現在のバナーのみ対象とし、予約PULLや戦闘処理を中断しない。
設定は再読込で初期化し、Phase 8でSaveDataV1.settingsへの保存を検討する。
StatisticsPanelはstate.statisticsとhighestStageを直接参照し、NORMAL/SPECIAL/SSR/3共鳴/討伐/JACKPOT/最高Stageを静的に表示する。
直前結果と見出しを分け、存在しない生涯CHAIN数などは追加しない。RESPECやFocus変更でも統計は保持される。
総合UX・高負荷は下記7-Dで検証済み（実機タッチ・数時間の実測は未検証）。保存/設定永続化/復元後の演出方針はPhase 8へ引き継ぐ。
Phase 8ではreducedEffectsを永続化し、保存復元時に達成済みクリア演出を再発行せず、過去のPULLハイライトを新規結果として再通知しない契約を維持する。

### Phase 7-Dの検証と小規模UX調整（Issue #21）

verify-ux-performance.mjsはローカル専用Fixture・固定RNGで6幅/文字200%と高負荷/再開を検証する。
GameState/summary/RNGをコアの別ストリームと毎回照合し、React Profiler、rAF、CDPメモリ/DOM/リスナー、setTimeout、Controller購読を計測する。
タイミングの固定msを合否条件にせず、結果一致と描画機会・有限集計・購読解除を検証する。測定条件と限界はUI_VERIFICATIONを参照。
verify-progression-ui.mjsはUI_WIDTHS/UI_TOUCHで6幅・tapも再現可能。既定の3幅・マウス/キーボード確認も維持する。
文字拡大時のタイトル折返し、演出軽減ラベル44px、末尾のPULL見出しへのアンカーを追加した。
戻り先はtabIndex=-1でフォーカス可能にし、TabでNORMAL×1へ戻れる。ゲーム状態/RNG/チャンクの変更はない。
実機モバイルとスクリーンリーダーの音声・低速端末の長時間評価は未実施。保存の先行実装はしない。

## GameState案

型の詳細は[src/types/game.ts](../src/types/game.ts)。
Stage・最高Stage・現在HP・3属性スタック、GAUGE、RS、強化Lv、支払済みRS、
CATALYST、フォーカス、一時効果、JACKPOT区間、未実行通常PULL数、基本/CHAIN残数、SPECIAL予約残数、統計を保持する。
統計は通常/SPECIAL回数、SSR、共鳴種類別回数、ボス撃破、JACKPOTを含む。
表示設定はGameStateと分離してSaveDataV1に格納する。
ボス最大HP・基礎攻撃力・価格・解放状態はStage/強化Lv/設定から導出し、
保存した重複値を正としない。解放条件のStage 5撃破はStage 6到達で復元する。

```ts
// 将来のコアAPI案（今回未実装）
type EngineResult = { state: GameState; events: GameEvent[] }
function execute(state: GameState, action: GameAction, rng: RandomSource): EngineResult
```

GameActionは通常抽選、SPECIAL、強化、振り直し、フォーカス切替。
GameEventは抽選結果、チャネル別ダメージ、共鳴、討伐、報酬、解放等の判別共用体を想定。
入力を破壊せず新状態を返す。時計・localStorage・React・ネットワークを参照しない。
Phase 2ではCombatEvent / CombatResultを実装済み。汎用GameActionは必要なアクション追加時に導入する。

## 抽選とダメージの分離

gachaはRNGから属性・レアリティ・追加効果をそれぞれ独立に抽選し、NormalPullResultを返す。
通常抽選・H1/H2・基本戦闘・追加効果・単一/一括PULL・手動SPECIAL・JACKPOTは実装済み。

### 通常ガチャの公開API（Issue #3）

- `drawNormalPull(focus: Focus, rng: RandomSource): NormalPullResult`
  はレアリティ → 属性 → 追加効果の順で各1回、計3回だけRNGを消費する。
  列挙順は明示した配列で固定し、確率は既存rules.tsを参照する。
  各区間は下端以上・上端未満。境界と一致した値は次区間に入る。
  v0.6の確率はすべて整数％なので、各確率を整数％へ変換して累積し、100で割った閾値と比較する。
  これにより0.92+0.02等の二進浮動小数点誤差で境界がずれることを防ぐ。
  将来、端数％を採用する場合は閾値の表現精度とテストを同じPRで更新する。
- RNGは有限なnumberかつ0以上1未満が必須。不正値はRangeErrorで即時停止し、再抽選しない。
  失敗までに消費した乱数は巻き戻さない。不正FocusはRangeError、RNG消費0回。
- `applyNormalPullStacks(stacks: Readonly<Record<Element, number>>, result: Readonly<Pick<NormalPullResult, 'element' | 'rarity'>>): Record<Element, number>`
  はH1を既存NORMAL_RARITIESから取得し、選ばれた属性だけを加算してCORE_RULES.stackCapで切り捨てる。
  全属性の入力は整数0〜12、属性/等級は既知値を要求し、違反はRangeError。
  常に新しいオブジェクトを返し、入力を変更しない。完全なNormalPullResultも渡せるが追加効果は参照しない。
- Stage解放ガード、共鳴消費、H2、CHAIN/CHARGE/BOOSTの発動、ダメージ、保存は担当しない。
  両APIはReact・ストレージ・Math.randomに依存しない。

### 戦闘計算と後続機能

SPECIALの結果も独立した抽選関数とする。抽選関数はHPを変更しない。
combatは確定結果とA・一時効果・ボス補正からダメージを計算し、乱数を使わない。
チャネルは通常／共鳴／SPECIAL／JACKPOTを明示し、JACKPOTに通常耐性を誤適用しない。
HP/RS/価格は仕様のceilのみ、ダメージは途中丸めせず、表示のみ丸める。

単一PULL engineは抽選→通常攻撃→H1→SSRのCATALYST取得→全共鳴→基本ゲージ→追加効果→JACKPOT→討伐確定の順で処理する。
CATALYSTは同一PULL共鳴にも適用し、BOOST取得は共鳴後。JACKPOTは追加効果後・討伐遷移前に実装済み。
余剰ダメージは捨て、未実行PULLは次Stageへ。共鳴ループにはガードを持つ。
BOOST/THUNDER/FLAME/属性スタックを討伐で初期化し、CATALYST/GAUGE/JACKPOT区間は保持する。

### Phase 2の公開APIと状態契約（Issue #5）

| モジュール / API | 入力 → 出力 / 責務 |
| --- | --- |
| combat.calculateAttack | PULL POWER Lv → 基礎A |
| combat.calculateNormalDamage | A、rarity、FLAME有効フラグ、任意ボス倍率（既定1） → 通常ダメージ |
| combat.calculateResonanceDamage | A、RESONANCE POWER Lv、その他倍率、任意ボス倍率（既定1） → 共鳴ダメージ |
| boss.calculateBossMaxHp / calculateBossReward | 正整数Stage → ceilしたHP / RS |
| boss.applyBossDamage | 現HP、非負ダメージ → 丸めない残HP（PULL内は負値を許容） |
| boss.finishBossDefeat | 検証済みGameState → CombatResult。生存中は同一state参照・空イベント、HP<=0なら1回だけ報酬/次Stage |
| resonance.findNextResonance | スタック、Focus → 次の共鳴またはnull |
| resonance.resolveResonances | スタック、一時状態、Focus、A、共鳴Lv、CATALYST（既定0）、元Stage（既定1） → 新スタック/一時状態/残触媒、ゲージ増分、発動順の共鳴/ダメージ/消費情報 |
| engine.createInitialGameState | 引数なし → 独立した初期GameState（Stage 1、強化Lv0、基本値はrulesを参照） |
| engine.executeNormalPull | GameState、RNG → CombatResult（新stateと順序付きCombatEvent[]） |

executeNormalPullは入力を検証後、既存drawNormalPullを呼び、正常時は乱数3回だけ消費する。
HP>0かつStage最大HP以下の確定状態を要求し、死亡途中状態の再入力による二重報酬を拒否する。
全てのPULL内ダメージは元のStageに属する。イベントのdamageは計算値で、残HPで切り詰めた値ではない。
討伐イベントとStage開始イベントは追加効果適用イベントの後。次Stageは常に最大HPから開始する。
executeNormalPullは入力の各ネスト状態をコピーし、失敗時も呼出元の状態を変更しない。ただし消費済みRNGは巻き戻せない。
finishBossDefeat単体は入力を変更しないが、生存時は入力そのものを返し、討伐時も未変更のネスト値は参照共有する。
呼び出し側は入出力を不変のスナップショットとして扱う。返却stateを直接編集すると共有元にも影響するため、
命令的な編集が必要ならstructuredClone等でコピーしてから編集する。
executeNormalPullは既に分離した作業状態をfinishBossDefeatへ渡すため、元の呼出元GameStateとの共有はない。
データ型そのもののJSONスキーマ検証は保存フェーズで扱い、このAPIはGameState型を前提に数値・列挙値のドメインを検証する。

FLAMEは今回共鳴×1.5と次の10通常PULL×1.15。通常攻撃で旧残回数を減らした後、共鳴で残回数10へ更新する。
THUNDERは既存予約を現在共鳴で使って消費してから、THUNDERであれば新しい予約を1つ残す。
同一PULL内の次共鳴にも効く。OVERLOADは1発ごとに通常+12、Stage 25/45のみ+24。
反復上限はスタック総上限/(3+3)から導出し、ゼロダメージでもスタック消費により必ず終了する。
Phase 3ではBOOSTとCATALYSTの取得・消費・ダメージ乗算も適用する（下記）。
討伐時は属性とBOOST/THUNDER/FLAMEをリセットし、ゲージ・CATALYST・フォーカス・強化・支払台帳・キュー・JACKPOT区間は保持する。
更新する統計は通常PULL、SSR、種類別共鳴、討伐数と最高Stageのみ。他機能の統計は保持する。
Phase 4ではSPECIAL回数とJACKPOT発動回数も対応する実行時に更新する。

Phase 2時点では全Stageが通常ボス倍率1.0だった。Phase 5では元Stageの特殊ボス補正を各チャネルへ接続済み。
Stage 50撃破後は共通のStage+1を維持し、一度だけクリアイベントを加える（下記）。
ゲージはゲーム上の上限なし。資源/カウンター/Stage/Lvは安全整数、ダメージ・HPは有限で絶対値MAX_SAFE_INTEGER以下を要求する。
HPとダメージの小数は保持し、途中整数丸めをしない。数値演算が検証範囲を越えた場合はRangeErrorで結果全体を返さず停止する。
これはバランス上限ではなくJavaScript numberの数値安全境界であり、無限成長に対応する場合は数値表現を別途設計する。

### Phase 3の公開API・キュー契約（Issue #7）

- `executeNormalPull(state, rng): CombatResult`は1実PULLだけを進める低レベルAPI。
  キューがあればCHAINを優先して1件消費し、空なら暗黙の基本PULLを1回実行する。
  CHAINが生成した3件はキューへ残す。ユーザーの×1操作全体は次のexecuteNormalPullsを使う。
- `executeNormalPulls(state, count: 1 | 10 | 100 | 1000, rng, limit?: number): NormalPullBatchResult`
  は新規操作。NORMAL/SPECIAL両キューが空であることを要求し、基本PULLを予約して共通再開処理へ渡す。
- `resumePendingNormalPulls(state, rng, limit?: number): NormalPullBatchResult`
  は既存キューのみを反復処理する。limitは整数1〜100,000、既定値はCORE_RULES.operationPullLimit。
  新規操作はStage解放を検証するが、再開は回数の解放でブロックしない。新しい基本PULLを追加しない。

`normalPullQueue: { base: number; chain: number }`は未実行数で、合計は`pendingNormalPulls`と常に一致する。
CHAIN群が空になるまで次のbaseを処理せず、新たなCHAINは群の末尾に3件追加する。
個々のPULLは同種・未抽選なので、FIFOを個数で表現でき、CHAINの深さに比例した配列や再帰は不要。
ボス遷移でも両カウンターを保持する。すべて安全な非負整数で、合計不一致・上限超過はRangeError。
既存保存機能は未実装のため、旧キュー形式からの移行コードはまだ設けない。

H2取得はH1の後、共鳴判定前。SSRで最大3まで+1し、各共鳴で最大1個を消費して×1.5。
BOOSTは共鳴時に全消費して(1+0.25×個数)を乗算し、THUNDER/FLAME/触媒倍率も乗算する。
共鳴後、基本ゲージ+1、CHARGEならさらに+5、BOOSTなら最大3まで+1、CHAINなら残数+3。
`catalyst-gained`は実際の取得数（上限時0）、`resonance`は使用時のみcatalystConsumed/boostConsumedを持つ。
`additional-effect`はapplied（NONEのみfalse）と実際の追加量amount（NONEでは省略）を返す。
CHARGEは別途source: chargeのgauge-gainedも返す。SPECIALは自動実行しない。

一括返却は最終stateと固定サイズsummaryのみ。summaryはこの呼び出し中の実PULL・CHAIN追加・残数・SSR、
種類別共鳴/追加効果、JACKPOT発動数、進行Stage数、獲得RSを持つ。各実PULLのイベントは集計後に捨てる。
分割したsummaryの数値カウンターは残数を除き加算可能で、最終残数は最後のsummaryを使う。clearedGameは論理ORで結合する。
100,000上限は全効果・討伐遷移が完了したPULL境界で判定する。入力は変更せず、空キューの再開だけは同一state参照を返す。
呼び出し側は入出力を不変スナップショットとして扱う（finishBossDefeatと同じ契約）。
途中の例外では部分stateを返さず入力を維持するが、消費済みRNGは巻き戻せない。
状態のJSON往復と同じRNGの続きを渡した再開は、一度に処理した場合と一致する。
永続化とRNG状態保存はPhase 8で扱う。ゲームの公開乱数に暗号学的保証は要求しない。

### Phase 4の公開API・SPECIAL予約とJACKPOT（Issue #9）

| API | 入力 → 出力 / 責務 |
| --- | --- |
| special.drawSpecialPull | RandomSource → SpecialResult。STRIKE/BURST/MEGA_BURST、独立1乱数 |
| special.calculateSpecialDamage | A、SpecialResult、SPECIAL POWER Lv、任意SPECIALボス倍率（既定1） → 丸めないダメージ |
| special.calculateSpecialMaxCount | 非負安全整数ゲージ → floor(gauge/30) |
| jackpot.resolveJackpot | 区間、元Stage、rarity、A → 新区間、区間完了/当選フラグ、SSR数、独立ダメージ、ゲージ増分 |
| engine.executeSpecialPull | GameState、RNG → CombatResult。1実SPECIALだけ進め、予約があれば1件消費 |
| engine.executeSpecialPulls | GameState、1 または 'MAX'、RNG、任意limit → SpecialPullBatchResult。新規手動操作 |
| engine.resumePendingSpecialPulls | GameState、RNG、任意limit → SpecialPullBatchResult。確定済み残数だけ再開 |

SPECIALも低レベル実PULLとユーザー操作全体を分離する。UIはexecuteSpecialPullsを使用し、
保留時は対応するresume APIを使う。いずれのキューが保留中でも新しいNORMAL/SPECIAL操作は拒否する。
実NORMAL/再開NORMALはSPECIAL保留中に拒否し、実SPECIAL/再開SPECIALはNORMAL保留中に拒否する。

×MAXは開始時のfloor(specialGauge/30)をpendingSpecialPullsへ固定し、各SPECIALで30ゲージと残数1を消費する。
残数は安全整数かつfloor(現在ゲージ/30)以下、NORMALキューとの同時保有不可。
再開はゲージから再計算せず予約だけ実行する。limitは整数1〜100,000、既定はCORE_RULES.operationPullLimit。
ゲージ不足の新規操作はRNG0回・状態非破壊でRangeError。空キューの再開は入力参照を返す。
入力検証後にSPECIAL抽選を1回行い、特殊チャネルダメージを適用し、最後に共通finishBossDefeatを呼ぶ。
全ネスト状態をコピーする処理はNORMAL/SPECIALで共用する。例外時は入力を変更せず、RNGは巻き戻さない。
Phase 5では元StageのSPECIAL倍率を接続済み。SPECIALで通常効果の寿命や共鳴・JACKPOTは進めない。

SPECIALのイベント順はspecial-pull → gauge-spent → special-damage → 必要ならboss-defeated / 初回Stage50撃破時game-cleared / stage-started。
SpecialPullBatchResult.summaryは呼び出し内のactualPulls、pendingPulls、gaugeSpent、stagesAdvanced、earnedShards、
結果種別resultCountsとclearedGameを持つ。イベント全文を保持せず、数値カウンターは残数以外を加算、clearedGameはORで結合する。

JACKPOT区間は元StageがUNLOCK_STAGES.jackpot（20）以上の実NORMALだけで進める。
Stage19討伐PULLは除外し、Stage20最初のPULLから開始する。Stage20前の非ゼロ区間はRangeError。
100件目のSSRを含めて3個以上ならA×180とゲージ+30、当選/未達とも区間をゼロへ戻す。
SPECIAL・討伐・操作終了では区間をリセットしない。CHAINと分割再開も同じ100件区間を使う。
追加効果後・討伐確定前に判定し、HP<=0でも元Stageに対して全処理を終える。
jackpot-windowイベントは区間完了時だけ発行し、元Stage、SSR数、triggered、damage、gaugeGainを持つ。
当選ならsource: jackpotのgauge-gainedも発行し、statistics.jackpotCountとNORMAL summary.jackpotCountを更新する。
JACKPOTは独立チャネルで通常/共鳴/SPECIAL倍率を適用しない。追加のRNGや自動PULLは発生させない。
Phase 4でJACKPOTのStage20開始を先行実装し、その他の解放はPhase 5で接続済み。SPECIAL予約とRNGの永続化はPhase 8。

### Phase 5の公開API・補正と進行（Issue #11）

| API | 入力 → 出力 / 契約 |
| --- | --- |
| boss.getBossInfo | 正整数Stage → 読み取り専用BossInfo。名前、特性説明、属性別NORMAL倍率、種類別共鳴倍率、SPECIAL倍率、OVERLOAD獲得量。呼び出しごとにデータを分離 |
| progression.isFeatureUnlocked | highestStage、Feature → 解放可否。NORMAL_1/10/100/1000、SPECIAL_1/MAX、FOCUS、JACKPOT |
| progression.isUpgradeUnlocked | highestStage、Upgrade → 購入機能の解放可否。支払い・購入は行わない |
| progression.setFocus | GameState、Focus → 新しいルート状態。未解放はBALANCEDのみ、保留キュー中は全変更を拒否 |
| progression.hasClearedGame | highestStage → Stage50撃破済み（>=51）かどうか |

getBossInfoはsrc/data/bosses.tsの因子を乗算してチャネル別補正を取得する。Stage 35/40の複合を維持し、非特殊Stageと51以降は倍率1/OVERLOAD+12。
engineは元StageのNORMAL/SPECIAL倍率を既存calculate*Damageへ渡す。resolveResonancesの末尾に任意stage（既定1）を追加し、種類別倍率とOVERLOAD獲得量を選択する。
既存のFLAME/THUNDER/CATALYST/BOOSTとボス倍率は乗算。OVERLOADイベントも元Stageの実増分12/24を返す。JACKPOTはボス補正を参照しない。

新規executeNormalPulls/executeSpecialPullsはhighestStageで解放を検証し、未解放ならRNG0回・入力非破壊のRangeError。
回数ガードは新規操作境界に限定し、resume APIは予約済み分を続行する。低レベルexecuteNormalPull/executeSpecialPullは1実PULL用。
Focusが未解放で非BALANCEDの不正stateは両戦闘入力で拒否する。setFocusは両キューが空の場合のみ許可する。
setFocusの未変更ネスト値は入力と共有するため、入出力は不変スナップショットとして扱う。直接変更が必要ならコピーする。
解放閾値はUNLOCK_STAGES/UPGRADE_RULES、クリアStageはrules.tsのGAME_CLEAR_STAGEを参照する。

finishBossDefeatは初回Stage50撃破でboss-defeated → game-cleared → stage-started(51)を返す。highestStage>=51から達成状態を導出し、重複フラグを追加しない。
NORMAL/SPECIALの固定サイズsummary.clearedGameはこの呼び出しでの通知発生を示す。複数チャンクはORで集計する。
達成済みの状態をUIで復元する際はhasClearedGameを使う。Stage51以降も同じHP/RS式と数値安全ガードを維持する。
討伐リセット契約・FIFO・RNG消費・操作排他・100,000上限・予約保持は変えない。残りPULLは次Stageの補正で処理する。
クリア画面と保存は後続フェーズ。強化購入はPhase 6で実装済み（下記）。

### Phase 6の公開API・価格と台帳（Issue #13）

| API | 入力 → 出力 / 契約 |
| --- | --- |
| upgrades.calculateUpgradeCost | Upgrade、現在Lv → `ceil(baseCost × costGrowth^Lv)`の正安全整数。過大価格・不正Lv・未知の強化はRangeError |
| upgrades.getUpgradeInfo | GameState、Upgrade → 読み取り専用UpgradeInfo。upgrade、level、nextCost、unlocked、resonanceShards、spentShards、canPurchase、purchaseBlockReason |
| upgrades.purchaseUpgrade | GameState、Upgrade → RS控除・1Lv加算・対象台帳加算を原子的に適用したGameState |
| upgrades.respecUpgrades | GameState → 全実支払額を返還し、全Lv/台帳を0にしたGameState |

設定は既存UPGRADE_RULES、解放はprogression.isUpgradeUnlockedを再利用する。すべて純粋関数でRNG・React・ストレージ非依存。
価格計算は指数演算1回、状態検証とRESPECは固定3種類の走査のみ。Lvに比例する再計算・配列確保は行わない。
getUpgradeInfoは両キューを含む所有ドメインを検証し、不正stateはRangeError。
妥当なstateの購入不可理由はPENDING_PULLS → LOCKED → NUMERIC_LIMIT → INSUFFICIENT_RSの優先順。購入可能時はnull。
次価格が表現範囲外ならnextCost=null。購入は拒否し、妥当な台帳からのRESPECは引き続き可能。
この読み取りAPIをUIの表示・ボタン状態に使い、実操作でも必ずpurchaseUpgradeで再検証する。

購入は対象だけLv+1、spentShardsに今回価格を加算し、同額を共通RSから控除する。
RESPECはspentShards合計を返還し、全3種のLv・台帳をゼロへ。価格履歴から返還額を逆算しない。
RS・Lv・台帳・合計は安全整数で検証する。Lv0/支払非0、支払額<baseCost×Lv、未解放の正Lvを拒否する。
下限以上の台帳を信頼し、現在価格による累積支払額との一致は要求しない。保有RS＋全台帳も安全範囲内に保ち、返還不能な状態を拒否する。
検証対象はこのモジュールの資源・Lv・台帳・Stage/最高Stage・キュー。GameState型を前提とし、保存JSON全スキーマの検証や履歴の真正性の証明は行わない。
戦闘単体APIには台帳検証を追加しないため、既存のLv注入による戦闘計算テストは維持できる。

保留NORMAL（CHAIN含む）/SPECIALがある間は購入・RESPEC不可。完了後のみLvを変えられ、分割再開の等価性を維持する。
失敗時に入力を変更せず、部分更新を返さない。成功時は新しいルート・upgradeLevels・spentShardsを返す。
未変更のstacks/temporary/jackpot/statistics/normalPullQueue等は構造共有する不変スナップショット契約。
呼び出し側が直接編集する場合はstructuredClone等で分離する。この契約と更新対象レコードの分離はテスト済み。
戦闘エンジンは各PULLで既存upgradeLevelsを読むため、エンジン側の変更や重複した倍率状態は不要。
購入後・RESPEC後のNORMAL/共鳴/SPECIAL/JACKPOT火力、特殊ボス倍率、既存バフ・統計・戦闘RS保持を統合テストで確認する。
Phase 7-Bで手動購入とRESPEC確認UIを接続済み。保存入口の厳密な台帳検証はPhase 8-Aで実装済み。台帳を自動修復しない。×MAX/自動購入は対象外。

## 乱数とテスト

RandomSourceは[0,1)を返す注入関数。通常利用は境界でMath.randomを渡す。
src/test/random.tsに固定列（枯渇時は例外）とMulberry32の固定シードRNGを実装済み。
固定シードは0x12345678（テスト名にも記載）。seed 1の既知出力でもアルゴリズムを固定する。
これらはテスト専用で本番の抽選APIには含めない。
確率閾値の直前/一致/直後、合計100%、独立抽選の消費順を検証する。
同じ固定乱数列で×1反復と×10/100/1000の最終状態・イベント集計を比較する。
確率分布の統計テストを使う場合は固定種・許容範囲を明示し、ランダムなCI失敗を避ける。
シミュレーションの中央値は手動SPECIALの絶対期待値にしない。

## 保存形式・検証（Phase 8-A / Issue #23、実装済み）

`SaveDataV1 = { saveVersion: 1, state: GameState, settings: { reducedEffects: boolean }, rng: { algorithm: 'mulberry32-v1', state: number } }`。
全GameStateを保持する。GameStateの意味・確率・計算式・抽選順は変更しない。
RNGのstateは0〜2^32−1の整数で「次の乱数を生成する直前」の内部状態。初期seedだけを保存する方式ではない。
アルゴリズム名には版を含め、将来の変更は新識別子と明示的な対応を必要とする。暗号学的用途には使わない。

公開API:

- `validateSaveData(input: unknown): SaveDataV1`：構造と意味論を検証し、全ネストを分離したコピーを返す。
- `serializeSaveData(data: SaveDataV1): string`：書出し前にも同じ検証を行う。
- `deserializeSaveData(json: string): SaveDataV1`：容量確認、JSON.parse、unknownから完全検証。
- `nextRandom(checkpoint)`：入力を変更せず`{ value, checkpoint }`を返す純粋な1ステップ。
- `createCheckpointRandom(checkpoint)`：既存RandomSource互換の`random`関数と、独立コピーを返す`getCheckpoint`を持つ決定的アダプター。

JSONは65,536 UTF-16コード単位以下（文字列本体は最大128 KiB相当）。通常2 KiB未満の固定形式に十分な余裕を設け、パース前に上限を確認する。
必須キーの省略、未知キー、配列/null/型違い、文字列数値、独自プロトタイプ、アクセサー、symbol・非列挙キーを拒否する。
固定スキーマだけを再構築し、未知のプロパティをコピーしない。自動修復・補完・旧版への架空の移行はない。
SaveDataError.codeはSYNTAX（構文）、SIZE（上限）、VERSION（未対応保存版）、SCHEMA（構造）、STATE（値域・相互矛盾）。日本語messageを持つ。
未知のRNG識別子はSTATEとして拒否する。失敗時は入力不変・部分復元なし・RNG消費なし。

検証は既存validation/progression/boss/upgradesと設定値を再利用する。
Stage/最高StageのHP式が安全に計算可能で、最高Stage>=現在Stage、0<HP<=最大HPを要求する。小数HPを丸めない。
スタック・触媒・一時効果、Focus解放、非負安全整数の資源/Lv/統計、JACKPOT窓、両キューの合計・排他・SPECIAL予約に必要なゲージを確認する。
SSR<=NORMAL数、触媒<=SSR、JACKPOTに必要な100PULL/SSR3件と現在窓の非重複、最高Stageに必要な討伐数、討伐数<=両PULL総数、
共鳴数<=最大獲得スタック数/6も確認する。履歴そのものを完全再構築・認証するものではない。

保存入口の台帳は各強化について`sum(calculateUpgradeCost(upgrade, L), L=0..Lv-1)`と完全一致が必須。
各Lvのceilを合計し、合計後に丸めない。未解放Lv、Lv0の支払、合計・全額返還後RSの安全整数超過を拒否する。
価格/累積価格を毎回検証し、現行指数価格は110Lv未満で安全整数限界に到達するため、巨大Lvでも無制限ループにならない。
ゲーム内部の既存台帳下限検証は維持し、保存入口だけ厳格にする。台帳を推定修復しない。
将来価格を変更する際は旧価格履歴の扱いと保存版/移行を別途設計する。既存v1台帳を新価格で無断再計算しない。
クライアントだけの検証は完全な改ざん耐性や購入履歴の真正性を保証しない。

### Phase 8-B / 8-Cへの必須契約（未実装）

8-Bでブラウザseed生成とControllerへの可保存RNG接続を行う。現時点のMath.randomは差し替えていない。
**最後に成功したチャンクのGameStateとRNG状態を同じ確定境界で対として取得・保存する。**
現行Controllerは失敗チャンクをコミットしないが消費済みRNGは巻き戻さない。
したがって8-Bでは最後の成功境界のRNGチェックポイントを別途保持し、未コミット失敗チャンク後のlive RNGと以前のGameStateを組み合わせて保存しない。
liveでの例外後再開と、最後の成功チェックポイントを再読込した再開は一致保証の対象外。無失敗の中断・復元は同じ乱数列・結果を維持する。
NORMAL/CHAIN残数・SPECIALの確定済み残回数をそのまま復元し、新規操作の回数として再計算しない。再開は手動操作とする。
settings.reducedEffectsのみ永続化し、スキップ対象id・busy・summary・highlight・通知は保存しない。
復元直後に過去ハイライトやStage50初回演出を発行しない。達成表示はhighestStageから導出し、再開後の新規確定分だけ通知する。

## ブラウザのセーブ・ロード（Phase 8-B / 8-C、未実装）

saveVersion: 1を持つJSONをlocalStorageに保存。キー案はgacha-raid-resonance:save。
ブラウザAPIはstorageに閉じ込め、シリアライズ・検証・移行は純粋関数にする。
JSON.parseの結果はunknownとして受け取り、型アサーションだけで信用しない。
Stage整数、有限HP、スタック0〜12、CATALYST/BOOST0〜3、非負整数RS・Lv・カウンター、
JACKPOT区間0〜99、既知の属性/フォーカス、設定、未消化キューの整合性を検証する。
Stage 50以降は第17章の継続プレイ規則を反映する。GAUGEのゲーム上の上限は設けず、既存の安全数値境界とキュー/解放/クリア状態の整合性を保存検証へ反映する。
将来versionは上書きせずエラーを表示し、既知の旧versionのみ明示的に移行する。
破損時は読み込み失敗を通知し、初期化できる操作を提供する。破損データを無言で上書きしない。

状態更新後にデバウンス保存し、pagehide/visibilitychangeで確定状態をflushする。
離脱イベントだけに依存せず、巨大操作も安全なチャンク境界でチェックポイント保存する。
ストレージ容量超過や利用拒否は捕捉し、保存失敗をUIに表示する。
Exportは確定した版付きJSON、Importはパース・完全検証後に確認して置換する。
削除とRESPECも確認を必要とし、RESPECは支払済みRSを返却して台帳をゼロにする。
初期GameState生成と純粋codec/RNGは実装済み。ブラウザ保存・復元・Export/Import・削除UIは未実装。

## CIとGitHub Pages

Node.js 24、npmロックファイルを利用。CIはmainへのPRとmain pushで
npm ci → typecheck → lint → test → build。
Pages Workflowもデプロイ前に同じチェックを実行し、失敗したビルドを公開しない。
リポジトリSettings → Pages → Build and deploymentのSourceをGitHub Actionsに設定する。
初回のgithub-pages環境作成・保護設定やActions利用権限はリポジトリ管理側で確認する。
mainへのpushまたはmainを指定したworkflow_dispatchでdistをPagesに公開する。
作業ブランチからのデプロイはガードする。Workflowの整備と実際の公開成功は区別し、
公開状態はGitHub ActionsのDeploy GitHub Pages実行結果と公開URLで確認する。

Vite baseは/gacha-raid-resonance/。
公開先URL: https://mkunori.github.io/gacha-raid-resonance/
ルーターは導入せず単一エントリーとし、このURLでのリロードを想定する。
初期基盤のマージ後に公開とアセット取得を確認し、ゲーム完成時にもスマホ/PCの操作とリロードを再確認する。

## 将来の非同期協力

入力状態・アクション・RNG→状態・イベントという境界を維持すれば、
ゲームコアと設定をサーバー側でも利用できる。将来は抽選・報酬確定をサーバーで行い、
UIはアクション送信と返却イベント表示を担当する。
通信アダプターとローカル保存を差し替え可能にするが、現在は通信・認証・DB・同期を作らない。
サーバー権威、冪等な操作ID、不正対策、共有ボスへの競合処理は協力プレイ着手時の別設計とする。
