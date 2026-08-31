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
    accent: "#12657a",       // 紺〜青緑
    learningMode: "cards",
    questions: "subjects/civics/questions.js",
    idPrefix: "civics-",
    contentProfile: "civics", // 出典・確認日・選択肢別解説などの追加検査を有効にする
    hideLearning: true,       // 授業要点も用語カードも無いので「学習」の枠は総合演習にあてる
    expectQuestions: 30,      // 件数の取りこぼし検知（増減させたらこの数も更新する）
    expectDomainCounts: { 公共: 10, 政治: 10, 経済: 10 },
  },
];

/* 総合演習セット（30問・60分）のマニフェスト。
   本試験の年度別再現ではなく、過去問から抜粋した総合演習として提示する。 */
window.EXAM_SETS = [
  {
    id: "pilot-001",
    title: "公共・政治経済 総合演習 第1回",
    questionCount: 30,
    durationMinutes: 60,
    description: "過去問抜粋による試作総合演習（公共10問・政治10問・経済10問）",
  },
];
