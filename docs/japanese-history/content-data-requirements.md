# 日本史（共テ対策）コンテンツデータ要件

作成日: 2026-09-15。出題分析は [common-test-analysis-2025-2026.md](common-test-analysis-2025-2026.md)（要件ID R1〜R11）、作問方針は [question-authoring-guidelines.md](question-authoring-guidelines.md)。本文書は**データ項目の設計**であり、コードやスキーマ検証の実装、実データの作成は行っていない。

## 0. 結論

- 既存の問題データ形式（`content/<科目>/questions/*.json` の `questions` 配列、1要素＝1解答番号）を**そのまま土台**にする。既存項目で R1〜R4・R6〜R9 はほぼ満たせる。
- 不足しているのは、(a) 型・能力・難易度・テーマのタグ（R10・R11）、(b) 複数資料を構造化して持つ `materials`、(c) **連動採点**（R5）、(d) 出典・権利・レビュー状態の構造化、の4点。これらを**任意項目の追加**として提案し、既存科目の教材には影響を与えない。
- 連動採点は「2レコード＋依存関係＋正答組合せ表」で表現する案（案B）を推奨する（第4節）。

---

## 1. 既存スキーマの確認（リポジトリ調査結果）

正本：`scripts/validate-content.mjs`（検査）、`src/types.ts`（型）、`public/subjects.js`（科目設定）。日本史の科目設定は登録済みで `draft: true`、`contentProfile: "japanese-history"`、`domainOrder` は「原始・古代／中世／近世／近代／現代」、`fieldOrder` は空配列（最初の収録時に決める方針が `subjects.js` に注記されている）。

既存項目（公共政経・化学の実データと検査項目から確認）：

| 項目 | 必須 | 意味・検査内容 |
| --- | --- | --- |
| `id` | ✓ | 一意。日本史は `jhist-` 始まり |
| `type` | — | `"choice"`（既定）／`"constructed"` |
| `category` | ✓ | 「共通テスト過去問」「自作問題」など表示用 |
| `sourceType` | ✓ | 日本史は `common-new`／`common-legacy`／`center`／`original` |
| `sourceLabel` | ✓ | 出典名（例：「2026年度 大学入学共通テスト 本試験「歴史総合，日本史探究」」） |
| `sourceQuestion` | — | 「第3問 問3（解答番号16・17）」 |
| `sourceUrl` | — | 公式公開ページ |
| `sourceNote` | — | 出典補足 |
| `year` | 過去問は✓ | 「2026年度」「2026年度 追試」「2021年度 第2日程」（西暦・正規表現で検査） |
| `domain` | ✓ | 時代5区分のいずれか |
| `field` / `topic` | ✓ | 小分野・主題 |
| `listTitle` | ✓ | 「〜に関する○○問題」、40字以内 |
| `points` | — | 配点 |
| `question` | ✓ | 設問文 |
| `stem` / `stemTitle` | — | リード文（改行テキスト）と見出し。`stemImages` があるときは `stemTitle` 必須 |
| `stemImages[]` | — | `{src, alt, label?}`。`alt` 必須 |
| `image` / `imageAlt` | — | 主図。`imageAlt` 必須 |
| `explainImage` / `explainImageAlt` | — | 解説用の図 |
| `groupId` / `groupFigures[]` | — | 大問（同一画面にまとめる小問群）と大問共通の図（`imageAlt` 必須） |
| `underlines` | — | 公共政経で3件のみ使用。仕様は要確認 |
| `choices[]` | ✓ | 2つ以上、可変長 |
| `choiceImages[]` | — | 選択肢の図（`choices` と同じ長さ、図なしは `null`） |
| `answer` | ✓ | 正答の添字（0始まり） |
| `answers[]` | — | 複数正解。`answers[0] === answer` が必須、重複不可 |
| `noShuffle` | 条件付き✓ | 丸数字・矢印・「すべて」「いずれも」等を含む選択肢では必須（日本史の検査に実装済み） |
| `askType` | 化学のみ✓ | 問い方 |
| `explanation` | ✓ | 正解理由 |
| `choiceNotes[]` | ✓ | 全選択肢分、空不可 |
| `verifiedAt` | ✓ | `YYYY-MM-DD` |

依頼で挙げられた項目との対応：

