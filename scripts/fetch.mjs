// Coletor de feeds RSS/Atom -> public/news.json (Node 18+, sem dependências)
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MAX_ITEMS = 200;
const PER_SOURCE = 15;
const REGIONAL_LIMIT = 40; // notícias da Baixada Santista mantidas, além das MAX_ITEMS
const MAX_AGE_DAYS = 10;
const FEED_TIMEOUT = 15000;
const OG_TIMEOUT = 6000;
const OG_LIMIT = 80; // máximo de páginas consultadas atrás de imagem e resumo faltantes
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
      .replace(/<!\[CDATA\[|\]\]>/g, " ")
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
    // Google Notícias: o título vem como "Manchete - Veículo" e a descrição é só uma lista de links
    let name = src.name, finalTitle = title;
    if (src.googleNews) {
      const veiculo = stripHtml(tag(b, "source"));
      if (veiculo) {
        name = veiculo;
        if (title.endsWith(` - ${veiculo}`)) finalTitle = title.slice(0, -(veiculo.length + 3));
      }
      summary = "";
    }
    // Hacker News e similares só trazem links de comentários
    if (/^(Article URL|Comments URL|Points:)/i.test(summary)) summary = "";
    items.push({
      title: finalTitle,
      url: link,
      source: name,
      gnews: !!src.googleNews || undefined,
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

// lê a página da notícia e devolve a imagem (og:image) e a descrição (og:description / description)
async function pageMeta(url) {
  try {
    const html = (await get(url, OG_TIMEOUT)).slice(0, 80000);
    const meta = (names) => {
      for (const n of names) {
        const m = html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${n}["'][^>]*content=["']([^"']+)["']`, "i"))
          || html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["']${n}["']`, "i"));
        if (m) return decode(m[1]);
      }
      return "";
    };
    const img = meta(["og:image", "twitter:image"]);
    return {
      image: img ? new URL(img, url).href : "",
      description: truncate(stripHtml(meta(["og:description", "description", "twitter:description"]))),
    };
  } catch {
    return { image: "", description: "" };
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

  // bloqueio de propaganda/ofertas (filters.json): regex no título e na URL
  let blockTitle = [], blockUrl = [];
  try {
    const f = JSON.parse(await readFile(resolve(ROOT, "filters.json"), "utf8"));
    blockTitle = (f.blockTitle || []).map((p) => new RegExp(p, "i"));
    blockUrl = (f.blockUrl || []).map((p) => new RegExp(p, "i"));
  } catch {}
  const isAd = (i) => blockTitle.some((r) => r.test(i.title)) || blockUrl.some((r) => r.test(i.url));
  let blocked = 0;
  // padrões nomeados em filters.json ("@tech", "@regiao") reaproveitados por várias fontes
  let named = {};
  try { named = JSON.parse(await readFile(resolve(ROOT, "filters.json"), "utf8")).patterns || {}; } catch {}
  const pattern = (p) => (p.startsWith("@") ? named[p.slice(1)] ?? "$^" : p);

  const results = await Promise.all(
    sources.map(async (src) => {
      try {
        const xml = await get(src.url, FEED_TIMEOUT);
        let items = parseFeed(xml, src);
        if (src.filter) {
          const re = new RegExp(pattern(src.filter), "i");
          items = items.filter((i) => re.test(src.filterOn === "title" ? i.title : `${i.title} ${i.summary}`));
        }
        if (src.region) {
          const rr = new RegExp(pattern(src.region), "i");
          items = items.filter((i) => rr.test(i.title));
        }
        if (src.exclude) {
          const ex = new RegExp(src.exclude, "i");
          items = items.filter((i) => !ex.test(i.title));
        }
        const before = items.length;
        items = items.filter((i) => !isAd(i));
        blocked += before - items.length;
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
  // gnews por último na ordenação, para que o feed direto (com imagem) vença o duplicado
  const deduped = results.flat().sort((a, b) => b.date.localeCompare(a.date) || (a.gnews ? 1 : 0) - (b.gnews ? 1 : 0)).filter((i) => {
    const u = i.url.replace(/[?#].*$/, "").replace(/\/$/, "");
    const t = normTitle(i.title);
    if (seenUrl.has(u) || seenTitle.has(t)) return false;
    seenUrl.add(u);
    seenTitle.add(t);
    return true;
  });
  // a seção regional tem cota própria, para não ser engolida pelo volume das fontes globais
  const regional = deduped.filter((i) => i.category === "baixada").slice(0, REGIONAL_LIMIT);
  const all = [...deduped.filter((i) => i.category !== "baixada").slice(0, MAX_ITEMS), ...regional]
    .sort((a, b) => b.date.localeCompare(a.date));

  // imagem e resumo faltantes, lidos da própria página (regionais primeiro; páginas do Google Notícias não servem)
  const missing = all
    .filter((i) => (!i.image || !i.summary) && !i.gnews)
    .sort((a, b) => (b.category === "baixada") - (a.category === "baixada"))
    .slice(0, OG_LIMIT);
  await Promise.all(missing.map(async (i) => {
    const m = await pageMeta(i.url);
    if (!i.image) i.image = m.image;
    // descrição curta ou igual ao título não ajuda o leitor
    if (!i.summary && m.description.length >= 40 && normTitle(m.description) !== normTitle(i.title)) i.summary = m.description;
  }));

  // tradução EN -> PT de títulos e resumos (com cache para não retraduzir a cada coleta)
  const cachePath = resolve(ROOT, ".cache/translations.json");
  let cache = {};
  try { cache = JSON.parse(await readFile(cachePath, "utf8")); } catch {}
  const toTranslate = all.filter((i) => i.lang === "en");
  const texts = [...new Set(toTranslate.flatMap((i) => [i.title, i.summary].filter(Boolean)))];
  const pending = texts.filter((t) => !cache[t]);
  const done = translateBatch(pending);
  let failed = 0;
  for (const t of pending) { if (done[t]) cache[t] = done[t]; else failed++; }
  const differs = (a, b) => a && normTitle(a) !== normTitle(b);
  for (const i of toTranslate) {
    if (differs(cache[i.title], i.title)) i.titlePt = cache[i.title];
    if (i.summary && differs(cache[i.summary], i.summary)) i.summaryPt = cache[i.summary];
  }
  // mantém no cache só o que está em uso
  const keep = new Set(texts);
  cache = Object.fromEntries(Object.entries(cache).filter(([k]) => keep.has(k)));
  await mkdir(dirname(cachePath), { recursive: true });
  await writeFile(cachePath, JSON.stringify(cache));
  console.log(`traduções: ${pending.length - failed} novas, ${failed} falhas, ${texts.length - pending.length} do cache`);

  // força https nas imagens quando possível
  for (const i of all) if (i.image.startsWith("http://")) i.image = "https://" + i.image.slice(7);

  await mkdir(resolve(ROOT, "public"), { recursive: true });
  // etiquetas de assunto (filters.json > topics): palavras-chave no título e no resumo
  let defs = [];
  try { defs = JSON.parse(await readFile(resolve(ROOT, "filters.json"), "utf8")).topics || []; } catch {}
  const compiled = defs.map((t) => ({ id: t.id, re: new RegExp(t.re, "i"), cs: t.reCase ? new RegExp(t.reCase) : null }));
  for (const i of all) {
    const text = `${i.title} ${i.summary}`;
    const tags = compiled.filter((t) => t.re.test(text) || (t.cs && t.cs.test(text))).map((t) => t.id);
    if (tags.length) i.topics = tags;
  }

  await writeFile(resolve(ROOT, "public/news.json"), JSON.stringify({ updated: new Date().toISOString(), topics: defs.map(({ id, label }) => ({ id, label })), items: all }));
  console.log(status.sort().join("\n"));
  console.log(`\n${blocked} itens bloqueados por filters.json (propaganda, ofertas, futebol)`);
  console.log(`${all.length} notícias, ${all.filter((i) => i.image).length} com imagem, ${all.filter((i) => i.summary).length} com resumo`);
}

main().catch((e) => { console.error(e); process.exit(1); });
