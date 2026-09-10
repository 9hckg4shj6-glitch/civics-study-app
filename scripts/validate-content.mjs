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

/* 化学（docs/化学科目_実装計画.md §2・§3） */
export const CHEM_DOMAINS = new Set(["理論化学", "無機化学", "有機化学", "高分子化合物"]);
export const CHEM_SOURCE_TYPES = new Set(["common-test", "center", "national", "private", "original"]);
export const ASK_TYPES = new Set(["correct", "incorrect", "true-false"]);

/* 教材として最低限そろえる項目（科目共通）。
   出典・分類・確認日・選択肢別解説がそろっていない問題を収録させない。 */
export function validateContentCore(label, id, question, errors) {
  const e = (msg) => errors.push(`[${label}] 問題 ${id}: ${msg}`);

  if (!question.sourceLabel) e("sourceLabel（出典名）がありません");
  if (!question.field) e("field（分野）がありません");
  if (!question.topic) e("topic（主題）がありません");
  // 一覧は設問文ではなく listTitle を並べるので、無いと長い設問文がそのまま出てしまう
  const listTitle = String(question.listTitle ?? "").trim();
  if (!listTitle) e("listTitle（一覧用の短い問題名）がありません");
  else if (!/問題$/.test(listTitle)) e(`listTitle は「〜に関する◯◯問題」の形にしてください (${listTitle})`);
  else if (listTitle.length > 40) e(`listTitle が長すぎます（40字以内） (${listTitle.length}字)`);
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
  // 問題文に入れる図（リード文・実験の図・構造式）
  for (const [i, fig] of (question.stemImages || []).entries()) {
    if (!fig?.src) e(`stemImages[${i}] に src がありません`);
    else if (!String(fig.alt ?? "").trim()) e(`stemImages[${i}] に alt（代替テキスト）がありません`);
  }
  // 図をもつ問題文は見出しを付ける（何の図なのかが分かる名前にする）
  if ((question.stemImages || []).length && !String(question.stemTitle ?? "").trim()) {
    e("stemImages があるのに stemTitle（問題文の見出し）がありません");
  }
  // 問題文は畳まずに開いた状態から始める決まりにしたので、stemClosed は使わない
  if ("stemClosed" in question) {
    e("stemClosed は使いません（問題文は開いた状態から始め、畳むかどうかは読む人に任せます）");
  }

  /* 選択肢そのものが図である問題（化学の構造式・反応式）。
     choices と同じ長さ・同じ並びで持たせる。ずれると別の式を指したまま採点してしまう。
     図を持たない選択肢は null を置く。 */
  if (question.choiceImages != null) {
    if (!Array.isArray(question.choiceImages)) e("choiceImages は配列にしてください");
    else if (Array.isArray(question.choices) && question.choiceImages.length !== question.choices.length) {
      e(`choiceImages の件数が選択肢と一致しません (${question.choiceImages.length} / ${question.choices.length})`);
    } else {
      for (const [i, fig] of question.choiceImages.entries()) {
        if (fig == null) continue;
        if (!fig.src) e(`choiceImages[${i}] に src がありません（図が無い選択肢は null にしてください）`);
        else if (!String(fig.alt ?? "").trim()) e(`choiceImages[${i}] に alt（代替テキスト）がありません`);
      }
    }
  }
}

/* 共通テスト「公共，政治・経済」の教材に固有の検査。
   仕様: 公共政治経済演習アプリ_実装計画 §7・§11 */
export function validateCivics(label, id, question, errors) {
  const e = (msg) => errors.push(`[${label}] 問題 ${id}: ${msg}`);
  if (!DOMAINS.has(question.domain)) e(`domain は ${[...DOMAINS].join(" / ")} のいずれかにしてください (${question.domain})`);
  if (!SOURCE_TYPES.has(question.sourceType)) e(`sourceType は ${[...SOURCE_TYPES].join(" / ")} のいずれかにしてください (${question.sourceType})`);
  validateContentCore(label, id, question, errors);
}

/* 化学の教材に固有の検査。仕様: docs/化学科目_実装計画.md §2・§3・§5
   化学は「正誤問題」「正しいものを選べ」「誤っているものを選べ」だけを集める科目なので、
   問い方（askType）を必須にして、演習画面の「問い方別」から必ず引けるようにする。 */
export function validateChemistry(label, id, question, errors) {
  const e = (msg) => errors.push(`[${label}] 問題 ${id}: ${msg}`);

  if (!CHEM_DOMAINS.has(question.domain)) e(`domain は ${[...CHEM_DOMAINS].join(" / ")} のいずれかにしてください (${question.domain})`);
  if (!CHEM_SOURCE_TYPES.has(question.sourceType)) e(`sourceType は ${[...CHEM_SOURCE_TYPES].join(" / ")} のいずれかにしてください (${question.sourceType})`);
  if (!ASK_TYPES.has(question.askType)) e(`askType は ${[...ASK_TYPES].join(" / ")} のいずれかにしてください (${question.askType})`);
  // 過去問には必ず年度を入れる（年度別演習に出せなくなるため）。自作問題は年度を持たない。
  if (question.sourceType !== "original" && !/^\d{4}年度$/.test(String(question.year ?? ""))) {
    e(`year は「2024年度」のように西暦の年度で書いてください (${question.year})`);
  }
  validateContentCore(label, id, question, errors);

  /* 選択肢の並べ替え事故を防ぐ。「a 正・b 誤」型の組合せや、
     「①と②」「すべて正しい」のように順序へ依存する選択肢は shuffle すると壊れる。 */
  const choices = Array.isArray(question.choices) ? question.choices.map((c) => String(c ?? "")) : [];
  const orderDependent = question.askType === "true-false"
    || choices.some((c) => /[①-⑨]|すべて|いずれも|上記|正しいものはない/.test(c));
  if (orderDependent && question.noShuffle !== true) {
    e("選択肢の順序に依存する問題です。noShuffle: true を付けてください");
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
    if (subject.contentProfile === "chemistry") validateChemistry(label, id, question, errors);
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