| 依頼項目 | 既存対応 | 提案 |
| --- | --- | --- |
| `id` | `id` | そのまま |
| `subject` / `course` | 科目はファイルの置き場所（`contentDir`）と `idPrefix` で決まる | 追加不要。将来コース分けするなら `course` を任意追加 |
| `curriculum` | `sourceType` から導出可能（`common-new`＝新課程） | 自作問題にも課程を付けたい場合 `curriculum`（`"new"` ／ `"legacy"`）を任意追加 |
| `examStyle` / `yearStyle` | なし | `examStyle`（`"2025"` ／ `"2026"` ／ `"legacy"`、模試ブループリントの型）を任意追加 |
| `majorQuestion` / `section` / `questionNumber` / `answerNumber` | 過去問は `sourceQuestion`（文字列）、大問は `groupId` | 模試セット用に `mock` オブジェクトを任意追加（第2節） |
| `points` | `points` | そのまま。連動は採点単位で持つ（第4節） |
| `theme` / `eras` / `domains` / `knowledgeTags` / `skillTags` | `domain`（時代1つ）、`field`、`topic` | `theme`・`eras[]`・`fields[]`（分野）・`knowledgeTags[]`・`skillTags[]`・`knowledgeLayers[]` を任意追加（第2節） |
| `prompt` / `materials` / `choices` | `question`、`stem`＋`stemImages`＋`image`、`choices` | `materials[]` を任意追加し、`stem` 等は後方互換のため残す（第3節） |
| `correctAnswer` / `gradingRule` | `answer`／`answers` | `answerMode`・`gradingUnit` を任意追加（第4節） |
| `answerMode` / `dependencies` / `acceptedAnswerCombinations` | なし | 第4節 |
| `explanation` / `reasoningSteps` / `requiredKnowledge` / `distractorRationales` | `explanation`、`choiceNotes` | `reasoningSteps[]`・`requiredKnowledge[]`・`distractorRationales[]` を任意追加（第5節） |
| `difficulty` と下位指標 / `estimatedTimeSeconds` | なし | 第6節 |
| `sourceCitations` / `license` / `rightsStatus` / `altText` | `sourceLabel`・`sourceUrl`・`sourceNote`、`imageAlt`・`alt` | `sourceCitations[]`・`license`・`rightsStatus` を任意追加。代替テキストは既存項目を使う（第7節） |
| `reviewStatus` / `reviewedBy` / `factCheckedAt` / `schemaVersion` | `verifiedAt` のみ | 第8節 |

---

## 2. 分類・タグ項目（R10・R11）

| 項目 | 型 | 値の例 | 目的 |
| --- | --- | --- | --- |
| `domain` | 文字列（既存） | 「近世」 | 主たる時代。歴史総合の世界史設問は主たる時代（近代／現代）に置く |
| `eras[]` | 文字列配列 | `["原始・古代","中世","近世"]` | 横断するすべての時代。テーマ史（T3）と歴史総合（T2）に必要 |
| `area` | 文字列 | `"rekishi-sogo"` / `"nihonshi-tankyu"` / `"cross"` | 領域（歴史総合／日本史探究／横断）。模試の第1問を組む鍵 |
| `theme` | 文字列 | 「漁業の歴史」「災害の歴史」 | 大問テーマ。ローテーション規則で6模試以上あける |
| `field` | 文字列（既存） | 「荘園と地頭」 | 小分野。`subjects.js` の `fieldOrder` に載せる |
| `fields[]` | 文字列配列 | `["政治","社会経済"]` | 分野（政治・外交・社会経済・文化・宗教・生活・地域・環境） |
| `topic` | 文字列（既存） | 「弓削島荘の年貢と地頭の横領」 | 主題 |
| `questionType` | 文字列 | `correct-one` / `incorrect-one` / `two-tf` / `memo-tf` / `pick-two` / `blank-combo` / `pair-combo` / `combo-3x2` / `order` / `linked` / `source-pick` | 型（作問方針第2節に対応）。比率管理に使う |
| `knowledgeTags[]` | 文字列配列 | `["承久の乱","地頭","東寺百合文書"]` | 復習タグ。重複防止の鍵 |
| `skillTags[]` | 文字列配列 | `["史料読解","主体の特定","年代化"]` | 能力タグ |
| `knowledgeLayers[]` | 整数配列 | `[1,2,4,5]` | 分析第5節の知識層 |
| `abilityMode` | 文字列 | `"knowledge"` / `"reading"` / `"integrated"` | 知識のみ／読解のみ／統合（T7 の比率管理） |
| `materialKinds[]` | 文字列配列 | `["translated-source","student-note"]` | 主資料の種類（`materials[].kind` から導出可） |
| `examStyle` | 文字列 | `"2026"` | 模試の型（2025型・2026型） |
| `mock` | オブジェクト | `{ "setId": "jhist-mock-001", "major": 3, "section": "A", "number": 3, "answerNumbers": [16,17] }` | 自作模試内の位置。大問・部・問・解答番号 |

