import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const directory = path.resolve("public/images");
const names = (await fs.readdir(directory)).filter((name) => name.endsWith(".png"));

for (let index = 0; index < names.length; index += 8) {
  await Promise.all(names.slice(index, index + 8).map(async (name) => {
    const source = path.join(directory, name);
    const destination = path.join(directory, name.replace(/\.png$/, ".webp"));
    await sharp(source).webp({ quality: 82, effort: 5 }).toFile(destination);
  }));
}

console.log(`Converted ${names.length} PNG files to WebP.`);
