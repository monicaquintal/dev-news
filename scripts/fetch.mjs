// Coletor de feeds RSS/Atom -> public/news.json (Node 18+, sem dependências)
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MAX_ITEMS = 200;
const PER_SOURCE = 15;
const MAX_AGE_DAYS = 10;
const FEED_TIMEOUT = 15000;
const OG_TIMEOUT = 6000;
const OG_LIMIT = 40; // máximo de páginas consultadas atrás de og:image
const UA = "dev-news-bot/1.0 (agregador pessoal de RSS)";

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", hellip: "…", ndash: "–", mdash: "—", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“" };

// entidades acentuadas (aacute, atilde, ccedil...) geradas a partir da tabela base
for (const [b, vs] of Object.entries({ a: "áàâãä", e: "éèêë", i: "íìîï", o: "óòôõö", u: "úùûü", c: "ç", n: "ñ", A: "ÁÀÂÃÄ", E: "ÉÈÊË", I: "ÍÌÎÏ", O: "ÓÒÔÕÖ", U: "ÚÙÛÜ", C: "Ç", N: "Ñ" })) {
  const sfx = { "á": "acute", "à": "grave", "â": "circ", "ã": "tilde", "ä": "uml", "é": "acute", "è": "grave", "ê": "circ", "ë": "uml", "í": "acute", "ì": "grave", "î": "circ", "ï": "uml", "ó": "acute", "ò": "grave", "ô": "circ", "õ": "tilde", "ö": "uml", "ú": "acute", "ù": "grave", "û": "circ", "ü": "uml", "ç": "cedil", "ñ": "tilde", "Á": "acute", "À": "grave", "Â": "circ", "Ã": "tilde", "Ä": "uml", "É": "acute", "È": "grave", "Ê": "circ", "Ë": "uml", "Í": "acute", "Ì": "grave", "Î": "circ", "Ï": "uml", "Ó": "acute", "Ò": "grave", "Ô": "circ", "Õ": "tilde", "Ö": "uml", "Ú": "acute", "Ù": "grave", "Û": "circ", "Ü": "uml", "Ç": "cedil", "Ñ": "tilde" };
  for (const v of vs) ENTITIES[b + sfx[v]] = v;
}
Object.assign(ENTITIES, { ordm: "º", ordf: "ª", laquo: "«", raquo: "»", middot: "·", bull: "•", copy: "©", reg: "®", euro: "€", sbquo: "‚", bdquo: "„" });

function decode(s = "") {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m);
}

function unwrap(s = "") {
  const m = s.match(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/);
  return m ? m[1] : decode(s);
}

function stripHtml(html = "") {
  return decode(
    html
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<[^>]+>/g, " ")
  ).replace(/\s+/g, " ").trim();
}

function truncate(text, max = 280) {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  return cut.slice(0, cut.lastIndexOf(" ") > 120 ? cut.lastIndexOf(" ") : max).replace(/[\s,.;:–-]+$/, "") + "…";
}

function tag(block, name) {
  const re = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i");
  const m = block.match(re);
  return m ? unwrap(m[1]) : "";
}

function attr(block, name, attrName) {
  const re = new RegExp(`<${name}\\b([^>]*)>`, "gi");
  const out = [];
  let m;
  while ((m = re.exec(block))) {
    const a = m[1].match(new RegExp(`${attrName}\\s*=\\s*["']([^"']+)["']`, "i"));
    if (a) out.push({ value: decode(a[1]), raw: m[1] });
  }
  return out;
}

