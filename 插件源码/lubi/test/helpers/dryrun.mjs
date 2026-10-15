import * as C from "../.out/core.mjs"; import fs from "fs";
const dir = "/home/user/remote/日记"; let total = 0;
for (const f of fs.readdirSync(dir).sort()) {
  const date = f.replace(".md",""); const text = fs.readFileSync(`${dir}/${f}`, "utf8");
  const cards = C.parseLegacyCards(text, date); const out = C.convertText(text, date, cards);
  const back = C.parseLines(out, date); total += cards.length;
  const bad = back.length !== cards.length ? "  <-- MISMATCH" : "";
  console.log(`${date}: ${cards.length} cards -> ${back.length} lines, ${out.split("\n").length} lines total${bad}`);
  for (const b of back) console.log("    " + C.serializeRecord(b.rec));
  fs.mkdirSync("/home/user/lubi/test/out", { recursive: true }); fs.writeFileSync(`/home/user/lubi/test/out/${f}`, out);
}
console.log("total records:", total);
