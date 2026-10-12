# Phase 7-A 画面確認（Issue #15）

## 再現手順

ゲームの実行依存にはブラウザ検証ツールを追加しない。任意のローカル確認用として、無視対象のnode_modules配下にPlaywrightを準備する。

```powershell
npm.cmd ci
npm.cmd install --prefix node_modules/.browser-check --no-save --package-lock=false playwright
npm.cmd run dev -- --host 127.0.0.1
# 別ターミナル。インストール済みブラウザを指定（以下はWindows Edgeの例）。
$env:BROWSER_EXECUTABLE_PATH = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
node scripts/verify-battle-ui.mjs
```

他のChromium系ブラウザも実行ファイルを指定可能。スクリプトはローカル開発サーバー専用で、製品状態や保存機能を追加しない。
初期状態のUI確認後、検証専用の別Reactルートに初期Stage1・highestStage50の状態と固定RNGを注入して未解放回数の長時間到達操作を省略する。
実アプリにテスト用クエリやチート操作は追加しない。スクリーンショットはnode_modules/.browser-checkへ出力する。

## 確認結果（2026-10-12）

- Windows / Edgeヘッドレス、幅320・375・1280px、高さ900pxで確認。各幅でdocument.scrollWidthとviewport幅が一致し横スクロールなし。
- 初期Stage1でNORMAL×1/10を実行し、HP・属性・ゲージ・集計が更新された。再読込による初期化と保存なしの注意書きを確認。
- TabでNORMAL×1へフォーカスしEnterで実行。ボタン高さは最小約68px、フォーカスリング・属性名・HP数値とARIA情報あり。
- NORMAL×100/×1000・SPECIAL×MAXの解放前/後、ゲージ不足、全6操作、失敗後の保留再開はjsdom + 実コアの自動テストでも検証。
- 1000連（固定RNG、上記検証用状態）＋CHAINは1,042実PULL、約194ms、描画フレーム28回、ストア通知13回、summary JSON 301 bytes、エラーなし。
- SPECIAL×MAXも画面から実行。ブラウザのpageerrorは0件。
- React Profilerテストで1000連のコミット数が16以下であることを確認。固定サイズ集計のみを保持し全イベント配列をUIへ蓄積しない。
- 最終レビューでUI自動実行を累積10,000実PULLに制限。固定RNGで10,000件連続CHAINを発生させ、正常な一時停止・残予約・RNG継続・再開ごとの上限・完了までの集計一致を検証。大量SPECIALの固定予約も同じ上限で保持する。

時間・フレーム数は環境依存の参考値であり性能保証ではない。実機スマートフォンのタッチ操作や総合UX・高負荷測定は7-Dで扱う。
Pages本番の画面と動作はmainのデプロイ後に公開URLで確認する。

## Phase 7-B 画面確認（Issue #17 / 2026-10-12）

同じ準備・開発サーバーで`node scripts/verify-progression-ui.mjs`を実行する。
初期Stage1のRS不足・未解放Focusを確認した後、別の検証用ReactルートへStage8・RS1000・固定RNGを注入して操作する。製品の初期状態やゲームルールは変更しない。

- Edgeヘッドレスの320/375/1280px幅で購入・価格更新・全4Focus・RESPECの確認/取消/確定を確認。横スクロールなし。
- PULL POWERのダブルクリックでも1Lvだけ購入し、他2強化の購入後は合計支払84 RS、確定RESPECでRS1000へ復帰。
- native dialogの:modal状態、初期キャンセル選択、Tab/Shift+Tab循環、Esc取消と元ボタンへのフォーカス復帰を確認。確定後に元ボタンが無効なら強化見出しへフォーカスを戻す。
- ラジオ選択・矢印キー、現在Focusと表示確率の一致、初期BALANCED固定を確認。画面上に保存なしの注意書きを維持。
- pageerror 0件。既存verify-battle-ui.mjsも再実行し、3画面幅のNORMAL×1/×10、1000連＋CHAIN、SPECIAL×MAXが成功。
- 既存1000連の参考測定は1,042実PULL・約196ms・描画27フレーム・ストア通知13回・summary JSON 301 bytes。育成UI追加後も集計は有限サイズ。
- 実機タッチの総合評価・長時間負荷は7-D、保存はPhase 8。本番への反映はmainのPagesデプロイで行い、公開画面はデプロイ後に確認する。

## Phase 7-C 画面確認（Issue #19 / 2026-10-12）

