const fs = require("fs");
const path = require("path");

function slug(s) {
  return String(s)
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

const src = path.join(__dirname, "..", "tarot-json-master", "tarot-images.json");
const out = path.join(__dirname, "..", "public", "tarot", "deck.json");

const j = JSON.parse(fs.readFileSync(src, "utf8"));
const cards = Array.isArray(j?.cards) ? j.cards : [];

const deck = cards.map((c, i) => {
  const idx = String(i).padStart(2, "0");
  const sl = slug(c.name);
  const file = `${idx}-${sl}.jpg`;
  return {
    id: i,
    index: idx,
    name: c.name,
    slug: sl,
    file,
    src: `/tarot/${file}`,
  };
});

fs.writeFileSync(out, JSON.stringify({ version: 1, deck }, null, 2));
console.log(`wrote ${deck.length} cards to ${out}`);

