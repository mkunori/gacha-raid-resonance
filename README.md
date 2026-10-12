# GACHA RAID: RESONANCE

無料・無制限のガチャがボスへの攻撃になる、ソロ向けブラウザゲームです。
炎・風・雷の共鳴と、ボス撃破で獲得するRESONANCE SHARD（RS）による強化を組み合わせるゲームです。

## 開発状況と主な予定機能

現在の画面はタイトルと開発中案内のみです。
UI非依存の通常ガチャ独立抽選・H1、基本ダメージ、3共鳴、単一PULL戦闘エンジン、
ボスHP・撃破RS・次Stage進行を実装済みです。FLAME/THUNDERの予約効果とOVERLOADのゲージ獲得に対応します。
戦闘画面への接続、H2、追加効果の発動は未実装です。
一括NORMAL PULL、手動SPECIAL PULL、CHAIN/BOOST/JACKPOT、Stage 1〜50の完成、
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
Vitestは確率データ、全抽選境界、独立抽選・乱数消費順と回数、
固定列/固定シード再現、H1加算・上限・入力非破壊・不正値拒否に加え、
ダメージ式、共鳴順・バフ寿命、ゲージ、討伐遷移、数値オーバーフローを検証します。

## GitHub Pages

公開先URL: [GACHA RAID: RESONANCE](https://mkunori.github.io/gacha-raid-resonance/)。
デプロイWorkflowを整備済みです。実際の公開成否はGitHub Actionsの「Deploy GitHub Pages」で確認してください。
Vite baseは /gacha-raid-resonance/ です。
リポジトリSettings → Pages → SourceをGitHub Actionsに設定してください。
mainへのpushで検証後にdistをデプロイし、mainでの手動実行にも対応します。
作業ブランチからはデプロイしません。

## 仕様と開発方針

- [Issue #1：仕様作成履歴（CLOSED）](https://github.com/mkunori/gacha-raid-resonance/issues/1)
- [ゲーム仕様書（原文全文・確認事項）](docs/GAME_SPEC.md)
- [技術設計](docs/TECHNICAL_DESIGN.md)
- [実装計画・子タスク案](docs/IMPLEMENTATION_PLAN.md)

仕様の正本はdocs/GAME_SPEC.mdです。Issue #1は仕様作成履歴として参照し、実装は個別Issueで追跡します。
仕様・実装・テストの整合性を各PRで保ちます。
数値や計算式は独断で変更せず、仮定や確認事項を明示します。
次はH2・CHAIN・追加効果と一括処理を、小さなPRに分けて実装します。
