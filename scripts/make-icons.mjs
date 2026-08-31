#!/usr/bin/env node
/* アプリのアイコンを1枚のSVGから作り直す。
   医学アプリと同じアイコンだと、ホーム画面に両方を置いたときに見分けがつかない。
   配色は本体と同じ紺・青緑・金。天秤（公正・法）をかたどっている。
   使い方: node scripts/make-icons.mjs */
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const OUT = path.join("public", "icons");

/** @param {boolean} maskable セーフゾーンを確保するため図案を小さくする */
function svg(maskable) {
  const s = maskable ? 0.72 : 0.86;          // 図案の占める割合
  const t = (1 - s) / 2 * 512;               // 余白
  const g = (v) => (t + v * s).toFixed(1);   // 512基準の座標を余白込みへ写す
  return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#12304f"/>
      <stop offset="0.55" stop-color="#123f55"/>
      <stop offset="1" stop-color="#0f6d80"/>
    </linearGradient>
    <!-- 水平・垂直な線は境界ボックスの高さ／幅が0になり、
         既定の objectBoundingBox では塗りが決まらず描かれない。必ず userSpaceOnUse にする。 -->
    <linearGradient id="gold" gradientUnits="userSpaceOnUse" x1="0" y1="120" x2="0" y2="400">
      <stop offset="0" stop-color="#f0d68a"/>
      <stop offset="1" stop-color="#b8860b"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" rx="${maskable ? 0 : 112}" fill="url(#bg)"/>
  <g stroke="url(#gold)" stroke-width="${(16 * s).toFixed(1)}" stroke-linecap="round" stroke-linejoin="round" fill="none">
    <!-- 支柱 -->
    <path d="M ${g(256)} ${g(132)} L ${g(256)} ${g(372)}"/>
    <!-- 台座 -->
    <path d="M ${g(180)} ${g(392)} L ${g(332)} ${g(392)}"/>
    <path d="M ${g(256)} ${g(372)} L ${g(206)} ${g(392)}"/>
    <path d="M ${g(256)} ${g(372)} L ${g(306)} ${g(392)}"/>
    <!-- 竿 -->
    <path d="M ${g(112)} ${g(166)} L ${g(400)} ${g(166)}"/>
    <!-- 左右の皿 -->
    <path d="M ${g(112)} ${g(166)} L ${g(66)} ${g(258)} L ${g(158)} ${g(258)} Z"/>
    <path d="M ${g(400)} ${g(166)} L ${g(354)} ${g(258)} L ${g(446)} ${g(258)} Z"/>
  </g>
  <circle cx="${g(256)}" cy="${g(132)}" r="${(26 * s).toFixed(1)}" fill="url(#gold)"/>
</svg>`;
}

const TARGETS = [
  { file: "icon-192.png", size: 192, maskable: false },
  { file: "icon-512.png", size: 512, maskable: false },
  { file: "maskable-192.png", size: 192, maskable: true },
  { file: "maskable-512.png", size: 512, maskable: true },
  { file: "apple-touch-icon.png", size: 180, maskable: false },
  { file: "favicon-48.png", size: 48, maskable: false },
  { file: "favicon-32.png", size: 32, maskable: false },
];

fs.mkdirSync(OUT, { recursive: true });
for (const { file, size, maskable } of TARGETS) {
  const png = await sharp(Buffer.from(svg(maskable))).resize(size, size).png({ compressionLevel: 9 }).toBuffer();
  fs.writeFileSync(path.join(OUT, file), png);
  console.log(`make-icons: ${path.join(OUT, file)} (${size}x${size}${maskable ? ", maskable" : ""})`);
}
