# GACHA RAID: RESONANCE

無料・無制限のガチャがボスへの攻撃になる、ソロ向けブラウザゲームです。
炎・風・雷の共鳴と、ボス撃破で獲得するRESONANCE SHARD（RS）による強化を予定しています。

## 開発状況と主な予定機能

現在はタイトルと開発中案内のみ表示します。ゲーム機能は未実装です。
NORMAL PULL、手動SPECIAL PULL、CHAIN/BOOST/JACKPOT、Stage 1〜50、
特殊ボス、強化・RESPEC、localStorage保存・JSON Export/Import・統計を今後追加します。
PC・スマートフォン対応の静的Webアプリです。サーバー・認証は使用しません。

## 採用技術

TypeScript / React / Vite / CSS / Vitest / ESLint / GitHub Actions / GitHub Pages。
Node.js 24（[.node-version](.node-version)）とnpmを使用します。

## ローカル開発

```sh
git clone https://github.com/mkunori/gacha-raid-resonance.git
cd gacha-raid-resonance
npm install
npm run dev
```

表示されたURLの /gacha-raid-resonance/ を開きます
（通常 http://localhost:5173/gacha-raid-resonance/）。
Windows PowerShellでnpm.ps1の実行が制限される場合はnpm.cmdを使用できます。

## テスト・ビルド

```sh
npm run typecheck
npm run lint
npm test
npm run build
npm run preview
```

監視テストはnpm run test:watch。本番出力はdist/です。
CIとクリーンインストールではpackage-lock.jsonに基づくnpm ciを使用します。
現時点のVitestは確率データの妥当性を検証します。ゲーム処理のテストは後続PRで追加します。

## GitHub Pages

公開予定: [GACHA RAID: RESONANCE](https://mkunori.github.io/gacha-raid-resonance/)（この基盤PRでは未公開）。
Vite baseは /gacha-raid-resonance/ です。
リポジトリSettings → Pages → SourceをGitHub Actionsに設定してください。
mainへのpushで検証後にdistをデプロイし、mainでの手動実行にも対応します。
作業ブランチからはデプロイしません。今回PRはマージしません。

## 仕様と開発方針

- [親Issue #1：v0.6仕様](https://github.com/mkunori/gacha-raid-resonance/issues/1)
- [ゲーム仕様書（原文全文・確認事項）](docs/GAME_SPEC.md)
- [技術設計](docs/TECHNICAL_DESIGN.md)
- [実装計画・子タスク案](docs/IMPLEMENTATION_PLAN.md)

親IssueとGAME_SPECを開発基準とし、仕様・実装・テストの整合性を各PRで保ちます。
数値や計算式は独断で変更せず、仮定や確認事項を明示します。
次は通常ガチャ・属性・レアリティ抽選から、小さなPRに分けて実装します。