同じローカル準備・開発サーバー・Edge実行ファイル指定で`node scripts/verify-effects-ui.mjs`を実行する。
製品の初期状態を確認後、別の検証用StrictModeルートへStage20・最高Stage50・固定RNG・JACKPOT直前区間を注入する。
Stage50初回クリアの確認には別Controller（HP1）を使用する。製品にチート・URLパラメーター・保存は追加しない。

- Edgeヘッドレス、幅320/375/1280px・高さ900pxでSSR/共鳴/JACKPOTの実コア集計表示、累積NORMAL数、SPECIAL MEGA_BURSTを確認。
- 軽減ON/OFF、OS reduced-motion、スキップでanimationNameがnoneとなり、Controllerのsnapshotが一切変化しないことを確認。重要テキストは維持。
- Stage50初回クリアバナーと51以降の継続を確認し、次操作では初回演出を再表示しない。
- 横スクロールなし、pageerror 0件。スクリーンショットは無視対象node_modules/.browser-checkのeffects/clear-{width}.pngへ出力。
- 10,000実PULL停止/再開の通知増分、巨大SPECIAL予約、失敗チャンク除外、StrictMode・アンマウントはVitestで検証。
- 既存のverify-battle-ui.mjsとverify-progression-ui.mjsも3幅すべてで再成功。1000連＋CHAINは1,042実PULL・約197ms・28フレーム・通知13回・summary JSON 301 bytes（環境依存の参考値）。375pxのハイライト/累積統計スクリーンショットも目視確認。
- npm ci/typecheck/lint/test/build成功。既存915件＋追加29件＝944件、19テストファイル成功。実機タッチ・長時間/総合UXは7-D、永続化はPhase 8に残す。
- 最終レビューで最初のチャンク失敗時のテストを1件追加。以前のバナー参照/idを維持して再通知せず、「直近の確定結果」であり失敗操作の結果ではない旨を表示する。
- 最終レビュー後は945件成功。指定5コマンドと上記3スクリプトを再実行し、全3幅で成功・pageerror 0件を確認。

## Phase 7-D 統合UX・性能確認（Issue #21 / 2026-10-12）

### 環境と再現手順

Windows 11 Home 10.0.26300、AMD Ryzen 7 7840HS、Edge 155.0.4283.45ヘッドレス、Node 24.21.0。
ローカルVite開発ビルド・React StrictMode、viewport高さ900px・deviceScaleFactor 1。
**実機Android/iOSは未検証**。PlaywrightのhasTouch/isMobileとtap、モバイルviewportで代替した。物理的な親指操作・Safari固有挙動の保証ではない。

既存の準備手順に続けて次を実行する。検証ツール/スクリーンショット/JSONは無視対象node_modules配下に置く。

```powershell
# 同じViteサーバーとBROWSER_EXECUTABLE_PATHを使用
node scripts/verify-battle-ui.mjs
node scripts/verify-progression-ui.mjs
node scripts/verify-effects-ui.mjs
$env:UI_TOUCH = '1'
$env:UI_WIDTHS = '280,320,375,390,768,1280'
node scripts/verify-progression-ui.mjs
node scripts/verify-ux-performance.mjs
# 修正前の比較を採る場合のみ、変更前のUIに対して実行する
$env:UX_BASELINE = '1'
node scripts/verify-ux-performance.mjs
```

UX_BASELINEは文字拡大・小さいタップ領域・戻りリンク不足を記録する比較モード。製品のフラグではない。
通常検証ではこれらも合否を確認する。新しいシェルでは各環境変数を再設定する。
比較計測はmainの318200c（修正前）と本PRのCSS/表示変更後に同じスクリプト・固定RNGで行った。
開発サーバーを使用し、別Reactルートへ最高Stage50/RS10000等を注入する。製品にチート・検証用URL・保存を追加しない。

### 発見した問題と小規模修正

| 確認項目 | 修正前 | 修正後 |
| --- | --- | --- |
| 280/320px・文字200% | document.scrollWidth 365px。タイトルがはみ出す | h1にoverflow-wrapを追加し280/320pxに収まる |
| 演出軽減ラベルのタップ領域 | 高さ21px | ラベルをinline-flex・最小44pxに拡張。入力自体20px |
| 統計からPULLへの復帰 | モバイルで約4,700〜4,900pxの長いページを手動で戻る | ページ末尾に「PULLへ戻る」。見出しへフォーカスし、TabでNORMAL×1へ移動 |

