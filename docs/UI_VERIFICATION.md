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
