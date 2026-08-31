import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { pathToFileURL } from "node:url";

function loadBrowserData(filename, globalName, { optional = false } = {}) {
  if (optional && !fs.existsSync(filename)) return [];
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(filename, "utf8"), sandbox, { filename });
  const value = sandbox.window[globalName];
  if (!Array.isArray(value)) throw new Error(`${filename}: window.${globalName} が配列ではありません`);
  return value;
}

/* 問題の種別。選択問題は歴史的に type を持たないので、
   type:"constructed" が付いたものだけ記述問題として検査する。
   仕様: IMMUNOLOGY_WRITTEN_QUESTION_IMPLEMENTATION_PLAN.md §5.1・§15 */
export function questionType(q) {
  return q?.type === "constructed" ? "constructed" : "choice";
}

export function validateChoice(label, id, question, errors) {
  if (!Array.isArray(question.choices) || question.choices.length < 2) {
    errors.push(`[${label}] 問題 ${id}: 選択肢が不足しています`);
    return;
  }
  if (!Number.isInteger(question.answer) || question.answer < 0 || question.answer >= question.choices.length) errors.push(`[${label}] 問題 ${id}: 正解番号が範囲外です`);
  if (question.answers != null) {
    if (!Array.isArray(question.answers) || question.answers.length < 2) errors.push(`[${label}] 問題 ${id}: answers は2つ以上の配列にしてください`);
    else {
      if (question.answers[0] !== question.answer) errors.push(`[${label}] 問題 ${id}: answers[0] と answer が一致していません`);
      for (const a of question.answers) {
        if (!Number.isInteger(a) || a < 0 || a >= question.choices.length) errors.push(`[${label}] 問題 ${id}: answers に範囲外の番号があります`);
      }
      if (new Set(question.answers).size !== question.answers.length) errors.push(`[${label}] 問題 ${id}: answers に重複があります`);
    }
  }
}

export const DOMAINS = new Set(["公共", "政治", "経済"]);
export const SOURCE_TYPES = new Set(["common-new", "common-legacy", "center", "original"]);

/* 共通テスト「公共，政治・経済」の教材に固有の検査。
   仕様: 公共政治経済演習アプリ_実装計画 §7・§11
   出典・確認日・選択肢別解説がそろっていない問題を収録させない。 */
export function validateCivics(label, id, question, errors) {
  const e = (msg) => errors.push(`[${label}] 問題 ${id}: ${msg}`);

  if (!DOMAINS.has(question.domain)) e(`domain は ${[...DOMAINS].join(" / ")} のいずれかにしてください (${question.domain})`);
  if (!SOURCE_TYPES.has(question.sourceType)) e(`sourceType は ${[...SOURCE_TYPES].join(" / ")} のいずれかにしてください (${question.sourceType})`);
  if (!question.sourceLabel) e("sourceLabel（出典名）がありません");
  if (!question.field) e("field（分野）がありません");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(question.verifiedAt ?? ""))) {
    e(`verifiedAt は YYYY-MM-DD 形式の確認日にしてください (${question.verifiedAt})`);
  }
  if (!question.explanation) e("explanation（正解理由）がありません");

  // 選択肢別解説は「全選択肢ぶん」そろっていなければ、どれかが説明なしで出てしまう
  if (Array.isArray(question.choices)) {
    if (!Array.isArray(question.choiceNotes)) e("choiceNotes（選択肢別解説）がありません");
    else if (question.choiceNotes.length !== question.choices.length) {
      e(`choiceNotes の件数が選択肢と一致しません (${question.choiceNotes.length} / ${question.choices.length})`);
    } else if (question.choiceNotes.some((note) => !String(note ?? "").trim())) {
      e("choiceNotes に空の説明があります");
    }
  }

  // 図・表・グラフには必ず代替テキストを付ける（読み上げと画像欠損時のため）
  if (question.image && !String(question.imageAlt ?? "").trim()) e("image に imageAlt（代替テキスト）がありません");
  if (question.explainImage && !String(question.explainImageAlt ?? "").trim()) e("explainImage に explainImageAlt がありません");
  for (const [i, fig] of (question.groupFigures || []).entries()) {
    if (fig?.image && !String(fig.imageAlt ?? "").trim()) e(`groupFigures[${i}] に imageAlt がありません`);
  }
}

