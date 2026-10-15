// Write HTML pages for the layout tests.
// Chrome on a Chinese-locale Windows guesses the encoding of pages without a charset (GBK),
// which garbles Chinese text and changes text metrics, so every test page declares UTF-8.
import { writeFileSync } from "node:fs";

const CHARSET = '<meta charset="utf-8">';

export function ensureCharset(html) {
  if (/<meta\s+charset=/i.test(html.slice(0, 1024))) return html;
  if (/<head(\s[^>]*)?>/i.test(html)) return html.replace(/<head(\s[^>]*)?>/i, (tag) => tag + CHARSET);
  if (/<html(\s[^>]*)?>/i.test(html)) return html.replace(/<html(\s[^>]*)?>/i, (tag) => `${tag}<head>${CHARSET}</head>`);
  const doctype = /^\s*<!doctype html>/i.exec(html);
  return doctype ? doctype[0] + CHARSET + html.slice(doctype[0].length) : CHARSET + html;
}

/** Like writeFileSync, but .html files always get a UTF-8 charset declaration near the top. */
export function writePage(file, content, encoding = "utf8") {
  const page = typeof content === "string" && String(file).toLowerCase().endsWith(".html");
  writeFileSync(file, page ? ensureCharset(content) : content, encoding);
}