280/320/375/390/768/1280pxすべてで通常表示とルート文字サイズ200%の横スクロールなし。
200%は文字拡大でありブラウザ全体ズームの実機試験ではない。ボタン最小高さ56px、ラベル最小44px、Focusラベルにも十分な領域あり。
native RESPECダイアログの幅は280px画面で242px、375pxで337px、768/1280pxで520px。左右の見切れなし。
全6幅でtapによる購入/全額返還/4Focus切替/連続NORMAL×1・×10/SPECIAL×1を確認。
ダブルクリックは1購入、Esc取消、Tab/Shift+Tab循環、取消後の元ボタン/確定後の見出しへのフォーカス復帰、矢印キー、Spaceによる演出軽減、disabled理由・HP数値/ARIAを確認した。
既存のSSR/共鳴/JACKPOT/MEGA_BURST/初回クリア/OS軽減/スキップ確認3スクリプトも再成功。画面例外0件。

### 固定RNG・負荷計測（参考値）

各実操作の期待GameState・boundary summaryを純粋なゲームコアで別RNGストリームから算出し、**毎回一致を検証**する。
NORMALは実PULL×3、SPECIALは実PULL×1のRNG消費を確認。操作開始後に別PULL・購入・RESPEC・Focusを競合させ全拒否を確認する。
操作時間に期待値計算とGC計測は含めない。msに固定閾値を設けず、描画機会・結果一致・固定サイズ集計を検証する。

| ケース | 修正前 | 修正後 | 状態・描画 |
| --- | --- | --- | --- |
| NORMAL×1000＋CHAIN | 196.4ms | 199.4ms | 1,042実PULL、Stage1→11、Reactコミット12、rAF27→28回、summary301 bytes |
| 長期CHAINの10,000件区間 | 1709〜1717ms | 1707〜1723ms | 10000/10000/10000/1件で停止・再開、最後Stage15、残数20001→10001→1→0、各大区間コミット101・rAF245〜248 |
| SPECIAL×MAX 20,001固定予約 | 各大区間1696〜1698ms | 1697〜1699ms | 10000/10000/1件、最後Stage25・残0、各大区間コミット101、summary209〜211 bytes |
| NORMAL×10を100操作 | 2382ms | 2405ms（途中GCを含む） | 1,042実PULL・Stage11・RS11036・通知境界100件・Reactコミット201（初期含む） |

1000連のストア通知は通常の既存スクリプトで13回。競合検証を含む新スクリプトでは拒否通知3回を加えて16回。
上記の差は測定誤差程度で、性能改善を目的とするエンジン/チャンク変更は行っていない。
ハイライトDOMは最大1件、履歴を蓄積しない。ライブ領域の結果idは操作/再開の境界ごとで、チャンクごとには増えない。

CDP Performance.getMetricsと強制GC後のJSHeapUsedSizeを記録した（ブラウザ全体RSSではない）。
修正後の100操作ケースは開始9,030,884 bytes、50操作9,230,928、100操作9,245,800。
DOM Nodesは797→850→847、JSEventListenersは340で一定。初回描画/JIT/React/Viteを含み、開始との差だけをリークとは判定しない。
この範囲では操作回数に比例したDOM/リスナー増殖は見られず、各操作後に追跡したsetTimeoutは0件。
終了後は計測用を含むController購読0件・setTimeout0件。Reactルートを破棄しJS heapは8,777,876 bytesへ低下した。
CDPにはViteやReactのリスナー/DOMも含まれ、アンマウント後の値が0になることを要求しない。

### 自動テストと未検証事項

既存945件を維持し、100操作で購入・RESPEC・Focus・NORMAL/SPECIALを組み合わせコア状態/台帳/統計/RNG/最新ハイライトを毎回比較する統合テストと、
StrictModeの20回mount/start/unmountでタイマー0・RNG0・状態保持を検証するテストを追加。
既存の失敗チャンク/保留再開/10,000上限/古い参照拒否のテストも維持する。
最終結果は20ファイル・947件成功（既存945＋追加2）。npm ci/typecheck/lint/test/buildすべて成功。

実機タッチ、iOS/Safari、スクリーンリーダーの実音声読み上げ、低速端末/電池/バックグラウンドタブ、数時間のヒープ推移は未検証。
100操作と決定的高負荷は長時間相当の回帰確認であり、30分実プレイのバランス計測やメモリリーク不存在の保証ではない。
Phase 8へ保存スキーマ/台帳検証・RNG/予約復元、reducedEffectsの永続化、復元時のクリア/過去ハイライト再通知防止を引き継ぐ。

PR #22最終レビューでも指定5コマンド・947件が成功。4ブラウザスクリプトと6幅のタッチ検証を再実行した。
追加で文字200%時の全数値（dd）・ボタンの内容幅、ダイアログの横スクロール/画面内配置、確認ボタンへスクロール可能なことを検査し、全6幅で成功した。
検査手順と引き継ぎ文書のみを補足し、製品コードの追加修正は行っていない。