---

## 3. 資料（`materials`）の構造化（R3・R4・R7）

既存の `stem`／`stemImages`／`image` は残しつつ、複数資料にラベル・出典・代替テキストを持たせる任意項目を提案する。

```jsonc
"materials": [
  {
    "id": "m1",
    "kind": "student-note",            // student-note | report | panel | conversation | translated-source | original-source | table | timeline | map | chart | picture | diagram
    "label": "ノート1",
    "title": "ある網元の下で行われていた漁業の仕組み",
    "body": "・網元は、漁場・漁船・網などを手配する。\n・…",   // テキスト（表は Markdown 風の行区切りで持つ）
    "notes": ["注1）…", "注2）…"],      // 史料の注
    "image": "images/japanese-history/xxx.webp",
    "alt": "代金の流れを示す図。商人から網元へ…",             // 画像があるとき必須
    "citation": "『東寺百合文書』（現代語訳・要約は自作）",
    "modified": true                     // 改変（要約・トリミング）の有無
  }
]
```

運用上の決まり：

- `materials` を使う問題でも `stemTitle` を付け、`stem` には資料の要約または「資料は下の材料を参照」を書き、旧UIでも読めるようにする。
- `kind: "map"|"chart"|"picture"|"diagram"` は `image`＋`alt` を必須にし、`alt` は凡例・位置関係・判定に必要な数値を文章化する（作問方針第7.4節）。
- 表は画像にせず `body` にテキストで持ち、必要なら画像を併用する。
- 検査（将来実装）：`materials[].image` があるのに `alt` が空ならエラー、`kind` が語彙外ならエラー。

---

## 4. 解答方式と条件付き採点（R1・R2・R5）

### 4.1 解答方式の語彙

| `answerMode` | 意味 | 既存項目との関係 |
| --- | --- | --- |
| `single`（既定） | 1つ選ぶ、正答1つ | `answer` |
| `multi-accept` | 1つ選ぶが複数の選択肢を正答として認める | `answers[]`（既存） |
| `linked` | 他の解答番号の選択で正答が変わる | `dependencies[]`＋`acceptedAnswerCombinations[]`（新設） |

選択肢数は `choices` の長さで決まる（4・5・6・8択に対応：R1）。順序依存の型（`two-tf`／`memo-tf`／`pick-two`／`order`／`linked`）は `noShuffle: true` を必須にする（既存検査が丸数字等で検出するが、`questionType` からも必須化する）。

### 4.2 連動採点の表現（2026年度 第3問問3 型）

**案B（推奨）：2レコード＋依存関係＋正答組合せ表**

```jsonc
[
  {
    "id": "jhist-orig-kodai-0301",
    "groupId": "jhist-orig-kodai-03",
    "questionType": "linked",
    "answerMode": "multi-accept",
    "noShuffle": true,
    "question": "（1）二人が挙げた出来事あ・いのうちから一つ選び、あを選択する場合には①を、いを選択する場合には②をマークせよ。",
    "choices": ["あ", "い"],
    "answer": 0,
    "answers": [0, 1],
    "gradingUnit": "jhist-orig-kodai-03-q3",   // 採点単位ID。同じIDのレコードをまとめて採点
    "points": 0,                                 // 採点単位の点数は後のレコードに持つ（合計の二重計上を防ぐ）
    "linkedRole": "selector",
    "explanation": "（(1)は選択であり、どちらを選んでも(2)で対応する正答がある。…）",
    "choiceNotes": ["…", "…"]
  },
  {
    "id": "jhist-orig-kodai-0302",
    "groupId": "jhist-orig-kodai-03",
    "questionType": "linked",
    "answerMode": "linked",
    "noShuffle": true,
    "question": "（2）次に、(1)で選択した出来事が政治の転換の契機と考えられる理由として最も適当なものを一つ選べ。",
    "choices": ["…", "…", "…", "…", "…", "…"],
    "answer": 4,                                  // 既存検査を通すための代表正答（dependencies が無い環境での既定）
    "gradingUnit": "jhist-orig-kodai-03-q3",
    "points": 3,
    "linkedRole": "dependent",
    "dependencies": ["jhist-orig-kodai-0301"],
    "acceptedAnswerCombinations": [
      { "jhist-orig-kodai-0301": 0, "self": 4 },
      { "jhist-orig-kodai-0301": 1, "self": 5 }
    ],
    "explanation": "…",
    "choiceNotes": ["…", "…", "…", "…", "…", "…"]
  }
]
```