const PART_KINDS = new Set(["short-text", "long-text", "numeric", "drawing"]);

export function validateConstructed(label, id, question, errors) {
  const e = (msg) => errors.push(`[${label}] 記述問題 ${id}: ${msg}`);

  // 原本の配点が 2.5 点・3.5 点のように小数のことがあるので、整数までは求めない
  if (!Number.isFinite(question.points) || question.points <= 0) e(`points は正の数にしてください (${question.points})`);
  if (question.rubricSource !== "official" && question.rubricSource !== "derived") {
    e(`rubricSource は "official"（公式の採点細目）か "derived"（学習用に分解）のどちらかにしてください`);
  }
  if (!question.modelAnswer) e("modelAnswer（模範解答）がありません");

  const parts = Array.isArray(question.responseParts) ? question.responseParts : [];
  if (!parts.length) { e("responseParts が1件もありません"); return; }

  const partIds = new Set();
  for (const [i, part] of parts.entries()) {
    const pid = String(part?.id ?? `part-${i}`);
    const pe = (msg) => e(`回答パーツ ${pid}: ${msg}`);
    if (partIds.has(pid)) pe("パーツIDが重複しています");
    partIds.add(pid);
    if (!part?.label) pe("label がありません");
    if (!PART_KINDS.has(part?.kind)) { pe(`kind が不正です (${part?.kind}）。${[...PART_KINDS].join(" / ")} のいずれか`); continue; }

    if (part.kind === "short-text") {
      const list = Array.isArray(part.acceptedAnswers) ? part.acceptedAnswers.filter((s) => String(s).trim()) : [];
      if (!list.length) pe("acceptedAnswers を1件以上（別解・同義語も明示的に）書いてください");
    }
    if (part.kind === "numeric") {
      if (!Number.isFinite(part.expectedValue)) pe(`expectedValue が有限の数値ではありません (${part.expectedValue})`);
      const units = Array.isArray(part.acceptedUnits) ? part.acceptedUnits.filter((s) => String(s).trim()) : [];
      if (!units.length) pe("acceptedUnits を1件以上書いてください（単位は選択式にする）");
      const abs = part.absoluteTolerance, rel = part.relativeTolerance;
      if (abs == null && rel == null) pe("absoluteTolerance か relativeTolerance のどちらかを指定してください");
      if (abs != null && !(Number.isFinite(abs) && abs >= 0)) pe(`absoluteTolerance が不正です (${abs})`);
      if (rel != null && !(Number.isFinite(rel) && rel >= 0)) pe(`relativeTolerance が不正です (${rel})`);
    }
    if (part.kind === "drawing") {
      if (!part.modelImage) pe("modelImage（模範図）がありません");
      else if (!fs.existsSync(path.join("public", part.modelImage))) pe(`模範図の画像がありません (${part.modelImage})`);
      if (part.backgroundImage && !fs.existsSync(path.join("public", part.backgroundImage))) pe(`背景図の画像がありません (${part.backgroundImage})`);
      if (part.aspectRatio != null && !(Number.isFinite(part.aspectRatio) && part.aspectRatio > 0)) pe(`aspectRatio が不正です (${part.aspectRatio})`);
    }
  }

  const rubric = Array.isArray(question.rubric) ? question.rubric : [];
  if (!rubric.length) { e("rubric（採点基準）が1件もありません"); return; }

  const critIds = new Set();
  let sum = 0;
  for (const [i, crit] of rubric.entries()) {
    const cid = String(crit?.id ?? `criterion-${i}`);
    const ce = (msg) => e(`採点基準 ${cid}: ${msg}`);
    if (critIds.has(cid)) ce("採点基準IDが重複しています");
    critIds.add(cid);
    if (!crit?.text) ce("text（採点項目の文言）がありません");
    if (!Number.isFinite(crit?.points) || crit.points <= 0) ce(`points は正の数にしてください (${crit?.points}）`);
    else sum += crit.points;

    const refs = Array.isArray(crit?.partIds) ? crit.partIds : [];
    if (!refs.length) ce("partIds が空です（どの回答パーツを見る項目か指定する）");
    for (const ref of refs) if (!partIds.has(String(ref))) ce(`partIds が存在しない回答パーツを指しています (${ref})`);

    if (crit?.autoCheck) {
      const ac = crit.autoCheck;
      if (!["short-match", "numeric-match", "terms-present"].includes(ac.kind)) ce(`autoCheck.kind が不正です (${ac.kind})`);
      if (!partIds.has(String(ac.partId))) ce(`autoCheck.partId が存在しない回答パーツを指しています (${ac.partId})`);
      const target = parts.find((p) => String(p?.id) === String(ac.partId));
      if (target?.kind === "drawing") ce("作図パーツは自動判定しません（autoCheck を外す）");
      if (ac.kind === "terms-present") {
        const terms = Array.isArray(ac.terms) ? ac.terms.filter((s) => String(s).trim()) : [];
        if (!terms.length) ce("autoCheck.terms が空です");
        if (ac.mode !== "all" && ac.mode !== "any") ce(`autoCheck.mode は "all" か "any" にしてください (${ac.mode})`);
      }
    }
  }
  // 部分点の合計が満点と合っていないと、結果画面の「獲得点 / 満点」が破綻する
  if (Number.isFinite(question.points) && Math.abs(sum - question.points) > 1e-9) {
    e(`rubric の配点合計が満点と一致しません (${sum} / ${question.points})`);
  }
}

