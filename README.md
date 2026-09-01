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
npm run check      # 教材生成 → 教材検証 → 型検査 → 本番ビルド → テスト
npm run build      # 本番ビルド（dist/）
npm run serve      # ビルド済み dist/ を同じLANへ配信（http://localhost:8080）
```

`npm run build` は次の順で走る。どこかで落ちたら公開物は作られない。

1. `build:questions` — `content/questions/*.json` から `public/subjects/civics/questions.js` を生成
2. `validate:content` — 問題数・ID・正解番号・選択肢別解説・出典・確認日などを検査
3. `tsc --noEmit` — 型検査
4. `vite build` — `dist/` を生成

## 生徒の端末で使う

`npm run build` でできる `dist/` が配布物のすべて。中身は静的ファイルだけなので、
置いた先で index.html を開けば動く。渡し方は2つある。

### 1. 同じWi-Fiから開いてもらう（すぐ試すとき）

```bash
npm run build
npm run serve                       # 表示されたURLを生徒に伝える
APP_PASSWORD=好きな文字列 npm run serve   # 簡易認証をかけるとき（利用者は quiz / その文字列）
```

同じLANにいる間だけ使える。手軽だが **http なのでPWAとしては動かない**
（Service Worker は https と localhost でしか動かず、ホーム画面追加もオフラインも効かない）。
授業中に画面を見せる用途向け。

### 2. インターネットに公開する（生徒が普段使う本番／推奨）

**公開URL: https://9hckg4shj6-glitch.github.io/civics-study-app/**

このURLをスマートフォンに送れば、同じWi-Fiにいなくても・PCの電源が入っていなくても開ける。
https なので Service Worker が動き、ホーム画面追加とオフライン起動もここで初めて使える。

公開はこのコマンド1つ。

```bash
npm run deploy
```

中では 検査（`npm run check`）→ 公開用ビルド（`APP_BASE_PATH=/civics-study-app/`）→
`gh-pages` ブランチへ push が順に走る。**検査で落ちたら公開されない**ので、
壊れた版が生徒に届くことはない。ソースは `main`、生徒に届く成果物は `gh-pages`。

問題を足したときの流れ:

```bash
git add -A && git commit -m "問題を追加"
git push            # ソースの保存（これだけでは公開URLは変わらない）
npm run deploy      # 公開URLへ反映
```

- 反映に1〜3分かかる。スマホ側は次に開いたときに新版へ入れ替わる（`registerType: "autoUpdate"`）
- 生徒の端末では、ブラウザで開いたあと「ホーム画面に追加」してもらう
- 一度開けば、以降は機内モードでも全問解ける（問題も解説も端末内にある）
- 別の場所に置くときは `scripts/deploy.mjs` の `BASE` と、このREADMEの公開URLを一緒に直す

#### push しただけで公開されるようにする（任意）

いまローカルから公開しているのは、`gh` のトークンに `workflow` 権限が無く
`.github/workflows/` を push できないため。次を通すと GitHub Actions 方式へ移せる。

```bash
gh auth refresh -h github.com -s workflow      # ブラウザで許可する
mkdir -p .github/workflows
cp scripts/pages-workflow.yml.example .github/workflows/deploy.yml
git add -A && git commit -m "push で自動公開する" && git push
```

そのうえで リポジトリの Settings → Pages → Source を **GitHub Actions** に変える。
以後は `main` へ push するだけで公開まで走る（`npm run deploy` は不要になる）。

過去問の本文をそのまま載せているので、検索エンジンには載せない。効いているのは
`index.html` の `<meta name="robots" content="noindex, nofollow, noarchive">` で、**これを消さないこと。**
（`public/robots.txt` も置いてあるが、robots.txt はドメイン直下しか読まれない決まりなので、
サブディレクトリ配信の今は効いていない。独自ドメインへ移したときのための備え。）

URLを知っている人は誰でも開けるので、URLは生徒に直接渡す（SNS等に貼らない）。

### 端末を移すとき

「設定・データ → 手動バックアップ」で JSON を書き出し、新しい端末の同じ画面の
「📁 ファイルから読む」で読み込む。学習記録はこの往復でしか端末間を移動しない。

## どんな問題を載せるか

**問題文と選択肢だけで完結する問題** だけを載せる。

| 載せる | 載せない |
| --- | --- |
| 知識問題（一問一答で答えが決まる） | 長い会話文・メモ・ノートを読ませる考察問題 |
| 時系列問題（できごとの順序） | 共通資料を前提に空欄ア・イを埋める問題 |
| グラフ問題・計算問題 | 大問の他の小問と読み合わせないと解けない問題 |

スマートフォンで隙間時間に解くアプリなので、画面をスクロールしないと
設問にたどり着けない問題は入れない。共通テストの第1問のような
長文の考察問題は、紙の過去問で解く前提にしている。

外した問題は捨てずに `content/excluded/` に置いてある（ビルド対象外）。
方針を変えるときは `content/questions/` へ戻して `npm run build` すればよい。

## 収録教材（試作版）

10問。公共1問・政治5問・経済4問。

| 出典区分 | 内訳 | 問数 |
| --- | --- | --- |
| `common-new` | 令和8年度・令和7年度 本試験「公共，政治・経済」 | 2 |
| `common-legacy` | 令和7年度「旧政治・経済」／令和6年度「政治・経済」 | 8 |

正解はすべて大学入試センター公表の正解PDFと照合済み（各問の `verifiedAt`）。
全問に「問題全体の要点と正解理由」（`explanation`）と、
選択肢ひとつひとつの説明（`choiceNotes`）を付けている。

新課程の「公共，政治・経済」は考察問題の比率が高いため、この方針では
旧課程「政治・経済」からの一問一答が中心になる。

> センター試験「政治・経済」は、大学入試センターが問題・正解を公開していない
> （公開は直近3年分のみ）。公式解答を確認できない問題の正解を推測で登録しない
> という方針から、試作版では収録していない。

## 問題を追加するとき

アプリ本体（`index.html` / `src/`）は触らない。次の3つだけで足りる。

1. `content/questions/*.json` に問題を足す（ファイル名順 → 配列順に連結される）
2. 図を使うなら `public/images/civics/` に置き、`imageAlt` を必ず付ける
3. `public/subjects.js` の `expectQuestions` と `expectDomainCounts` を更新する

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
- 端末側から問題データを差し替える口（CSV/JSONの取り込み）
  出典も選択肢別解説も持たない問題が混ざり、学習記録とIDが食い違うため。
  問題を増やすのは `content/questions/*.json` とビルドだけ

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
  ログイン画面が出ないこと・演習と採点・バックアップ画面を確認する
  （`dist/` が必要なので、先に `npm run build` を実行しておく）
- `tests/no-legacy-content.test.ts` — このアプリは基礎医学演習アプリの画面をもとに
  作ったので、生化学の用語や医師のキャリアを使った文言が `dist/` に残っていないかを見張る
- そのほかは FSRS・IndexedDB・記述問題採点など、既存の学習基盤の単体テスト

## アイコン

`node scripts/make-icons.mjs` が `public/icons/` の7枚を1枚のSVGから作り直す。
医学アプリと同じアイコンだとホーム画面で見分けがつかないので、必ず別の図案にする。

## 原本PDFの置き場

`sources/` は `.gitignore` で除外している。原本PDFと作業資料はそこへ置く。
出典の一覧と照合手順は `sources/INDEX.md`。
