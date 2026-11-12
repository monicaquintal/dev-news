(() => {
  const $ = (s) => document.querySelector(s);
  const list = $("#list");
  const COLORS = { dev: "var(--dev)", seguranca: "var(--seguranca)", geral: "var(--geral)" };
  const LABELS = { dev: "Dev", seguranca: "Segurança", geral: "Geral" };
  const state = { cat: "all", lang: "all", q: "", items: [] };

  let read = new Set();
  try { read = new Set(JSON.parse(localStorage.getItem("read") || "[]")); } catch {}
  const saveRead = () => { try { localStorage.setItem("read", JSON.stringify([...read].slice(-500))); } catch {} };

  const norm = (s) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

  function ago(iso) {
    const m = Math.max(1, Math.round((Date.now() - new Date(iso)) / 60000));
    if (m < 60) return `há ${m} min`;
    const h = Math.round(m / 60);
    if (h < 24) return `há ${h} h`;
    const d = Math.round(h / 24);
    return `há ${d} ${d === 1 ? "dia" : "dias"}`;
  }

  function card(i) {
    const a = document.createElement("a");
    a.className = "card" + (read.has(i.url) ? " read" : "");
    a.href = i.url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.style.setProperty("--c", COLORS[i.category] || "var(--accent)");

    let media;
    if (i.image) {
      media = document.createElement("img");
      media.className = "thumb";
      media.loading = "lazy";
      media.decoding = "async";
      media.referrerPolicy = "no-referrer";
      media.alt = "";
      media.src = i.image;
      media.onerror = () => media.replaceWith(placeholder(i));
    } else {
      media = placeholder(i);
    }
    a.append(media);

    const body = document.createElement("div");
    body.className = "body";
    const h = document.createElement("h2");
    h.textContent = i.title;
    body.append(h);
    if (i.titlePt) {
      const sub = document.createElement("div");
      sub.className = "sub";
      sub.lang = "pt-BR";
      sub.textContent = i.titlePt;
      body.append(sub);
    }
    if (i.summary) {
      const p = document.createElement("p");
      p.textContent = i.summary;
      body.append(p);
    }
    const meta = document.createElement("div");
    meta.className = "meta";
    const tag = document.createElement("span");
    tag.className = "tag";
    tag.textContent = LABELS[i.category] || i.category;
    const src = document.createElement("span");
    src.textContent = `${i.source} · ${ago(i.date)}`;
    meta.append(tag, src);
    body.append(meta);
    a.append(body);

    a.addEventListener("click", () => { read.add(i.url); a.classList.add("read"); saveRead(); });
    return a;
  }

  function placeholder(i) {
    const d = document.createElement("div");
    d.className = "ph";
    d.textContent = i.source.trim()[0].toUpperCase();
    return d;
  }

  function render() {
    const q = norm(state.q.trim());
    const items = state.items.filter((i) =>
      (state.cat === "all" || i.category === state.cat) &&
      (state.lang === "all" || i.lang === state.lang) &&
      (!q || norm(`${i.title} ${i.titlePt || ""} ${i.summary} ${i.source}`).includes(q)));
    if (!items.length) {
      list.replaceChildren(Object.assign(document.createElement("p"), { className: "empty", textContent: "Nenhuma notícia encontrada." }));
      return;
    }
    const PAGE = 30;
    let shown = 0;
    const more = Object.assign(document.createElement("button"), { className: "more", textContent: "Mostrar mais" });
    const next = () => {
      const slice = items.slice(shown, shown + PAGE);
      shown += slice.length;
      more.before(...slice.map(card));
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
      render();
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
      $("#updated").textContent = `atualizado ${ago(d.updated)}`;
      render();
    } catch {
      list.innerHTML = '<p class="empty">Não foi possível carregar as notícias.</p>';
    }
  }
  load();
  document.addEventListener("visibilitychange", () => { if (!document.hidden) load(); });

  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
})();
