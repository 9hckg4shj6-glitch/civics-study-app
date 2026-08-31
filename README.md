# 公共・政治経済 演習

大学入学共通テスト「公共，政治・経済」の過去問演習アプリ。
家庭教師の生徒がスマートフォンとPCの両方で使うことを想定した、
**ログイン不要・サーバー不要・オフライン対応**の静的PWA。

学習記録は使っている端末の中だけに保存され、外部へは一切送信しない。
端末を移すときは「設定・データ」の手動バックアップ（JSON）で引き継ぐ。

## 使い方（開発）

```bash
npm install
npm run dev        # 開発サーバー（http://localhost:5173）
npm run check      # テスト → 教材生成 → 教材検証 → 型検査 → 本番ビルド
npm run build      # 本番ビルド（dist/）
```

`npm run build` は次の順で走る。どこかで落ちたら公開物は作られない。

1. `build:questions` — `content/questions/*.json` から `public/subjects/civics/questions.js` を生成
2. `validate:content` — 問題数・ID・正解番号・選択肢別解説・出典・確認日などを検査
3. `tsc --noEmit` — 型検査
4. `vite build` — `dist/` を生成

## 収録教材（試作版）

30問。公共10問・政治10問・経済10問。

| 出典区分 | 内訳 | 問数 |
| --- | --- | --- |
| `common-new` | 令和8年度・令和7年度 本試験「公共，政治・経済」 | 16 |
| `common-legacy` | 令和7年度「旧政治・経済」／令和6年度「政治・経済」 | 14 |

正解はすべて大学入試センター公表の正解PDFと照合済み（各問の `verifiedAt`）。
全問に「問題全体の要点と正解理由」（`explanation`）と、
選択肢ひとつひとつの説明（`choiceNotes`）を付けている。

30問すべてが総合演習セット `pilot-001`（30問・60分）に登録されている。

> センター試験「政治・経済」は、大学入試センターが問題・正解を公開していない
> （公開は直近3年分のみ）。公式解答を確認できない問題の正解を推測で登録しない
> という方針から、試作版では収録していない。

## 問題を追加するとき

アプリ本体（`index.html` / `src/`）は触らない。次の3つだけで足りる。

1. `content/questions/*.json` に問題を足す（ファイル名順 → 配列順に連結される）
2. 図を使うなら `public/images/civics/` に置き、`imageAlt` を必ず付ける
3. `public/subjects.js` の `expectQuestions` と `expectDomainCounts`、
   総合演習を増やすなら `window.EXAM_SETS` を更新する

`public/subjects/civics/questions.js` は**生成物なので直接編集しない**。

### 問題データの形

```json
{
  "id": "civics-r8-honshi-1-1",
  "type": "choice",
  "domain": "公共",
  "field": "公共的な空間における協働",
  "topic": "自助・共助・公助とロールズの正義論",
  "sourceType": "common-new",
  "sourceLabel": "令和8年度 大学入学共通テスト 本試験「公共，政治・経済」",
  "sourceQuestion": "第1問 問1（解答番号1）",
  "sourceUrl": "https://www.dnc.ac.jp/...",
  "year": "令和8年度",
  "points": 3,
  "noShuffle": true,
  "stemTitle": "生徒Ａ・生徒Ｂのメモ",
  "stem": "共通資料の本文（改行はそのまま表示される）",
  "question": "設問文",
  "choices": ["選択肢1", "選択肢2", "選択肢3", "選択肢4"],
  "answer": 1,
  "explanation": "問題全体の要点と正解理由",
  "choiceNotes": ["選択肢1の説明", "選択肢2の説明", "選択肢3の説明", "選択肢4の説明"],
  "verifiedAt": "2026-08-31",
  "examSetId": "pilot-001",
  "examOrder": 1
}
```

- `answer` は 0 始まり。複数正解は `answers` を足し、`answers[0]` を `answer` と一致させる
- `choiceNotes` の件数は `choices` と必ず一致させる（検証で落ちる）
- `domain` は `公共` / `政治` / `経済`
- `sourceType` は `common-new` / `common-legacy` / `center` / `original`
- `noShuffle: true` は選択肢を原本の並び順で出す。過去問は原則これを付ける
- 画像には `imageAlt`（解説画像には `explainImageAlt`）が必須
- 出題当時と現在で制度・統計が違う問題は `sourceNote` に差を書く

## このアプリが持たない機能

意図的に取り除いてある。復活させないこと。

- アカウント・Googleログイン・Supabase・クラウド同期
- ランキング・掲示板・デッキの公開／共有
- 実行時のAI API呼び出し（解説は開発中に作って静的データへ保存する）

起動時も含めて外部への通信は発生しない。
CSP の `connect-src` は `'self'` のみに絞ってある。

## 医学アプリとの分離

同じブラウザで基礎医学演習アプリを使っても記録が混ざらないよう、
保存領域の名前をすべて分けてある。

| 種別 | このアプリ |
| --- | --- |
| IndexedDB | `civics-study-v1` |
| localStorage | `civics*`（`civicsProgress_v1` ほか） |
| PWAキャッシュ | `civics-manifest-v1` / `civics-subjects-v1` / `civics-images-v1` |
| バックアップの `app` | `common-test-civics` |

バックアップの復元時は `app` と `version` を検査し、
別アプリのファイル・壊れたJSON・型の合わないデータは取り込まずに拒否する。

## テスト

```bash
npm test
```

- `tests/civics-content.test.ts` — 収録教材そのものの検証（問数・分野配分・ID・出典・選択肢別解説）
- `tests/backup.test.ts` — 手動バックアップの往復（暗記カード・デッキ・復習予定・分類）
- `tests/app-smoke.test.ts` — ビルド済み `dist/` を jsdom で実際に起動し、
  ログイン画面が出ないこと・演習と採点・60分の総合演習・バックアップ画面を確認する
  （`dist/` が必要なので、先に `npm run build` を実行しておく）
- そのほかは FSRS・IndexedDB・記述問題採点など、既存の学習基盤の単体テスト

## アイコン

`node scripts/make-icons.mjs` が `public/icons/` の7枚を1枚のSVGから作り直す。
医学アプリと同じアイコンだとホーム画面で見分けがつかないので、必ず別の図案にする。

## 原本PDFの置き場

`sources/` は `.gitignore` で除外している。原本PDFと作業資料はそこへ置く。
出典の一覧と照合手順は `sources/INDEX.md`。
