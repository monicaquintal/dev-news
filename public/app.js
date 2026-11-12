(() => {
  const $ = (s) => document.querySelector(s);
  const list = $("#list");
  const COLORS = { dev: "var(--dev)", seguranca: "var(--seguranca)", geral: "var(--geral)", baixada: "var(--baixada)" };
  const LABELS = { dev: "Dev", seguranca: "Segurança", geral: "Tecnologia", baixada: "Baixada Santista" };
  const state = { cat: "all", lang: "all", q: "", items: [] };

  let read = new Set();
  try { read = new Set(JSON.parse(localStorage.getItem("read") || "[]")); } catch {}
  const saveRead = () => { try { localStorage.setItem("read", JSON.stringify([...read].slice(-500))); } catch {} };

  const norm = (s) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };

  function ago(iso) {
    const m = Math.max(1, Math.round((Date.now() - new Date(iso)) / 60000));
    if (m < 60) return `há ${m} min`;
    const h = Math.round(m / 60);
    if (h < 24) return `há ${h} h`;
    const d = Math.round(h / 24);
    return `há ${d} ${d === 1 ? "dia" : "dias"}`;
  }

  function placeholder(i) {
    return el("div", "ph", i.source.trim()[0].toUpperCase());
  }

  function card(i, n) {
    const a = el("a", "card" + (read.has(i.url) ? " read" : ""));
    a.href = i.url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.style.setProperty("--c", COLORS[i.category] || "var(--accent)");
    a.style.animationDelay = Math.min(n, 8) * 30 + "ms";

    const media = el("div", "media");
    if (i.image) {
      const img = el("img", "thumb");
      img.loading = "lazy";
      img.decoding = "async";
      img.referrerPolicy = "no-referrer";
      img.alt = "";
      img.src = i.image;
      img.onerror = () => img.replaceWith(placeholder(i));
      media.append(img);
    } else {
      media.append(placeholder(i));
    }
    media.append(el("span", "badge", LABELS[i.category] || i.category));
    a.append(media);

    const body = el("div", "body");
    const src = el("div", "src");
    src.append(el("b", "", i.source), el("i"), el("span", "", ago(i.date)));
    body.append(src, el("h2", "", i.title));
    if (i.titlePt) {
      const sub = el("div", "sub", i.titlePt);
      sub.lang = "pt-BR";
      body.append(sub);
    }
    if (i.summary) body.append(el("p", "sum", i.summary));
    a.append(body);

    a.addEventListener("click", () => { read.add(i.url); a.classList.add("read"); saveRead(); });
    return a;
  }

  function render() {
    const q = norm(state.q.trim());
    const items = state.items.filter((i) =>
      (state.cat === "all" || i.category === state.cat) &&
      (state.lang === "all" || i.lang === state.lang) &&
      (!q || norm(`${i.title} ${i.titlePt || ""} ${i.summary} ${i.source}`).includes(q)));
    if (!items.length) {
      list.replaceChildren(el("p", "empty", "Nenhuma notícia encontrada."));
      return;
    }
    const PAGE = 30;
    let shown = 0;
    const more = el("button", "more", "Mostrar mais");
    const next = () => {
      const slice = items.slice(shown, shown + PAGE);
      more.before(...slice.map((i, k) => card(i, k)));
      shown += slice.length;
      more.hidden = shown >= items.length;
    };
    more.addEventListener("click", next);
    list.replaceChildren(more);
    next();
  }

  function bind(sel, key, attr) {
    $(sel).addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      state[key] = b.dataset[attr];
      $(sel).querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b));
      b.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
      render();
      window.scrollTo({ top: 0 });
    });
  }
  bind("#cats", "cat", "cat");
  bind("#langs", "lang", "lang");
  let t;
  $("#q").addEventListener("input", (e) => { clearTimeout(t); t = setTimeout(() => { state.q = e.target.value; render(); }, 150); });

  async function load() {
    try {
      const r = await fetch("news.json", { cache: "no-cache" });
      const d = await r.json();
      state.items = d.items;
      const u = $("#updated");
      u.textContent = `Atualizado ${ago(d.updated)}`;
      u.hidden = false;
      render();
    } catch {
      list.replaceChildren(el("p", "empty", "Não foi possível carregar as notícias."));
    }
  }
  load();
  document.addEventListener("visibilitychange", () => { if (!document.hidden && state.items.length) load(); });

  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
})();
