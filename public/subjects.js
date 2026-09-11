/* ============================================================
   科目マニフェスト（演習アプリ）
   ------------------------------------------------------------
   このアプリは複数科目を扱う。科目が2つ以上あると、起動直後に
   「科目えらび」画面（ホーム）が開き、選んだ科目のデータだけを読み込む。
   科目をいくつ足しても、起動時に読む量は1科目ぶんのまま変わらない。

   問題データは public/subjects/<id>/questions.js（window.QUIZ_DATA）。
   このファイルは scripts/build-questions.mjs が contentDir の JSON から
   生成するので、直接手で編集しないこと。

   【重要】問題IDは科目ごとの idPrefix で始める（公共政経は "civics-"、化学は "chem-"）。
   進捗（localStorage）とFSRSの復習予定（IndexedDB）はIDで紐づいているため、
   IDが衝突すると学習記録が混ざる。validate:content がこの規約を検査する。

   科目ごとの表示設定（無いときはアプリ側の既定＝公共政経の並びを使う）:
     sourceTypeLabels … 出典区分の表示名。画面に sourceType をそのまま出さないため
     domainOrder      … 大分野の並び順
     fieldOrder       … 小分野（単元）の並び順
     contentDir       … 教材JSONの置き場所（build:questions が読む）
   ============================================================ */

window.SUBJECTS = [
  {
    id: "civics",
    name: "公共・政治経済",
    emoji: "⚖️",
    accent: "#3a4192",       // 藍
    learningMode: "cards",
    contentDir: "content/questions",
    questions: "subjects/civics/questions.js",
    idPrefix: "civics-",
    contentProfile: "civics", // 出典・確認日・選択肢別解説などの追加検査を有効にする
    hideLearning: true,       // 授業要点も用語カードも無いので「学習」の枠は出さない
    expectQuestions: 716,      // 件数の取りこぼし検知（増減させたらこの数も更新する）
    expectDomainCounts: { 公共: 28, 政治: 300, 経済: 388 },
    sourceTypeLabels: {
      "common-new": "共通テスト「公共，政治・経済」（新課程）",
      "common-legacy": "共通テスト「政治・経済」（旧課程）",
      "center": "センター試験「政治・経済」",
      "original": "自作の補強問題",
    },
    domainOrder: ["公共", "政治", "経済"],
    /* 政治経済塾の単元順（NEXT_WORK.md「4. 分野分類の基本表」）。
       ここに無い field は末尾へ回す。表を改訂したらこの配列も一緒に直すこと。 */
    fieldOrder: [
      "民主政治", "世界の政治", "平和主義", "基本的人権", "国会", "内閣", "裁判所", "地方自治",
      "政党・選挙", "国際連合", "東西冷戦", "地域紛争",
      "資本主義・社会主義", "日本の企業", "需要・供給曲線", "国民所得の計算", "金融", "財政",
      "日本経済史", "経済諸問題", "労働問題", "社会保障", "国際貿易体制", "国際経済の課題", "地球規模の問題",
      "青年期と自己形成", "現代の思想", "宗教と文化", "思考の方法", "情報社会とメディア",
    ],
  },
  {
    /* 化学。大学入試のマーク式のうち「正誤問題」「正しいものを選べ」「誤っているものを選べ」を集め、
       知識問題の対策に使う。方針と教材の作り方は docs/化学科目_実装計画.md が正本。 */
    id: "chemistry",
    name: "化学",
    emoji: "🧪",
    accent: "#3f8f96",       // 青緑（画面の地の色も青緑と生成り。index.html の :root[data-subject="chemistry"]）
    learningMode: "cards",
    contentDir: "content/chemistry/questions",
    questions: "subjects/chemistry/questions.js",
    idPrefix: "chem-",
    contentProfile: "chemistry",
    hideLearning: true,       // 授業要点も用語カードも無いので「学習」の枠は出さない
    hideExamDay: true,        // 共通テスト当日モードは公共政経だけの機能
    expectQuestions: 122,      // 収録を増やしたらこの数も更新する
    expectDomainCounts: { 理論化学: 42, 無機化学: 38, 有機化学: 28, 高分子化合物: 14 },
    sourceTypeLabels: {
      "common-test": "共通テスト「化学」",
      "center": "センター試験「化学」",
      "national": "国公立大学 一般入試",
      "private": "私立大学 一般入試",
      "original": "自作の補強問題",
    },
    domainOrder: ["理論化学", "無機化学", "有機化学", "高分子化合物"],
    // 称号（レベル帯で決まる）。学習量そのものは科目共通で数える
    ranks: [
      { min: 1, icon: "🧪", name: "化学入門" },
      { min: 3, icon: "📘", name: "基礎固め" },
      { min: 5, icon: "📝", name: "演習中級" },
      { min: 8, icon: "⚗️", name: "理論に強い" },
      { min: 12, icon: "🧱", name: "無機に強い" },
      { min: 16, icon: "🧬", name: "有機に強い" },
      { min: 21, icon: "🏫", name: "過去問上級" },
      { min: 26, icon: "🎓", name: "入試実戦" },
      { min: 31, icon: "👑", name: "化学マスター" },
    ],
    // docs/化学科目_実装計画.md「3. 分類」の表と同じ順に並べる（表を直したらここも直す）
    fieldOrder: [
      "物質の構成と化学結合", "物質量と化学反応式", "酸と塩基", "酸化還元", "電池と電気分解",
      "物質の三態", "気体の性質", "溶液の性質", "熱化学", "反応速度", "化学平衡",
      "周期表と元素の分類", "水素と貴ガス", "ハロゲン", "酸素と硫黄", "窒素とリン", "炭素とケイ素",
      "気体の製法と性質",
      "アルカリ金属", "2族元素とアルカリ土類金属", "両性元素（アルミニウム・亜鉛）",
      "遷移元素と錯イオン", "鉄とその化合物", "銅・銀とその化合物", "クロム・マンガンとその他の金属",
      "金属イオンの分離と検出", "セラミックスと合金", "無機工業化学",
      "有機化合物の構造と異性体", "脂肪族炭化水素", "アルコールとカルボニル化合物", "カルボン酸とエステル",
      "芳香族化合物", "有機化合物の分離と検出",
      "糖類", "アミノ酸とタンパク質", "核酸", "合成高分子", "天然高分子と繊維",
    ],
  },
];
