# ゲームコア

このディレクトリにUI・ストレージ非依存の純粋関数を追加する。
通常独立抽選・H1/H2と基本戦闘・3共鳴・追加効果・単一/一括PULLエンジンを実装済み。
手動SPECIAL・固定回数の×MAXと再開・Stage20以降のJACKPOTも実装済み。
特殊ボス補正、Stage解放、フォーカス変更、Stage50クリアと51以降の継続もコアに実装済み。
RS手動1Lv購入、価格/購入情報、支払台帳と無料の全額返還RESPECも実装済み。
UI・保存への接続はなく、未実装関数のダミーや空モジュールは置かない。

| モジュール | 責務 |
| --- | --- |
| gacha.ts（実装済み） | drawNormalPullで独立抽選、applyNormalPullStacksでH1加算。新しい値を返し、入力を変更しない。ダメージ・追加効果を適用しない |
| resonance.ts（実装済み） | findNextResonance / resolveResonances：優先順位・3+3消費・FLAME/THUNDER予約・OVERLOAD・H2/BOOST乗算・複数共鳴 |
| combat.ts（実装済み） | calculateAttack / calculateNormalDamage / calculateResonanceDamage：基礎A・通常/共鳴ダメージ |
| special.ts（実装済み） | drawSpecialPull / calculateSpecialDamage / calculateSpecialMaxCount：独立1乱数抽選・SPECIALチャネル火力・開始時予約数 |
| jackpot.ts（実装済み） | resolveJackpot：元Stage基準の100件区間・SSR閾値・独立ボーナス計算 |
| boss.ts（実装済み） | calculateBossMaxHp / calculateBossReward / applyBossDamage / finishBossDefeat：HP/報酬・PULL終了後の遷移/クリア。getBossInfoで設定から名前・特性説明・チャネル倍率を取得 |
| progression.ts（実装済み） | isFeatureUnlocked / isUpgradeUnlocked / setFocus / hasClearedGame：最高Stageによる解放・クリア状態取得とFocus変更 |
| engine.ts（実装済み） | createInitialGameState、executeNormalPull(s) / resumePendingNormalPulls、executeSpecialPull(s) / resumePendingSpecialPulls：実PULL確定・キュー・上限・集計・再開 |
| validation.ts（実装済み） | コア数値・スタック・一時効果・JACKPOT区間・NORMAL/SPECIALキューの整合性。保存JSONのスキーマ検証は担当しない |
| upgrades.ts（実装済み） | calculateUpgradeCost / getUpgradeInfo / purchaseUpgrade / respecUpgrades：1Lv価格、購入情報、原子的な手動購入と支払台帳・全額RESPEC |

詳細: [技術設計](../../docs/TECHNICAL_DESIGN.md)。

`executeNormalPulls(state, count, rng, limit?)`は新規操作で、残キューがあれば拒否する。
`resumePendingNormalPulls(state, rng, limit?)`は残キューのみ処理する。
`executeNormalPull`は実PULLを1回だけ進める低レベルAPI。キューがあればCHAIN優先で先頭を消費し、
空なら基本PULLを1回実行する。生成したCHAINはキューに残すため、×1操作全体にはexecuteNormalPullsを使う。
入出力は不変スナップショットとして扱う。空キュー再開は入力参照をそのまま返す。
例外時に入力は変わらないがRNGは巻き戻さない。再開時は同じRNGの続きが必要。

`executeSpecialPulls(state, 1 | 'MAX', rng, limit?)`は手動の新規操作。
×MAXは開始時のfloor(gauge/30)を予約し、`resumePendingSpecialPulls`で残回数だけ再開する。
`executeSpecialPull`は1実SPECIALの低レベルAPIで、保留中なら予約を1件進める。
NORMAL/SPECIALどちらかに保留があれば他種の処理・新規操作は拒否する。
SPECIALは1乱数だけ消費し、NORMALの効果時間やJACKPOT区間を進めない。

新規操作はhighestStageを参照してNORMAL×100/×1000、SPECIAL×MAXの解放を検証し、未解放ならRNG0回で拒否する。
resume APIは予約済み回数の解放を再判定しない。setFocusは保留キューなしの場合のみ許可し、解放前はBALANCED固定。
setFocusの返却値は未変更ネスト値を共有する不変スナップショット。必要ならコピーしてから直接編集する。
resolveResonancesは末尾の任意stage（既定1）で元ボスの共鳴補正・OVERLOAD獲得量を選択する。
NORMAL/SPECIALも元Stageの補正を適用し、JACKPOTは独立する。全討伐遷移はPULL終了後。
初回Stage50撃破はboss-defeated → game-cleared → stage-started(51)。hasClearedGameはhighestStage>=51を判定する。
バッチsummary.clearedGameは当該呼び出しのクリア発生のみを示し、分割集計はORで結合する。
クリア後も予約を継続し、51以降は通常倍率。UI・保存は後続フェーズ。

`getUpgradeInfo(state, upgrade)`は現Lv・次価格・解放可否・保有RS・対象支払額・購入可否と理由を返す。
理由はPENDING_PULLS、LOCKED、NUMERIC_LIMIT、INSUFFICIENT_RSの順で判定し、購入可能ならnull。不正stateはRangeError。
`calculateUpgradeCost(upgrade, currentLevel)`は既存UPGRADE_RULESのceil価格。過大価格はRangeError、情報取得時の次価格はnullになる。
`purchaseUpgrade(state, upgrade)`はRS/Lv/台帳を同時更新し、`respecUpgrades(state)`は実支払台帳を全返還してLv/台帳をゼロにする。
どちらも新GameStateを返し、RNG不要。保留NORMAL/CHAIN/SPECIAL中は拒否し、完了後のみ許可する。
Lv・台帳の明らかな矛盾と合計の安全整数を検証し、それ以上の台帳は実績として信頼する（GAME_SPEC第18章）。
変更対象のLv/台帳は新オブジェクト、他の戦闘ネスト値は不変スナップショットとして共有する。直接編集する前にコピーする。
既存engineは次のPULLから新Lvを参照するため、独立した倍率や戦闘への特別な反映処理は持たない。
UIの購入・RESPEC確認はPhase 7、保存スキーマ/移行/破損修復はPhase 8。強化×MAX・自動購入は実装しない。
