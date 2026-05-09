const fs = require("fs");
const path = require("path");

const srcJson = path.join(__dirname, "..", "tarot-json-master", "tarot-images.json");
const srcCardsDir = path.join(__dirname, "..", "tarot-json-master", "cards");
const outDir = path.join(__dirname, "..", "public", "tarot");

if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

const j = JSON.parse(fs.readFileSync(srcJson, "utf8"));
const cards = Array.isArray(j?.cards) ? j.cards : [];

function slug(s) {
  return String(s)
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

for (let i = 0; i < cards.length; i++) {
  const c = cards[i];
  const idx = String(i).padStart(2, "0");
  const out = `${idx}-${slug(c.name)}.jpg`;
  const src = path.join(srcCardsDir, c.img);
  const dst = path.join(outDir, out);
  fs.copyFileSync(src, dst);
}

console.log(`copied ${cards.length} cards to ${outDir}`);

