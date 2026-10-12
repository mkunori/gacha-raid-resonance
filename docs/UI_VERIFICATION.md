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

時間・フレーム数は環境依存の参考値であり性能保証ではない。実機スマートフォンのタッチ操作や総合UX・高負荷測定は7-Dで扱う。
Pages本番への画面反映はPRマージ後のデプロイで確認する。