function firstImage(block, html) {
  for (const n of ["media:content", "media:thumbnail"]) {
    for (const { value, raw } of attr(block, n, "url")) {
      if (/medium\s*=\s*["']?(video|audio)/i.test(raw)) continue;
      return value;
    }
  }
  for (const { value, raw } of attr(block, "enclosure", "url")) {
    if (/type\s*=\s*["']image/i.test(raw) || /\.(jpe?g|png|webp|gif)(\?|$)/i.test(value)) return value;
  }
  const m = html.match(/<img[^>]+src\s*=\s*["']([^"']+)["']/i);
  return m ? decode(m[1]) : "";
}

function parseFeed(xml, src) {
  const blocks = xml.match(/<(item|entry)[\s>][\s\S]*?<\/\1>/gi) || [];
  const items = [];
  for (const b of blocks) {
    const title = stripHtml(tag(b, "title"));
    let link = tag(b, "link").trim();
    if (!link) {
      const alt = attr(b, "link", "href");
      const pick = alt.find((a) => !/rel\s*=\s*["'](?!alternate)/i.test(a.raw)) || alt[0];
      link = pick ? pick.value : "";
    }
    if (!title || !/^https?:\/\//.test(link)) continue;
    const html = tag(b, "content:encoded") || tag(b, "content") || tag(b, "description") || tag(b, "summary");
    const date = new Date(tag(b, "pubDate") || tag(b, "published") || tag(b, "updated") || tag(b, "dc:date"));
    if (isNaN(date)) continue;
    let summary = truncate(stripHtml(tag(b, "description") || tag(b, "summary") || html));
    if (summary.toLowerCase().startsWith(title.toLowerCase().slice(0, 40)) && summary.length < title.length + 20) summary = "";
    // Hacker News e similares só trazem links de comentários
    if (/^(Article URL|Comments URL|Points:)/i.test(summary)) summary = "";
    items.push({
      title,
      url: link,
      source: src.name,
      category: src.category,
      lang: src.lang,
      date: date.toISOString(),
      summary,
      image: firstImage(b, html),
    });
  }
  return items;
}

async function get(url, timeout) {
  const res = await fetch(url, {
    headers: { "user-agent": UA, accept: "application/rss+xml, application/atom+xml, application/xml, text/html;q=0.8, */*;q=0.5" },
    signal: AbortSignal.timeout(timeout),
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

async function ogImage(url) {
  try {
    const html = (await get(url, OG_TIMEOUT)).slice(0, 60000);
    const m = html.match(/<meta[^>]+(?:property|name)=["']og:image["'][^>]*content=["']([^"']+)["']/i)
      || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["']og:image["']/i);
    if (!m) return "";
    return new URL(decode(m[1]), url).href;
  } catch {
    return "";
  }
}

// Tradução EN -> PT offline (Argos + ctranslate2) via scripts/translate.py, em lote.
function translateBatch(titles) {
  if (!titles.length) return {};
  const r = spawnSync("python3", [resolve(ROOT, "scripts/translate.py")], {
    input: JSON.stringify(titles), encoding: "utf8", maxBuffer: 32 * 1024 * 1024, timeout: 10 * 60 * 1000,
  });
  if (r.status !== 0) {
    console.warn("tradução indisponível:", (r.stderr || String(r.error)).trim().split("\n").pop());
    return {};
  }
  try { return JSON.parse(r.stdout); } catch { return {}; }
}

const normTitle =(t) => t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

async function main() {
  const sources = JSON.parse(await readFile(resolve(ROOT, "sources.json"), "utf8"));
  const cutoff = Date.now() - MAX_AGE_DAYS * 864e5;
  const status = [];

  const results = await Promise.all(
    sources.map(async (src) => {
      try {
        const xml = await get(src.url, FEED_TIMEOUT);
        let items = parseFeed(xml, src);
        if (src.filter) {
          const re = new RegExp(src.filter, "i");
          items = items.filter((i) => re.test(`${i.title} ${i.summary}`));
        }
        items = items.filter((i) => +new Date(i.date) >= cutoff && +new Date(i.date) <= Date.now() + 36e5)
          .sort((a, b) => b.date.localeCompare(a.date))
          .slice(0, PER_SOURCE);
        status.push(`ok   ${src.name}: ${items.length}`);
        return items;
      } catch (e) {
        status.push(`FALHA ${src.name}: ${e.message}`);
        return [];
      }
    })
  );

  // dedupe por URL e título
  const seenUrl = new Set();
  const seenTitle = new Set();
  const all = results.flat().sort((a, b) => b.date.localeCompare(a.date)).filter((i) => {
    const u = i.url.replace(/[?#].*$/, "").replace(/\/$/, "");
    const t = normTitle(i.title);
    if (seenUrl.has(u) || seenTitle.has(t)) return false;
    seenUrl.add(u);
    seenTitle.add(t);
    return true;
  }).slice(0, MAX_ITEMS);

  // imagens faltantes via og:image (apenas para itens mais recentes, e só quando o feed tem resumo ou é fonte de notícia)
  const missing = all.filter((i) => !i.image && i.source !== "Hacker News" && i.source !== "Lobsters").slice(0, OG_LIMIT);
  await Promise.all(missing.map(async (i) => { i.image = await ogImage(i.url); }));

  // tradução dos títulos em inglês (com cache para não retraduzir a cada coleta)
  const cachePath = resolve(ROOT, ".cache/translations.json");
  let cache = {};
  try { cache = JSON.parse(await readFile(cachePath, "utf8")); } catch {}
  const toTranslate = all.filter((i) => i.lang === "en");
  const pending = toTranslate.filter((i) => !cache[i.title]);
  const done = translateBatch([...new Set(pending.map((i) => i.title))]);
  let failed = 0;
  for (const i of pending) { if (done[i.title]) cache[i.title] = done[i.title]; else failed++; }
  for (const i of toTranslate) {
    const t = cache[i.title];
    if (t && normTitle(t) !== normTitle(i.title)) i.titlePt = t;
  }
  // mantém no cache só o que está em uso
  const keep = new Set(toTranslate.map((i) => i.title));
  cache = Object.fromEntries(Object.entries(cache).filter(([k]) => keep.has(k)));
  await mkdir(dirname(cachePath), { recursive: true });
  await writeFile(cachePath, JSON.stringify(cache));
  console.log(`traduções: ${pending.length - failed} novas, ${failed} falhas, ${toTranslate.length - pending.length} do cache`);

  // força https nas imagens quando possível
  for (const i of all) if (i.image.startsWith("http://")) i.image = "https://" + i.image.slice(7);

  await mkdir(resolve(ROOT, "public"), { recursive: true });
  await writeFile(resolve(ROOT, "public/news.json"), JSON.stringify({ updated: new Date().toISOString(), items: all }));
  console.log(status.sort().join("\n"));
  console.log(`\n${all.length} notícias, ${all.filter((i) => i.image).length} com imagem, ${all.filter((i) => i.summary).length} com resumo`);
}

main().catch((e) => { console.error(e); process.exit(1); });