## Phase 8-B：自動保存・復元（Issue #24）

### 実装と検証環境

Windows、Node.js 24.21.0、npm 11.19.0、Microsoft Edge 155.0.4283.45を使用。Playwrightから実ブラウザを起動し、開発サーバーの `/gacha-raid-resonance/` を検証した。320px・375px・1280pxのビューポートを使用。実機スマートフォン・iOS/Safariは未検証。

`BROWSER_EXECUTABLE_PATH` をEdge実行ファイルへ設定し、既存と同じ任意インストールのPlaywright環境で `node scripts/verify-save-ui.mjs` を実行できる。必要に応じて `BATTLE_UI_URL` を指定する。このスクリプトの保存消去・初期状態注入は隔離した検証用ブラウザ内のみで行い、製品に削除・復旧UIや検証用URLを追加していない。

### 保存・再読込の確認結果

- 3画面幅でNORMAL操作→保存→再読込後のGameState・RNG一致を確認。横スクロールなし。
- NORMALでRS獲得→PULL POWERを1Lv購入→再読込後のLv・支払台帳・RSを確認。RESPEC→再読込後はLv0と正確な全額返還を確認。
- Stage 6以降のFocus変更と演出軽減ONが再読込後も維持された。保存復元直後に過去のPULL結果・ハイライトは表示されない。
- NORMAL基本・CHAIN予約、SPECIAL ×MAXの固定予約を含む状態を復元。10,000実PULLで一時停止→保存→再読込→手動再開した最終状態とRNGが、同じ初期状態からの純粋なゲームコアの参照計算と一致した。自動再開・SPECIAL予約の再計算なし。
- 1000連の実行途中に再読込しても最後に保存された境界の予約を復元し、手動再開できた。再読込のタイミングにより残数は変わる（今回の実測99）。保存後の未保存分は再実行されるが、復元したGameStateとRNGの組は一致する。
- 同一ブラウザの2タブで一方の保存変更を検出し、もう一方は警告を表示して自動保存を停止した。保存直前にも元の文字列との一致を確認する。localStorageには比較交換操作がないため、完全同時書込みの排他・自動マージは保証しない。
- ページ例外0件。既存の `verify-battle-ui.mjs`、`verify-progression-ui.mjs`、`verify-effects-ui.mjs` も3画面幅で再成功。保存機能により検証間の状態が混ざらないよう、既存スクリプトは検証専用コンテキストを初期化する。

### 保存境界・エラーの自動テスト

成功チャンクのGameStateとRNG checkpointを同じ同期境界で固定し、保存処理は固定した組だけを参照する。失敗チャンクでは実行用RNGを巻き戻さず、保存用checkpointは前の成功境界を維持する。強化・RESPEC・Focus・表示設定変更でも失敗後の実行用RNGを誤って保存しない。

デバウンス500ms、連続更新中も最大待ち2秒。pagehide・非表示・アンマウントでも最新確定状態の保存を試みる。保存完了前には保存済みと表示しない。破損JSON・未来版・不正状態は元データを保持して保存停止。容量不足・ストレージ拒否では画面の進行を保持し、失敗を通知する。次の確定更新・離脱時に保存を再試行する。

これらをfake timer・例外注入・StrictMode・アンマウント・別タブのstorageイベントで検証した。保留キュー・10,000上限・SPECIAL固定予約のJSON往復と再開一致、クリア済み状態の達成表示と演出非再発行も自動テスト対象。容量不足・ブラウザのプライバシー設定による実際の拒否は実ブラウザでは未再現であり、アダプターへの例外注入で検証している。新規31件、総1,203件（23ファイル）が成功し、npm ci/typecheck/lint/buildも成功した。

### 参考性能値とPhase 8-Cへの引き継ぎ

保存を接続したNORMAL ×1000＋CHAINは1,111実PULL、約254ms、requestAnimationFrame 36回、保存1回。NORMALの10,000実PULL停止・再読込・再開は約2,155ms、SPECIALは約2,016msで、停止までの保存は各1回。いずれもブラウザ操作・状態取得を含む参考値であり、固定ミリ秒をCIの合否に使用しない。保存は最新checkpointだけを保持し、タイマーはデバウンス・最大待ち各1本。既存の100実PULLチャンク、10,000実PULL自動実行上限、固定サイズのsummaryを変更していない。

Phase 8-CへExport/Import・削除・復旧UI、破損データやタブ競合からの明示的な復旧導線を引き継ぐ。復元時に過去のハイライトやクリア演出を再通知しない契約を維持する。実機・Safari・長時間バックグラウンド時の保存挙動は追加検証が必要。ページ離脱イベントはブラウザやOSにより発火しない場合があり、直近の未保存分の完全な保全を保証しない。

