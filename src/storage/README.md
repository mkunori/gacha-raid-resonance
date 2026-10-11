# 保存アダプター（後続PR）

現在は未実装。localStorageへの読み書きはここに閉じ込め、
ゲームコアはブラウザAPIを参照しない。
saveVersion: 1 の型契約は src/types/game.ts に定義。
JSONは unknown として読み、スキーマ・値域検証後に利用する。
詳細は docs/TECHNICAL_DESIGN.md を参照。