採点規則：`gradingUnit` が同じレコード群を1単位とし、各レコードの選択の組が `acceptedAnswerCombinations` のいずれかに一致したときだけ `points` を与える。片方だけ正しくても0点（本試験の「＊」規則と同じ：rekishi-nihonshi_ans.pdf, p.1 注）。

表示規則：`dependencies` を持つレコードは、依存先と同じ `groupId` で同一画面に出し、依存先を先に解答させる。学習記録（FSRS）は採点単位ではなく各レコードIDで持つ（既存の「IDで紐づく」設計を変えない）。

**案A（参考）：1レコードに `parts[]` を持つ** — 1画面1設問の現行レンダラーを大きく変えるため、今回は採用しない。

### 4.3 検査項目（将来 `validate-content.mjs` に足す候補）

- `answerMode: "linked"` なら `dependencies` と `acceptedAnswerCombinations` が必須、各組合せの添字が `choices` の範囲内、依存先IDが同じ `groupId` に存在する。
- 同じ `gradingUnit` のレコードの `points` 合計が採点単位の配点と一致（selector 側は 0）。
- `questionType` が `order`／`two-tf`／`memo-tf`／`pick-two`／`linked` なら `noShuffle: true`。
- `choices` が7つ以上（8択）でも `choiceNotes` が同数そろう（既存検査で対応済み）。

---

## 5. 解説の構造化（作問方針第4節）

| 項目 | 型 | 内容 |
| --- | --- | --- |
| `explanation` | 文字列（既存・必須） | 正答・思考手順・必要知識・資料中の根拠・関連知識をまとめた本文（300〜600字） |
| `choiceNotes[]` | 文字列配列（既存・必須） | 全選択肢分の説明 |
| `reasoningSteps[]` | 文字列配列 | 「資料から○を読む」「知識で年代化」「照合」の各段階 |
| `requiredKnowledge[]` | `{ "term": "承久の乱", "when": "1221年", "point": "乱後に地頭の荘園侵略が顕著になる" }` の配列 | いつ・誰が・何のため |
| `evidenceInMaterials[]` | `{ "materialId": "m1", "quote": "関東の…が置かれる", "note": "幕府側の設置＝地頭" }` | 資料中の根拠（引用は20字以内） |
| `distractorRationales[]` | `{ "choiceIndex": 1, "category": "anachronism", "note": "…" }` の配列 | 誤答分類：`anachronism`（時代錯誤）／`wrong-agent`（主体取り違え）／`reversed-causality`（因果逆転）／`overgeneralization`（過剰一般化）／`exaggeration`（程度の誇張）／`other-event`（別事件の帰結）／`term-confusion`（用語混同）／`scope-shift`（範囲のずれ） |
| `reviewTags[]` | 文字列配列 | 復習タグ（`knowledgeTags` と同じ語彙） |

---

## 6. 難易度と時間（作問方針第3節）

```jsonc
"difficulty": {
  "knowledge": 3,      // A 知識の深さ 1–4
  "material": 4,       // B 資料の量と読解難度
  "integration": 3,    // C 統合する情報数
  "inference": 4,      // D 推論段階数
  "distractor": 3,     // E 誤答の紛らわしさ
  "operation": 3,      // F 解答操作の複雑さ
  "total": 20,         // 合計（6–24）
  "band": "hard"       // easy | standard | harder | hard
},
"estimatedTimeSeconds": 170
```

`band` は `total` から機械的に決める（易6〜10／標準11〜15／やや難16〜19／難20〜24）。

---

