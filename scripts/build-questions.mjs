#!/usr/bin/env node
/* 教材JSON（各科目の contentDir/*.json）から public/subjects/<id>/questions.js を作る。
   - 対象科目と入出力は public/subjects.js の contentDir / questions から決める。
   - 生成物は直接編集しない。編集するのは contentDir の JSON のほう。
   - ファイル名順 → 各ファイル内の配列順で連結する。
   - ここでは「壊れた生成物を作らない」ための最低限だけを見る。
     出典・確認日・選択肢別解説など教材としての検査は validate:content が行う。 */
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const MANIFEST = path.join("public", "subjects.js");

function fail(message) {
  console.error(`build:questions: ${message}`);
  process.exit(1);
}

function loadSubjects() {
  if (!fs.existsSync(MANIFEST)) fail(`${MANIFEST} がありません`);
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(MANIFEST, "utf8"), sandbox, { filename: MANIFEST });
  const subjects = sandbox.window.SUBJECTS;
  if (!Array.isArray(subjects) || !subjects.length) fail(`${MANIFEST} に科目がありません`);
  return subjects;
}

/* 1科目ぶんの生成。IDの重複は科目をまたいでも許さない（学習記録がIDで紐づくため）。 */
function build(subject, seen) {
  const srcDir = subject.contentDir;
  const outFile = path.join("public", subject.questions);
  if (!fs.existsSync(srcDir)) fail(`${srcDir} がありません（${subject.id}）`);

  const files = fs.readdirSync(srcDir).filter((name) => name.endsWith(".json")).sort();
  if (!files.length) fail(`${srcDir} に .json がありません`);

  const questions = [];
  for (const name of files) {
    const file = path.join(srcDir, name);
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (error) {
      fail(`${file}: JSONとして読めません (${error.message})`);
    }
    const rows = Array.isArray(parsed) ? parsed : parsed?.questions;
    if (!Array.isArray(rows)) fail(`${file}: 配列、または questions 配列を持つオブジェクトにしてください`);
    for (const [index, question] of rows.entries()) {
      const id = question?.id;
      if (typeof id !== "string" || !id.trim()) fail(`${file} の ${index + 1}件目: id がありません`);
      if (seen.has(id)) fail(`問題IDが重複しています: ${id}（${seen.get(id)} と ${file}）`);
      seen.set(id, file);
      questions.push(question);
    }
  }

  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  /* 見出しに生成日時は入れない。生成物をリポジトリに置いているので、
     中身が同じでもビルドのたびに差分が出てしまうため。 */
  const banner = `/* 自動生成ファイル — 直接編集しないこと。
   元データ: ${srcDir}/*.json
   生成コマンド: npm run build:questions
   収録数: ${questions.length}問（${files.length}ファイル） */\n`;
  fs.writeFileSync(outFile, `${banner}window.QUIZ_DATA = ${JSON.stringify(questions, null, 2)};\n`, "utf8");
  console.log(`build:questions: [${subject.id}] ${questions.length} questions from ${files.length} file(s) -> ${outFile}`);
}

const seen = new Map();
const targets = loadSubjects().filter((s) => s?.contentDir && s?.questions);
if (!targets.length) fail(`${MANIFEST} に contentDir を持つ科目がありません`);
for (const subject of targets) build(subject, seen);
