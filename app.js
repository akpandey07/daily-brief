/* Daily Brief: a static, offline-capable reader for data/latest.json.
   All personal state (settings, saved stories, read marks, habit ticks) lives
   in localStorage on this device only. */
(() => {
  "use strict";

  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const today = () => new Date().toLocaleDateString("en-CA");

  const store = {
    get(k, d) { try { const v = localStorage.getItem("db." + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem("db." + k, JSON.stringify(v)); } catch { /* storage may be blocked */ } },
  };

  const DEFAULT_HABITS = ["Water before tea", "8,000 steps", "20 min reading", "Phone away 1 hr before bed", "10 min stretching"];
  const DEFAULT_KID_HABITS = ["Brush teeth twice", "1 hour outdoor play", "Story at bedtime", "Tried a new vegetable", "Tidied toys"];

  const settings = Object.assign({
    child: "", size: "m", theme: "auto", hindi: true, perPage: 10,
    hidden: [], habits: DEFAULT_HABITS, kidHabits: DEFAULT_KID_HABITS,
  }, store.get("settings", {}));

  let data = null;
  let tab = store.get("tab", "brief");
  let query = "";
  const expanded = new Set();
  let saved = store.get("saved", {});
  let readMap = store.get("read", {});
  if (readMap.day !== today()) readMap = { day: today(), ids: {} };

  const idOf = (it) => it.link;
  const childName = () => (settings.child || "").trim() || "your child";
  const fillChild = (s) => String(s).replaceAll("{child}", childName());

  function applyLook() {
    const r = document.documentElement;
    r.dataset.size = settings.size;
    if (settings.theme === "auto") delete r.dataset.theme; else r.dataset.theme = settings.theme;
  }

  function toast(msg) {
    const t = $("#toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.remove("show"), 1800);
  }

  function ago(iso) {
    const m = Math.max(1, Math.round((Date.now() - new Date(iso)) / 60000));
    if (m < 60) return m + "m ago";
    const h = Math.round(m / 60);
    if (h < 48) return h + "h ago";
    return Math.round(h / 24) + "d ago";
  }

  /* ---------- data ---------- */
  async function load(name) {
    const url = name ? `data/archive/${name}.json` : "data/latest.json";
    const res = await fetch(url, { cache: "no-cache" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    return res.json();
  }

  async function loadArchiveIndex() {
    try { const r = await fetch("data/archive.json", { cache: "no-cache" }); return r.ok ? r.json() : []; } catch { return []; }
  }

  function visibleSections() {
    return data.sections
      .filter((s) => !settings.hidden.includes(s.id))
      .map((s) => ({ ...s, items: s.items.filter((i) => settings.hindi || i.lang !== "hi") }));
  }

  /* ---------- rendering ---------- */
  function card(it, rank, sectionId) {
    const id = idOf(it);
    const isRead = !!readMap.ids[id];
    const isSaved = !!saved[id];
    const img = it.image || (it.video ? `https://i.ytimg.com/vi/${it.video}/hqdefault.jpg` : null);
    const fav = it.domain ? `<img src="https://www.google.com/s2/favicons?domain=${encodeURIComponent(it.domain)}&sz=32" alt="" loading="lazy" referrerpolicy="no-referrer">` : "";
    const cov = it.coverage > 1 ? `<span class="badge${it.coverage >= 5 ? " hot" : ""}" title="Covered by ${it.coverage} outlets">${it.coverage} sources</span>` : "";
    const traffic = it.traffic ? `<span class="badge hot">${esc(it.traffic)} searches</span>` : "";
    const also = (it.also || []).length
      ? `<details><summary class="muted small">Also covered by ${it.also.length}</summary><ul class="also">${it.also.map((a) => `<li><a href="${esc(a.link)}" target="_blank" rel="noopener">${esc(a.source)}</a></li>`).join("")}</ul></details>`
      : "";
    return `<article class="card${img ? "" : " noimg"}${isRead ? " read" : ""}" data-id="${esc(id)}" data-section="${esc(sectionId)}">
      ${rank ? `<span class="rank">${rank}</span>` : ""}
      <div>
        <a href="${esc(it.link)}" target="_blank" rel="noopener" class="open"><h3>${esc(it.title)}</h3></a>
        <div class="meta">${fav}<span>${esc(it.source)}</span><span>· ${ago(it.published)}</span>${cov}${traffic}</div>
        ${it.summary ? `<p class="sum">${esc(it.summary)}</p>` : ""}
        <div class="actions">
          <button data-act="save" class="${isSaved ? "on" : ""}">${isSaved ? "★ Saved" : "☆ Save"}</button>
          <button data-act="share">↗ Share</button>
          <button data-act="read">${isRead ? "↺ Unread" : "✓ Read"}</button>
        </div>
        ${also}
      </div>
      ${img ? `<a href="${esc(it.link)}" target="_blank" rel="noopener" class="thumb-wrap open"><img class="thumb" src="${esc(img)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.closest('.card').classList.add('noimg');this.parentNode.remove()">${it.video ? '<span class="play">▶</span>' : ""}</a>` : ""}
    </article>`;
  }

  function sectionBlock(s, showRank) {
    const open = expanded.has(s.id) || query;
    const limit = open ? s.items.length : Number(settings.perPage);
    const items = s.items.slice(0, limit);
    if (!items.length) return "";
    return `<section class="section" id="sec-${s.id}">
      <div class="section-head"><h2>${s.icon} ${esc(s.title)}</h2><span class="count">${s.items.length} today</span></div>
      ${s.note ? `<p class="note">${esc(s.note)}</p>` : ""}
      ${items.map((it, i) => card(it, showRank ? i + 1 : 0, s.id)).join("")}
      ${!query && s.items.length > limit ? `<button class="more" data-more="${s.id}">Show all ${s.items.length}</button>` : ""}
      ${!query && open && s.items.length > Number(settings.perPage) ? `<button class="more" data-less="${s.id}">Show top ${settings.perPage} only</button>` : ""}
    </section>`;
  }

  function renderChips(sections) {
    $("#chips").innerHTML = sections.map((s) => `<button class="chip" data-jump="${s.id}">${s.icon} ${esc(s.title.split(":")[0])}</button>`).join("");
    $("#chips").hidden = sections.length < 2;
  }

  function sectionsForTab() {
    const all = visibleSections();
    if (tab === "brief") return all.filter((s) => s.id === "top" || s.id === "trending");
    if (tab === "World") return all.filter((s) => ["World", "Local"].includes(s.group) && s.id !== "top" && s.id !== "trending");
    if (tab === "Life") return all.filter((s) => ["Life", "Fun"].includes(s.group));
    return all.filter((s) => s.group === tab);
  }

  function render() {
    if (!data) return;
    $$(".tabbar button").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
    const main = $("#main");
    if (query) {
      const q = query.toLowerCase();
      const hits = visibleSections().map((s) => ({ ...s, items: s.items.filter((i) => (i.title + " " + i.summary + " " + i.source).toLowerCase().includes(q)) })).filter((s) => s.items.length);
      renderChips([]);
      main.innerHTML = hits.length ? hits.map((s) => sectionBlock(s, false)).join("") : `<p class="empty">No stories match “${esc(query)}”.</p>`;
      return;
    }
    if (tab === "you") { renderChips([]); main.innerHTML = renderYou(); return; }
    if (tab === "saved") { renderChips([]); main.innerHTML = renderSaved(); return; }
    const secs = sectionsForTab();
    renderChips(secs);
    main.innerHTML = secs.map((s) => sectionBlock(s, s.id === "top")).join("") || `<p class="empty">All sections in this tab are hidden. Turn them on in Settings.</p>`;
  }

  function renderSaved() {
    const list = Object.values(saved).sort((a, b) => (b.savedAt || "").localeCompare(a.savedAt || ""));
    if (!list.length) return `<p class="empty">Tap ☆ Save on any story to keep it here. Saved stories stay on this phone.</p>`;
    return `<section class="section"><div class="section-head"><h2>🔖 Saved</h2><span class="count">${list.length}</span></div>${list.map((it) => card(it, 0, "saved")).join("")}</section>`;
  }

  /* ---------- You tab: personal picks + habit tracker ---------- */
  const P = () => data.personal || {};
  const one = (k) => (P()[k] || [])[0];
  const many = (k) => P()[k] || [];

  function habitBlock(kind, title, list) {
    const log = store.get("habits." + kind, {});
    const d = today();
    const done = log[d] || {};
    const streak = (h) => {
      let n = 0;
      const day = new Date();
      if (!done[h]) day.setDate(day.getDate() - 1);
      for (;;) {
        const k = day.toLocaleDateString("en-CA");
        if (log[k] && log[k][h]) { n++; day.setDate(day.getDate() - 1); } else break;
      }
      return n;
    };
    const items = list.filter(Boolean).map((h) => {
      const s = streak(h);
      return `<li><label><input type="checkbox" data-habit="${esc(kind)}" value="${esc(h)}" ${done[h] ? "checked" : ""}> ${esc(fillChild(h))}</label>${s ? `<span class="streak">🔥 ${s} day${s > 1 ? "s" : ""}</span>` : ""}</li>`;
    }).join("");
    const count = list.filter((h) => done[h]).length;
    return `<div class="tile"><h4>${title} · ${count}/${list.length} today</h4><ul class="habits">${items}</ul></div>`;
  }

  function tile(title, body, cls = "") { return body ? `<div class="tile ${cls}"><h4>${title}</h4>${body}</div>` : ""; }

  function renderYou() {
    const w = one("word"), ph = one("phrase"), eat = one("eat");
    const name = esc(childName());
    return `
      <section class="section"><div class="section-head"><h2>✅ Today's habits</h2></div>
        <div class="grid2">${habitBlock("me", "Me", settings.habits)}${habitBlock("kid", name, settings.kidHabits)}</div>
      </section>

      <section class="section"><div class="section-head"><h2>💬 Wit & office talk</h2></div><div class="grid2">
        ${w ? tile("Word of the day", `<p class="big">${esc(w.word)}</p><p>${esc(w.meaning)}</p><p class="muted"><i>“${esc(w.use)}”</i></p>`) : ""}
        ${tile("Smile", many("joke").map((j) => `<p>😄 ${esc(j)}</p>`).join(""))}
        ${tile("Conversation starter", one("starter") ? `<p>“${esc(one("starter"))}”</p>` : "")}
        ${tile("Meeting & video-call tip", one("meeting_tip") ? `<p>${esc(one("meeting_tip"))}</p>` : "")}
        ${ph ? tile("Phrase to know", `<p class="big">${esc(ph.phrase)}</p><p>${esc(ph.meaning)}</p>`) : ""}
      </div></section>

      <section class="section"><div class="section-head"><h2>💪 Health & habits</h2></div><div class="grid2">
        ${tile("Habit to try", one("habit") ? `<p>${esc(one("habit"))}</p>` : "")}
        ${tile("Today's workout", one("workout") ? `<p>${esc(one("workout"))}</p>` : "")}
        ${eat ? tile("Eat & avoid", `<p class="ok">${esc(eat.eat)}</p><p class="no">${esc(eat.avoid)}</p><p class="muted small">${esc(eat.why)}</p>`, "eat") : ""}
        ${tile("Sleep better", one("sleep") ? `<p>${esc(one("sleep"))}</p>` : "")}
        ${tile("Sit, stand, walk, run", one("posture") ? `<p>${esc(one("posture"))}</p>` : "")}
      </div><p class="disclaimer">General wellbeing tips, not medical advice. Check with a doctor before starting new exercise or diet changes.</p></section>

      <section class="section"><div class="section-head"><h2>🧒 ${name} & family</h2></div><div class="grid2">
        ${tile("Play & learn today", many("child_activity").map((a) => `<p>• ${esc(fillChild(a))}</p>`).join(""))}
        ${tile("Learning game", one("learning_game") ? `<p>${esc(fillChild(one("learning_game")))}</p>` : "")}
        ${tile("Story time", one("story") ? `<p>${esc(fillChild(one("story")))}</p>` : "")}
        ${tile("Sporty today", one("child_sport") ? `<p>${esc(fillChild(one("child_sport")))}</p>` : "")}
        ${tile("Good habit", one("child_habit") ? `<p>${esc(fillChild(one("child_habit")))}</p>` : "")}
        ${tile("Family time at home", one("family_activity") ? `<p>${esc(fillChild(one("family_activity")))}</p>` : "")}
        ${tile("Bengaluru outing idea", one("weekend") ? `<p>${esc(one("weekend"))}</p><p class="muted small">Check timings and tickets before you go.</p>` : "")}
        ${tile("Parenting tip", one("parenting") ? `<p>${esc(fillChild(one("parenting")))}</p>` : "")}
      </div></section>

      <section class="section"><div class="section-head"><h2>🏡 Home, DIY & beauty</h2></div><div class="grid2">
        ${tile("Home DIY", one("diy") ? `<p>${esc(one("diy"))}</p>` : "")}
        ${tile("Healthy home", one("home_health") ? `<p>${esc(one("home_health"))}</p>` : "")}
        ${tile("Beauty & grooming", one("beauty") ? `<p>${esc(one("beauty"))}</p>` : "")}
        ${tile("Vastu (tradition)", one("vastu") ? `<p>${esc(one("vastu").replace(/^Traditional vastu belief:\s*/, ""))}</p><p class="muted small">A traditional belief system, not science.</p>` : "")}
      </div></section>`;
  }

  /* ---------- progress ---------- */
  function updateProgress() {
    if (!data) return;
    const secs = visibleSections().filter((s) => s.group !== "Fun" || s.id === "watch");
    const target = secs.reduce((n, s) => n + Math.min(s.items.length, Number(settings.perPage)), 0);
    const done = Object.keys(readMap.ids).length;
    const pct = target ? Math.min(100, Math.round((done / target) * 100)) : 0;
    $("#progress-bar").style.width = pct + "%";
    const mins = Math.max(0, Math.round((target - done) * 8 / 60));
    $("#progress-text").textContent = done >= target && target
      ? `🎉 Briefing complete: ${done} stories today. You're the best-informed person in the room.`
      : `${done} of ${target} key stories read · about ${mins} min to go`;
  }

  function findItem(id) {
    for (const s of data.sections) { const it = s.items.find((i) => idOf(i) === id); if (it) return it; }
    return saved[id];
  }

  function markRead(id, on = true) {
    if (on) readMap.ids[id] = 1; else delete readMap.ids[id];
    store.set("read", readMap);
    const el = $(`.card[data-id="${CSS.escape(id)}"]`);
    if (el) {
      el.classList.toggle("read", on);
      const b = $('[data-act="read"]', el);
      if (b) b.textContent = on ? "↺ Unread" : "✓ Read";
    }
    updateProgress();
  }

  async function share(title, url) {
    try {
      if (navigator.share) await navigator.share({ title, url });
      else { await navigator.clipboard.writeText(url); toast("Link copied"); }
    } catch { /* user cancelled */ }
  }

  /* ---------- listen (on-device speech) ---------- */
  let speaking = false;
  function listen() {
    if (!("speechSynthesis" in window)) { toast("Speech isn't supported on this browser"); return; }
    if (speaking) { stopListening(); return; }
    const secs = tab === "you" || tab === "saved" ? visibleSections().filter((s) => s.id === "top") : sectionsForTab();
    const lines = [];
    secs.forEach((s) => {
      const items = s.items.filter((i) => i.lang !== "hi").slice(0, Number(settings.perPage));
      if (items.length) lines.push(`${s.title.replace(/[:&]/g, ",")}.`);
      items.forEach((i) => lines.push(`${i.title}. From ${i.source}.`));
    });
    if (!lines.length) return;
    speaking = true;
    $("#btn-listen").classList.add("on");
    const bar = document.createElement("div");
    bar.className = "listen-bar";
    bar.innerHTML = `<span id="now-reading">Starting…</span><button id="stop-listen">Stop</button>`;
    $(".progress-wrap").after(bar);
    $("#stop-listen").onclick = stopListening;
    const voices = speechSynthesis.getVoices();
    const voice = voices.find((v) => v.lang === "en-IN") || voices.find((v) => v.lang.startsWith("en-GB")) || voices.find((v) => v.lang.startsWith("en"));
    lines.forEach((text, i) => {
      const u = new SpeechSynthesisUtterance(text);
      if (voice) u.voice = voice;
      u.rate = 1.05;
      u.onstart = () => { const n = $("#now-reading"); if (n) n.textContent = text; };
      if (i === lines.length - 1) u.onend = stopListening;
      speechSynthesis.speak(u);
    });
  }
  function stopListening() {
    speaking = false;
    speechSynthesis.cancel();
    $("#btn-listen").classList.remove("on");
    $(".listen-bar")?.remove();
  }

  /* ---------- settings ---------- */
  function openSettings() {
    $("#set-child").value = settings.child;
    $("#set-size").value = settings.size;
    $("#set-theme").value = settings.theme;
    $("#set-hindi").checked = settings.hindi;
    $("#set-perpage").value = String(settings.perPage);
    $("#set-habits").value = settings.habits.join("\n");
    $("#set-kid-habits").value = settings.kidHabits.join("\n");
    $("#set-sections").innerHTML = (data?.sections || []).map((s) => `<label><input type="checkbox" value="${s.id}" ${settings.hidden.includes(s.id) ? "" : "checked"}> ${s.icon} ${esc(s.title)}</label>`).join("");
    $("#settings").showModal();
  }
  function saveSettings() {
    settings.child = $("#set-child").value.trim();
    settings.size = $("#set-size").value;
    settings.theme = $("#set-theme").value;
    settings.hindi = $("#set-hindi").checked;
    settings.perPage = Number($("#set-perpage").value);
    settings.hidden = $$("#set-sections input").filter((i) => !i.checked).map((i) => i.value);
    const lines = (v) => v.split("\n").map((s) => s.trim()).filter(Boolean).slice(0, 12);
    settings.habits = lines($("#set-habits").value);
    settings.kidHabits = lines($("#set-kid-habits").value);
    store.set("settings", settings);
    applyLook();
    render();
    updateProgress();
    toast("Saved");
  }

  /* ---------- events ---------- */
  document.addEventListener("click", (e) => {
    const t = e.target.closest("button, a.open, [data-jump]");
    if (!t) return;
    if (t.matches(".tabbar button")) {
      tab = t.dataset.tab; store.set("tab", tab); query = ""; $("#q").value = ""; render(); window.scrollTo({ top: 0 }); return;
    }
    if (t.dataset.jump) { document.getElementById("sec-" + t.dataset.jump)?.scrollIntoView({ behavior: "smooth" }); return; }
    if (t.dataset.more) { expanded.add(t.dataset.more); render(); return; }
    if (t.dataset.less) { expanded.delete(t.dataset.less); render(); document.getElementById("sec-" + t.dataset.less)?.scrollIntoView(); return; }
    const cardEl = t.closest(".card");
    if (!cardEl) return;
    const id = cardEl.dataset.id;
    if (t.matches("a.open")) { markRead(id, true); return; }
    const it = findItem(id);
    if (t.dataset.act === "save") {
      if (saved[id]) delete saved[id]; else saved[id] = { ...it, savedAt: new Date().toISOString() };
      store.set("saved", saved);
      t.classList.toggle("on", !!saved[id]);
      t.textContent = saved[id] ? "★ Saved" : "☆ Save";
      toast(saved[id] ? "Saved" : "Removed");
      if (tab === "saved") render();
    } else if (t.dataset.act === "share") {
      share(it.title, it.link);
    } else if (t.dataset.act === "read") {
      markRead(id, !readMap.ids[id]);
    }
  });

  document.addEventListener("change", (e) => {
    const el = e.target;
    if (el.dataset.habit) {
      const key = "habits." + el.dataset.habit;
      const log = store.get(key, {});
      const d = today();
      log[d] = log[d] || {};
      if (el.checked) log[d][el.value] = 1; else delete log[d][el.value];
      // keep 120 days of history
      const keys = Object.keys(log).sort();
      keys.slice(0, Math.max(0, keys.length - 120)).forEach((k) => delete log[k]);
      store.set(key, log);
      if (el.checked) toast("Nice! Keep the streak going 🔥");
      render();
    }
    if (el.id === "archive") switchEdition(el.value);
  });

  $("#btn-search").onclick = () => {
    const bar = $("#searchbar");
    bar.hidden = !bar.hidden;
    if (!bar.hidden) $("#q").focus(); else { query = ""; $("#q").value = ""; render(); }
  };
  let qTimer;
  $("#q").addEventListener("input", (e) => { clearTimeout(qTimer); qTimer = setTimeout(() => { query = e.target.value.trim(); render(); }, 200); });
  $("#btn-listen").onclick = listen;
  $("#btn-settings").onclick = openSettings;
  $("#settings").addEventListener("close", () => { if ($("#settings").returnValue === "ok") saveSettings(); });
  $("#btn-share-app").onclick = () => share("Daily Brief: free daily news in one page", location.origin + location.pathname);
  $("#btn-install-help").onclick = () => { $("#settings").close(); $("#install").showModal(); };

  /* ---------- editions ---------- */
  let current = "latest";
  async function switchEdition(name) {
    try {
      data = name === "latest" ? await load() : await load(name);
      current = name;
      expanded.clear();
      showEdition();
      render();
      updateProgress();
    } catch { toast("Couldn't load that edition"); }
  }

  function showEdition(index) {
    if (index) showEdition._index = index;
    const list = showEdition._index || [];
    const label = `${data.edition === "morning" ? "☀️ Morning" : "🌙 Evening"} · ${data.generated_local}`;
    if (list.length < 2) { $("#edition").textContent = label; return; }
    const nice = (n) => n.replace(/-(morning|evening)$/, (_, e) => (e === "morning" ? " ☀️ morning" : " 🌙 evening"));
    $("#edition").innerHTML = `<select id="archive" aria-label="Choose edition" style="border:0;background:none;color:inherit;font:inherit;padding:0;max-width:100%">
      <option value="latest">${current === "latest" ? esc(label) : "Latest edition"}</option>
      ${list.slice(1).map((n) => `<option value="${esc(n)}" ${n === current ? "selected" : ""}>${esc(nice(n))}</option>`).join("")}
    </select>`;
  }

  async function init() {
    applyLook();
    try {
      data = await load();
    } catch {
      $("#main").innerHTML = `<p class="empty">Couldn't load today's edition. Check your connection and pull to refresh.</p>`;
      $("#edition").textContent = "Offline";
      return;
    }
    showEdition(await loadArchiveIndex());
    render();
    updateProgress();
    if (!store.get("seenInstall", false) && !window.matchMedia("(display-mode: standalone)").matches && /iphone|ipad|android/i.test(navigator.userAgent)) {
      store.set("seenInstall", true);
      setTimeout(() => $("#install").showModal(), 1500);
    }
  }

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
  }
  init();
})();