### PR #26 最終レビュー

保存失敗後に新たなPULLが確定した場合も、再試行では失敗当時のcheckpointではなく最新のstate/RNGの組を保存することを、容量超過・権限拒否の既存テストへ追加した。本番コード・ゲームコアの変更なし。
Edgeでsave/battle/progression/effectsの4スクリプトを320/375/1280pxで再実行し、すべて成功した。NORMAL/SPECIALの10,000停止→復元→手動再開の一致、実行途中の再読込、別タブ保存停止も再確認。参考値は1,111実PULLが251ms・rAF36回・保存1回、10,000停止/再読込/再開がNORMAL2,124ms・SPECIAL2,006ms。実機未検証の制限は前述のとおり。
Phase 8-CではImport前の検証/確認とstate/RNG/settingsの原子的置換に加え、旧checkpointの遅延保存とImport直後の自動保存の競合防止を扱う。

## Phase 8-C：セーブ管理（Issue #27）

### 環境・再現手順

Windows、Node.js 24.21.0、npm 11.19.0、Edge 155.0.4283.45のヘッドレス実ブラウザ。開発サーバーで幅320/375/1280px・高さ900pxを確認した。上記と同じPlaywright任意インストール環境とBROWSER_EXECUTABLE_PATHを使い、`node scripts/verify-save-management-ui.mjs` を実行する。

スクリプトは使い捨てブラウザコンテキストで実行し、通常の利用者の保存データを参照・削除しない。検証用fixtureは開発サーバーの純粋APIで生成し、製品へデバッグURLやチート操作を追加していない。スクリーンショットはnode_modules/.browser-check/manage-320.png、manage-375.png、manage-1280.pngへ出力した。

### 成功したブラウザ検証

- 3幅すべてで実ファイルのExport→削除確認→新規ゲーム→ファイル選択→Import確認→再読込→保留PULLの手動再開が成功。ダウンロードしたJSONがstate/RNG/settingsの確定checkpointと一致し、Import後も全値が一致する。
- NORMAL基本200＋CHAIN3、SPECIAL固定予約10をそれぞれ復元し、自動実行なしで再開。純粋なゲームコアの参照計算と最終GameState・RNGが一致した。
- 3強化Lv・実支払台帳・RS・Focus・演出軽減・累積統計・Stage51のクリア済み状態を保持し、過去ハイライトや初回クリア演出を再発行しない。
- 削除後はStage1・統計0・新しいRNG seedとなり、別キーは保持される。新規状態の自動保存も正常。
- Esc、取消、Tab/Shift+Tab循環、Enterによる確認開始/取消、元ボタンへのフォーカス復帰を確認。Import取消・削除取消では既存データ不変。3幅で横スクロールなし、ページ例外0件。
- 不正JSON・未来版・128 KiB超過は確認ダイアログを開かず拒否。容量不足をsetItemへの例外注入で再現し、元の保存rawを維持してエラー表示。
- 2タブで確認ダイアログ表示中に他タブが更新すると、確定は拒否され元データを保持する。破損rawは自動上書きされず、UNVERIFIED名のバックアップファイルが原文と一致し、確認付きImportで明示復旧できた。
- 既存verify-save-ui / battle-ui / progression-ui / effects-uiをすべて再実行して成功。10,000実PULL停止と復元/再開の契約も維持。参考値は1,111実PULLが252ms、rAF37回、保存1回。時間値はCI閾値にしない。

### 自動テスト・未検証事項

保存管理のI/Oと再読込を注入して、旧Autosaveの遅延タイマー・pagehide・cleanup・再connectが置換後に書戻さないことを検証する。置換I/O呼出しの最中にflushしても保存されず、書込/削除失敗時は元raw/画面/RNGを保持して通常保存へ戻る。確認中の通常Autosaveによるraw変更も再確認対象とする。
既存1,203件＋新規44件＝総1,247件（24ファイル）が成功。npm ci・typecheck・lint・test・buildはすべて成功した。

実機Android/iOS・Safari、公開ページへの反映、OSのダウンロード制限、実際の容量枯渇/プライバシー設定は未検証。容量/権限拒否は自動テストとブラウザへの例外注入で確認した。localStorageの読取→書込にはCASがなく、完全同時のタブ書込み排他は保証しない。確認時rawの照合とstorageイベントによる保護を維持する。

Phase 9へ公開版のファイル操作・実機/別ブラウザ・長時間実プレイの確認を引き継ぐ。抽選・倍率・価格・ゲームコアの変更、バランス調整は行っていない。