// テストから validateChoice / validateConstructed を import できるよう、
// 教材全体の検査は「直接実行されたときだけ」動かす。
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();

function main() {

const subjects = loadBrowserData("public/subjects.js", "SUBJECTS");
if (!subjects.length) throw new Error("public/subjects.js に科目が1つも登録されていません");
const examSets = loadBrowserData("public/subjects.js", "EXAM_SETS", { optional: true });

const errors = [];
const ids = new Set();          // IDは科目をまたいで一意でなければならない
                                // （進捗とFSRSの復習予定が問題IDで紐づいているため）
let totalQuestions = 0;
let totalTerms = 0;

for (const subject of subjects) {
  const label = subject.name || subject.id;
  // 新しい科目は "<id>-" で始まるIDを必須にする。既存科目は idPrefix:null で免除。
  const prefix = subject.idPrefix === null ? null : (subject.idPrefix || `${subject.id}-`);

  const questions = subject.questions
    ? loadBrowserData(path.join("public", subject.questions), "QUIZ_DATA")
    : [];
  const terms = subject.terms
    ? loadBrowserData(path.join("public", subject.terms), "TERM_CARDS", { optional: true })
    : [];
  totalQuestions += questions.length;
  totalTerms += terms.length;

  for (const [index, question] of questions.entries()) {
    const id = String(question?.id ?? `question-${index}`);
    if (ids.has(id)) errors.push(`[${label}] 問題IDが重複しています: ${id}`);
    ids.add(id);
    if (prefix && !id.startsWith(prefix)) errors.push(`[${label}] 問題ID ${id} は "${prefix}" で始めてください（科目をまたぐID衝突を防ぐため）`);
    if (!question?.question) errors.push(`[${label}] 問題 ${id}: 問題文がありません`);
    if (question.image && !fs.existsSync(path.join("public", question.image))) errors.push(`[${label}] 問題 ${id}: 画像がありません (${question.image})`);

    if (question.explainImage && !fs.existsSync(path.join("public", question.explainImage))) errors.push(`[${label}] 問題 ${id}: 解説画像がありません (${question.explainImage})`);
    for (const [i, fig] of (question.groupFigures || []).entries()) {
      if (fig?.image && !fs.existsSync(path.join("public", fig.image))) errors.push(`[${label}] 問題 ${id}: groupFigures[${i}] の画像がありません (${fig.image})`);
    }

    if (questionType(question) === "constructed") validateConstructed(label, id, question, errors);
    else validateChoice(label, id, question, errors);
    if (subject.contentProfile === "civics") validateCivics(label, id, question, errors);
  }

  // グループ問題（共通資料＋複数小問）の件数と並びが宣言どおりかを見る
  {
    const byGroup = new Map();
    for (const question of questions) {
      if (!question?.groupId) continue;
      if (!byGroup.has(question.groupId)) byGroup.set(question.groupId, []);
      byGroup.get(question.groupId).push(question);
    }
    for (const [groupId, members] of byGroup) {
      const declared = new Set(members.map((q) => q.groupSize).filter((n) => Number.isInteger(n)));
      if (declared.size > 1) errors.push(`[${label}] グループ ${groupId}: groupSize が小問ごとに食い違っています`);
      const size = [...declared][0];
      if (size != null && size !== members.length) {
        errors.push(`[${label}] グループ ${groupId}: 小問数が groupSize と一致しません (${members.length} / ${size})`);
      }
      const orders = members.map((q) => q.groupOrder);
      if (orders.some((n) => !Number.isInteger(n))) errors.push(`[${label}] グループ ${groupId}: groupOrder が整数でない小問があります`);
      else if (new Set(orders).size !== orders.length) errors.push(`[${label}] グループ ${groupId}: groupOrder が重複しています`);
    }
  }

  const slidePath = (deck, page) =>
    path.join("public", "images", subject.id, "slides", `${deck}-p${String(page).padStart(3, "0")}.webp`);

  // 根拠スライド（「解説をさらに見る」）。指定したページの画像が無いと図が欠ける。
  const decks = new Set();
  for (const question of questions) {
    for (const ref of question?.slideRefs || []) {
      if (!ref?.deck) continue;
      decks.add(String(ref.deck));
      for (const page of ref.pages || []) {
        const file = slidePath(ref.deck, page);
        if (!fs.existsSync(file)) errors.push(`[${label}] 問題 ${question.id}: 根拠スライドの画像がありません (${file})`);
      }
    }
  }

  // 「学習」画面の要点テキスト。deck は問題の slideRefs と一致していなければ
  // 章と問題が結びつかず、参照したスライド画像が無ければ図が欠ける。
  const lessons = subject.lessons
    ? loadBrowserData(path.join("public", subject.lessons), "LESSONS", { optional: true })
    : [];
  if (lessons.length) {
    const seenDecks = new Set();
    for (const [index, lesson] of lessons.entries()) {
      const deck = String(lesson?.deck ?? "");
      if (!deck) { errors.push(`[${label}] 学習 ${index + 1}件目: deck がありません`); continue; }
      if (seenDecks.has(deck)) errors.push(`[${label}] 学習 deck ${deck} が重複しています`);
      seenDecks.add(deck);
      // standalone:true は授業回ではない読み物の章（例：用語編）なので、対応する問題が無くてよい。
      if (!decks.has(deck) && !lesson.standalone) {
        errors.push(`[${label}] 学習 deck ${deck}: この deck を持つ問題（slideRefs）がありません`);
      }
      const pages = [...(lesson.keySlides || [])];
      for (const [sectionIndex, section] of (lesson.sections || []).entries()) {
        pages.push(...(section?.slides || []));

        // 表ブロックは列数がずれると行がまるごと欠けて見えるため、ヘッダとの一致を検査する。
        const table = section?.table;
        if (table) {
          const sectionLabel = `学習 deck ${deck} 第${sectionIndex + 1}項目`;
          if (!Array.isArray(table.rows) || !table.rows.length) {
            errors.push(`[${label}] ${sectionLabel}: table.rows が空です`);
          } else if (Array.isArray(table.headers) && table.headers.length) {
            for (const [rowIndex, row] of table.rows.entries()) {
              if (!Array.isArray(row) || row.length !== table.headers.length) {
                errors.push(`[${label}] ${sectionLabel}: table 第${rowIndex + 1}行の列数が headers（${table.headers.length}列）と一致しません`);
              }
            }
          }
        }

        // 第14回以降の免疫学学習コンテンツでは、重要語を ==...== で囲み赤字表示する。
        // 覚えることの指定漏れは見た目だけでは気づきにくいため、全箇条書きを検査する。
        if (subject.id === "immunology2" && Number(deck) >= 14) {
          const body = String(section?.body || "");
          const [part1, afterPart1] = body.split("【2】覚えること");
          const [part2, part3] = (afterPart1 || "").split("【3】試験ではこう出る");
          const sectionLabel = `学習 deck ${deck} 第${sectionIndex + 1}項目`;
          const emphasis = /==[^=\n]+==/;
          if (afterPart1 == null || part3 == null) {
            errors.push(`[${label}] ${sectionLabel}: 3部構成の見出しが足りません`);
          } else {
            if ((part1.match(/==/g) || []).length) {
              errors.push(`[${label}] ${sectionLabel}: 赤字は「覚えること」以降に限定してください`);
            }
            const bullets = part2.split("\n").map((line) => line.trim()).filter((line) => line.startsWith("・"));
            if (!bullets.length) errors.push(`[${label}] ${sectionLabel}: 「覚えること」の箇条書きがありません`);
            for (const [bulletIndex, bullet] of bullets.entries()) {
              if (!emphasis.test(bullet)) {
                errors.push(`[${label}] ${sectionLabel}: 「覚えること」${bulletIndex + 1}行目に赤字の重要語がありません`);
              }
            }
            if (!emphasis.test(part3)) {
              errors.push(`[${label}] ${sectionLabel}: 「試験ではこう出る」に赤字の重要語がありません`);
            }
            if ((body.match(/==/g) || []).length % 2 !== 0) {
              errors.push(`[${label}] ${sectionLabel}: 赤字記号 == が閉じていません`);
            }
          }
        }
      }
      for (const page of pages) {
        // "08a:15" と書くと同じ回の別デッキ（前半コマ）のページを参照できる
        const ref = /^([0-9A-Za-z]+):(\d+)$/.exec(String(page));
        const file = ref ? slidePath(ref[1], ref[2]) : slidePath(deck, page);
        if (!fs.existsSync(file)) errors.push(`[${label}] 学習 deck ${deck}: スライド画像がありません (${file})`);
      }
    }
  }

  for (const [index, term] of terms.entries()) {
    const id = String(term?.id ?? `term-${index}`);
    if (ids.has(id)) errors.push(`[${label}] カードIDが重複しています: ${id}`);
    ids.add(id);
    if (!term?.term) errors.push(`[${label}] 用語カード ${id}: 表面がありません`);
    if (term.image && !fs.existsSync(path.join("public", term.image))) errors.push(`[${label}] 用語カード ${id}: 画像がありません (${term.image})`);
  }

  // 総合演習セット（window.EXAM_SETS）に宣言した問題数と、実際の収録数を突き合わせる
  for (const set of examSets) {
    const members = questions.filter((q) => q?.examSetId === set.id);
    if (!members.length) continue;
    if (typeof set.questionCount === "number" && members.length !== set.questionCount) {
      errors.push(`[${label}] 総合演習 ${set.id}: 問題数が想定と異なります: ${members.length} / ${set.questionCount}`);
    }
    if (!(Number(set.durationMinutes) > 0)) errors.push(`[${label}] 総合演習 ${set.id}: durationMinutes が正の数ではありません`);
  }

  // 分野（公共・政治・経済）の配分。均等配分を宣言した科目だけ検査する。
  if (subject.expectDomainCounts) {
    const counts = {};
    for (const question of questions) counts[question?.domain] = (counts[question?.domain] || 0) + 1;
    for (const [domain, want] of Object.entries(subject.expectDomainCounts)) {
      const got = counts[domain] || 0;
      if (got !== want) errors.push(`[${label}] ${domain} の問題数が想定と異なります: ${got} / ${want}`);
    }
  }

  if (typeof subject.expectQuestions === "number" && questions.length !== subject.expectQuestions) {
    errors.push(`[${label}] 問題数が想定と異なります: ${questions.length} / ${subject.expectQuestions}`);
  }
  if (typeof subject.expectTerms === "number" && terms.length !== subject.expectTerms) {
    errors.push(`[${label}] 用語カード数が想定と異なります: ${terms.length} / ${subject.expectTerms}`);
  }
  // draft の科目はこれから中身を入れるところなので、0件でもエラーにしない
  if (!subject.draft && !questions.length && !terms.length) errors.push(`[${label}] 問題もカードも0件です`);
}

if (errors.length) {
  console.error(errors.slice(0, 50).join("\n"));
  process.exit(1);
}
console.log(`Content OK: ${subjects.length} subject(s), ${totalQuestions} questions, ${totalTerms} term cards, ${ids.size} unique IDs.`);

}