## 7. 素材・出典・権利（作問方針第7節）

| 項目 | 型 | 内容 |
| --- | --- | --- |
| `sourceLabel` / `sourceUrl` / `sourceNote` | 既存 | 問題の出典（過去問なら試験名、自作なら「自作問題（〜から作成）」） |
| `sourceCitations[]` | `{ "materialId": "m2", "title": "…", "holder": "国立国会図書館デジタルコレクション", "url": "…", "license": "PD", "accessedAt": "2026-09-15", "modified": "トリミング・注記追加" }` | 資料ごとの出典と改変表示 |
| `license` | 文字列 | 問題全体に適用する素材ライセンスの最も厳しいもの（`original` / `PD` / `CC0` / `CC-BY-4.0` / `permitted`） |
| `rightsStatus` | `confirmed` / `pending` / `unknown` | `unknown` は収録不可（作問方針第6.3節 不合格条件3） |
| `imageAlt` / `stemImages[].alt` / `materials[].alt` | 既存＋新設 | 代替テキスト（必須） |

---

## 8. レビュー状態

| 項目 | 型 | 内容 |
| --- | --- | --- |
| `verifiedAt` | 既存・必須 | 内容確認日 |
| `factCheckedAt` | `YYYY-MM-DD` | ファクトチェック完了日 |
| `factCheckSources[]` | 文字列配列 | 確認に使った資料名（教科書名・史料集名・公的資料名） |
| `reviewStatus` | `draft` / `in-review` / `approved` / `rejected` | `approved` 以外は `build:questions` の対象外にする（将来実装） |
| `reviewedBy` | 文字列 | レビュー担当（作成者と異なること） |
| `reviewNotes` | 文字列 | 指摘と対応 |
| `similarityChecked` | 真偽値 | 既存共通テスト問題との類似確認済み |
| `schemaVersion` | 文字列 | 例 `"jhist-1"`。項目追加時に上げる |

---

## 9. 既存スキーマとの差分まとめ

| 区分 | 項目 | 影響 |
| --- | --- | --- |
| そのまま使う | `id`, `type`, `category`, `sourceType`, `sourceLabel`, `sourceQuestion`, `sourceUrl`, `sourceNote`, `year`, `domain`, `field`, `topic`, `listTitle`, `points`, `question`, `stem`, `stemTitle`, `stemImages`, `image`, `imageAlt`, `groupId`, `groupFigures`, `choices`, `choiceImages`, `answer`, `answers`, `noShuffle`, `explanation`, `choiceNotes`, `verifiedAt` | なし |
| 任意追加（表示・出題制御） | `eras`, `area`, `theme`, `fields`, `questionType`, `knowledgeTags`, `skillTags`, `knowledgeLayers`, `abilityMode`, `materialKinds`, `examStyle`, `mock` | 既存科目には無視される |
| 任意追加（資料） | `materials[]` | `stem` 系との併用。表示側の対応は将来 |
| 任意追加（採点） | `answerMode`, `gradingUnit`, `linkedRole`, `dependencies`, `acceptedAnswerCombinations` | **採点ロジックの追加が必要**（R5）。未対応の間は `answer` を代表正答として単独採点される |
| 任意追加（解説） | `reasoningSteps`, `requiredKnowledge`, `evidenceInMaterials`, `distractorRationales`, `reviewTags` | 表示は将来 |
| 任意追加（難易度） | `difficulty`, `estimatedTimeSeconds` | 出題比率の管理に使う |
| 任意追加（権利・レビュー） | `sourceCitations`, `license`, `rightsStatus`, `factCheckedAt`, `factCheckSources`, `reviewStatus`, `reviewedBy`, `reviewNotes`, `similarityChecked`, `schemaVersion` | 検査への組み込みは将来 |
| 科目設定 | `subjects.js` の `fieldOrder`（空配列） | 最初の収録時に小分野表を決める。候補：時代ごとに「政治」「外交」「社会経済」「文化」「宗教」「生活・地域・環境」を掛け合わせた語（例「中世の政治」）ではなく、既存科目に倣って単元名（「荘園と地頭」「幕藩体制」など）で並べる |

実装順序の提案（本文書の範囲外、参考）：①タグ項目と `difficulty` の受け入れ（検査を緩く追加）→②`materials` の表示→③連動採点。①だけでも比率管理と重複防止が始められる。
