/* ============================================================
   科目マニフェスト（公共・政治経済演習アプリ）
   ------------------------------------------------------------
   このアプリは「公共，政治・経済」1科目だけを扱う。
   科目が1つのときは科目えらび画面を挟まず、起動直後にホームを表示する。

   問題データは public/subjects/civics/questions.js（window.QUIZ_DATA）。
   このファイルは scripts/build-questions.mjs が content/questions/*.json から
   生成するので、直接手で編集しないこと。

   【重要】問題IDはすべて "civics-" で始める。
   進捗（localStorage）とFSRSの復習予定（IndexedDB）はIDで紐づいているため、
   IDが衝突すると学習記録が混ざる。validate:content がこの規約を検査する。
   ============================================================ */

window.SUBJECTS = [
  {
    id: "civics",
    name: "公共・政治経済",
    emoji: "⚖️",
    accent: "#3a4192",       // 藍
    learningMode: "cards",
    questions: "subjects/civics/questions.js",
    idPrefix: "civics-",
    contentProfile: "civics", // 出典・確認日・選択肢別解説などの追加検査を有効にする
    hideLearning: true,       // 授業要点も用語カードも無いので「学習」の枠は出さない
    expectQuestions: 150,      // 件数の取りこぼし検知（増減させたらこの数も更新する）
    expectDomainCounts: { 公共: 17, 政治: 52, 経済: 81 },
  },
];
