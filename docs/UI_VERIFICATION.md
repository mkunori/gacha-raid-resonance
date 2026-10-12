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
