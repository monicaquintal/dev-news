(() => {
  const $ = (s) => document.querySelector(s);
  const list = $("#list");
  const COLORS = { dev: "var(--dev)", seguranca: "var(--seguranca)", geral: "var(--geral)", baixada: "var(--baixada)" };
  const LABELS = { dev: "Dev", seguranca: "Segurança", geral: "Tecnologia", baixada: "Baixada Santista" };
  const state = { cat: "all", lang: "all", q: "", days: 0, topics: new Set(), items: [] };
  const MAX_LATER = 300;
  const BOOKMARK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1z"/></svg>';

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

  // ---------- Ler mais tarde (guardado só neste navegador, com cópia completa do card) ----------
  const isHttp = (u) => typeof u === "string" && /^https?:\/\//i.test(u);
  function clean(x) {
    if (!x || typeof x.title !== "string" || !isHttp(x.url)) return null;
    const saved = Number.isFinite(+x.savedAt) ? +x.savedAt : Date.now();
    const d = new Date(x.date);
    return {
      title: x.title.slice(0, 400),
      url: x.url,
      source: String(x.source || "—").slice(0, 80),
      category: String(x.category || "geral"),
      lang: x.lang === "en" ? "en" : "pt",
      date: isNaN(d) ? new Date(saved).toISOString() : d.toISOString(),
      summary: String(x.summary || "").slice(0, 400),
      summaryPt: x.summaryPt ? String(x.summaryPt).slice(0, 700) : undefined,
      image: isHttp(x.image) ? x.image : "",
      titlePt: x.titlePt ? String(x.titlePt).slice(0, 400) : undefined,
      topics: Array.isArray(x.topics) ? x.topics.map(String).slice(0, 10) : undefined,
      savedAt: saved,
    };
  }
  let later = [];
  try { later = JSON.parse(localStorage.getItem("later") || "[]").map(clean).filter(Boolean); } catch {}
  const persist = () => {
    try { localStorage.setItem("later", JSON.stringify(later)); }
    catch { toast("Não foi possível salvar neste navegador"); }
  };
  const isSaved = (url) => later.some((x) => x.url === url);
  function updateLaterCount() {
    const c = $("#lcnt");
    c.textContent = later.length ? later.length : "";
    c.hidden = !later.length;
  }

  let toastTimer;
  function toast(msg) {
    const t = $("#toast");
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 2200);
  }

  function toggleLater(i, btn) {
    const idx = later.findIndex((x) => x.url === i.url);
    if (idx >= 0) {
      later.splice(idx, 1);
      toast("Removido de Ler mais tarde");
    } else {
      later.unshift({ ...clean(i), savedAt: Date.now() });
      later = later.slice(0, MAX_LATER);
      toast("Salvo para ler mais tarde");
    }
    persist();
    updateLaterCount();
    if (state.cat === "later") { render(); return; }
    setSaveBtn(btn, isSaved(i.url));
  }

  function setSaveBtn(btn, on) {
    btn.classList.toggle("on", on);
    btn.setAttribute("aria-pressed", String(on));
    btn.setAttribute("aria-label", on ? "Remover de Ler mais tarde" : "Salvar para ler mais tarde");
  }

  function exportLater() {
    const data = { app: "dev-news", version: 1, exported: new Date().toISOString(), items: later };
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 1)], { type: "application/json" }));
    const a = el("a");
    a.href = url;
    a.download = `dev-news-ler-mais-tarde-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function importLater(file) {
    try {
      const j = JSON.parse(await file.text());
      const arr = (Array.isArray(j) ? j : j.items || []).map(clean).filter(Boolean);
      const have = new Set(later.map((x) => x.url));
      const novos = arr.filter((x) => !have.has(x.url));
      later = [...later, ...novos].sort((a, b) => b.savedAt - a.savedAt).slice(0, MAX_LATER);
      persist();
      updateLaterCount();
      toast(novos.length ? `${novos.length} notícia(s) importada(s)` : "Nenhuma notícia nova no arquivo");
      render();
    } catch {
      toast("Arquivo inválido");
    }
  }

  function toolbar() {
    const bar = el("div", "toolbar");
    bar.append(el("span", "", later.length ? `${later.length} salva${later.length > 1 ? "s" : ""} neste aparelho` : "Nada salvo ainda"));
    const actions = el("div", "tb-actions");
    const exp = el("button", "", "Exportar");
    const imp = el("button", "", "Importar");
    exp.type = imp.type = "button";
    exp.disabled = !later.length;
    exp.addEventListener("click", exportLater);
    imp.addEventListener("click", () => $("#file").click());
    actions.append(exp, imp);
    bar.append(actions);
    return bar;
  }

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
    const art = el("article", "card" + (read.has(i.url) ? " read" : ""));
    art.style.setProperty("--c", COLORS[i.category] || "var(--accent)");
    art.style.animationDelay = Math.min(n, 8) * 30 + "ms";

    const a = el("a", "clink");
    a.href = i.url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";

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
    const resumo = i.summaryPt || i.summary;
    if (resumo) {
      const p = el("p", "sum", resumo);
      if (i.summaryPt) p.lang = "pt-BR";
      body.append(p);
    }
    a.append(body);
    a.addEventListener("click", () => { read.add(i.url); art.classList.add("read"); saveRead(); });

    // o botão fica fora do link, para tocar nele não abrir a notícia
    const btn = el("button", "save");
    btn.type = "button";
    btn.innerHTML = BOOKMARK;
    setSaveBtn(btn, isSaved(i.url));
    btn.addEventListener("click", () => toggleLater(i, btn));

    art.append(a, btn);
    return art;
  }

  function updateCount() {
    const n = (state.days ? 1 : 0) + state.topics.size;
    const c = $("#fcnt");
    c.textContent = n;
    c.hidden = !n;
  }

  function renderTopics(defs) {
    const box = $("#topics");
    box.replaceChildren(...defs.map((t) => {
      const b = el("button", state.topics.has(t.id) ? "on" : "", t.label);
      b.type = "button";
      b.dataset.id = t.id;
      b.setAttribute("aria-pressed", state.topics.has(t.id));
      return b;
    }));
  }

  function render() {
    updateCount();
    const now = Date.now();
    const q = norm(state.q.trim());
    const isLater = state.cat === "later";
    const items = (isLater ? later : state.items).filter((i) =>
      (state.cat === "all" || isLater || i.category === state.cat) &&
      (state.lang === "all" || i.lang === state.lang) &&
      (!state.days || now - new Date(i.date) <= state.days * 864e5) &&
      (!state.topics.size || (i.topics || []).some((t) => state.topics.has(t))) &&
      (!q || norm(`${i.title} ${i.titlePt || ""} ${i.summary} ${i.summaryPt || ""} ${i.source}`).includes(q)));
    const head = isLater ? [toolbar()] : [];
    if (!items.length) {
      const msg = isLater && !later.length
        ? "Toque no marcador de um card para guardar a notícia e ler depois."
        : "Nenhuma notícia encontrada.";
      list.replaceChildren(...head, el("p", "empty", msg));
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
    list.replaceChildren(...head, more);
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
  // painel de filtros: período e assuntos
  const panel = $("#panel"), fbtn = $("#fbtn");
  fbtn.addEventListener("click", () => {
    panel.hidden = !panel.hidden;
    fbtn.setAttribute("aria-expanded", String(!panel.hidden));
  });
  $("#days").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    state.days = +b.dataset.days;
    $("#days").querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b));
    render();
  });
  $("#topics").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    const id = b.dataset.id;
    state.topics.has(id) ? state.topics.delete(id) : state.topics.add(id);
    b.classList.toggle("on", state.topics.has(id));
    b.setAttribute("aria-pressed", state.topics.has(id));
    render();
  });
  $("#clear").addEventListener("click", () => {
    state.days = 0;
    state.topics.clear();
    $("#days").querySelectorAll("button").forEach((x) => x.classList.toggle("on", x.dataset.days === "0"));
    renderTopics(state.topicDefs || []);
    render();
  });
  $("#file").addEventListener("change", (e) => {
    const f = e.target.files[0];
    e.target.value = "";
    if (f) importLater(f);
  });

  let t;
  $("#q").addEventListener("input", (e) => { clearTimeout(t); t = setTimeout(() => { state.q = e.target.value; render(); }, 150); });

  async function load() {
    try {
      const r = await fetch("news.json", { cache: "no-cache" });
      const d = await r.json();
      state.items = d.items;
      state.topicDefs = d.topics || [];
      renderTopics(state.topicDefs);
      const u = $("#updated");
      u.textContent = `Atualizado ${ago(d.updated)}`;
      u.hidden = false;
      render();
    } catch {
      list.replaceChildren(el("p", "empty", "Não foi possível carregar as notícias."));
    }
  }
  updateLaterCount();
  load();
  document.addEventListener("visibilitychange", () => { if (!document.hidden && state.items.length) load(); });

  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
})();
