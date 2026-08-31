#!/usr/bin/env node
/* 教材JSON（content/questions/*.json）から public/subjects/civics/questions.js を作る。
   - 生成物は直接編集しない。編集するのは content/questions/*.json のほう。
   - ファイル名順 → 各ファイル内の配列順で連結する。
   - ここでは「壊れた生成物を作らない」ための最低限だけを見る。
     出典・確認日・選択肢別解説など教材としての検査は validate:content が行う。 */
import fs from "node:fs";
import path from "node:path";

const SRC_DIR = path.join("content", "questions");
const OUT_FILE = path.join("public", "subjects", "civics", "questions.js");

function fail(message) {
  console.error(`build:questions: ${message}`);
  process.exit(1);
}

if (!fs.existsSync(SRC_DIR)) fail(`${SRC_DIR} がありません`);

const files = fs.readdirSync(SRC_DIR).filter((name) => name.endsWith(".json")).sort();
if (!files.length) fail(`${SRC_DIR} に .json がありません`);

const questions = [];
const seen = new Map();

for (const name of files) {
  const file = path.join(SRC_DIR, name);
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

fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
const banner = `/* 自動生成ファイル — 直接編集しないこと。
   元データ: ${SRC_DIR}/*.json
   生成コマンド: npm run build:questions
   生成日時: ${new Date().toISOString()}
   収録数: ${questions.length}問（${files.length}ファイル） */\n`;
fs.writeFileSync(OUT_FILE, `${banner}window.QUIZ_DATA = ${JSON.stringify(questions, null, 2)};\n`, "utf8");
console.log(`build:questions: ${questions.length} questions from ${files.length} file(s) -> ${OUT_FILE}`);
