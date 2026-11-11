// Navneleg for Lectio – øv elevnavne på holdsiden "Lærere og elever".
// Fremskridt holdes KUN i hukommelsen, mens siden er åben – intet om elever gemmes.
// Det eneste der gemmes, er om hjælpesiden er vist (ja/nej).
(() => {
  "use strict";

  const MAX_BOX = 5;
  const NEED = MAX_BOX - 1; // rigtige svar i træk før et navn er lært
  const HELP_KEY = "hjaelpVist";

  // ---------- Udtræk af elever fra tabellen ----------

  function findTable() {
    return (
      document.getElementById("s_m_Content_Content_laerereleverpanel_alm_gv") ||
      [...document.querySelectorAll("table")].find((t) =>
        /Fornavn/.test(t.querySelector("tr")?.textContent || "")
      )
    );
  }

  function largeUrl(thumb) {
    if (/defaultfoto|portrait\.gif/.test(thumb)) return null;
    if (!thumb.includes("?")) return thumb; // gemt lokal kopi – ingen fuld størrelse
    if (/[&?]fullsize=\d/.test(thumb)) return thumb.replace(/fullsize=\d/, "fullsize=1");
    return thumb + "&fullsize=1";
  }

  function extractStudents(table) {
    const rows = [...table.querySelectorAll("tr")];
    const header = rows.shift();
    const heads = [...header.children].map((c) => c.textContent.trim().toLowerCase());
    const col = (name, fallback) => {
      const i = heads.indexOf(name);
      return i >= 0 ? i : fallback;
    };
    const cFoto = col("foto", 0), cType = col("type", 1), cFor = col("fornavn", 3), cEfter = col("efternavn", 4);

    const students = [];
    for (const tr of rows) {
      const cells = tr.children;
      if (cells.length < 5) continue;
      if (cells[cType].textContent.trim() !== "Elev") continue;
      const img = cells[cFoto].querySelector("img");
      if (!img) continue;
      const thumb = img.src;
      const large = largeUrl(thumb);
      if (!large) continue; // intet rigtigt foto
      const fornavn = cells[cFor].textContent.trim().replace(/\s+/g, " ");
      const efternavn = cells[cEfter].textContent.trim().replace(/\s+/g, " ");
      const id =
        cells[cFor].getAttribute("data-lectiocontextcard") ||
        tr.querySelector("[data-lectiocontextcard]")?.getAttribute("data-lectiocontextcard") ||
        fornavn + " " + efternavn;
      students.push({ id, fornavn, efternavn, navn: `${fornavn} ${efternavn}`.trim(), thumb, large });
    }
    return students;
  }

  function holdName() {
    return document.title.split(" - ")[0].replace(/^Holdet\s+/, "") || "holdet";
  }

  // ---------- Lagring ----------
  // Firefox har det promise-baserede "browser", Chrome har "chrome".
  const ext = globalThis.browser ?? globalThis.chrome;
  // Gemmer kun et ja/nej for om hjælpesiden er vist. Ingen elevdata.

  async function helpSeen() {
    try {
      return !!(await ext.storage.local.get(HELP_KEY))[HELP_KEY];
    } catch {
      return false;
    }
  }

  async function markHelpSeen() {
    try {
      await ext.storage.local.set({ [HELP_KEY]: true });
    } catch {}
  }

  // Sletter fremskridt, som tidligere versioner gemte ("navnleg:<holdid>").
  async function purgeOldProgress() {
    try {
      const all = await ext.storage.local.get(null);
      const old = Object.keys(all).filter((k) => k.startsWith("navnleg:"));
      if (old.length) await ext.storage.local.remove(old);
    } catch {}
    try {
      Object.keys(localStorage).filter((k) => k.startsWith("navnleg:")).forEach((k) => localStorage.removeItem(k));
    } catch {}
  }

  // ---------- Hjælpefunktioner ----------

  const shuffle = (a) => {
    a = [...a];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };

  const norm = (s) =>
    s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-zæøå0-9 ]/g, "").replace(/\s+/g, " ").trim();

  function lev(a, b) {
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++)
      for (let j = 1; j <= b.length; j++)
        d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return d[a.length][b.length];
  }

  // Returnerer "rigtigt", "næsten" eller "forkert"
  function checkTyped(input, s) {
    const x = norm(input);
    if (!x) return "forkert";
    const full = norm(s.navn), first = norm(s.fornavn);
    if (x === full || x === first) return "rigtigt";
    const tol = first.length > 4 ? 1 : 0;
    if (lev(x, first) <= tol || lev(x, full) <= tol + 1) return "næsten";
    return "forkert";
  }

  const el = (tag, attrs = {}, ...kids) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "class") e.className = v;
      else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v);
    }
    for (const k of kids) if (k != null) e.append(k);
    return e;
  };

  function photo(s, cls = "nl-photo") {
    const img = el("img", { class: cls, alt: "", src: s.large });
    img.addEventListener("error", () => {
      if (img.src !== s.thumb) img.src = s.thumb;
    }, { once: true });
    return img;
  }

  // ---------- Quiz ----------

  class Quiz {
    constructor(students) {
      this.students = students;
      this.progress = {}; // kun i hukommelsen – forsvinder når siden lukkes/genindlæses
      this.mode = "list";
      this.last = null;
      this.streak = 0;
      this.onKey = this.onKey.bind(this);
    }

    async open() {
      if (!(await helpSeen())) {
        this.prevMode = this.mode;
        this.mode = "help";
        await markHelpSeen();
      }
      this.root = el("div", { class: "nl-overlay", role: "dialog", "aria-label": "Navneleg" });
      document.body.append(this.root);
      document.addEventListener("keydown", this.onKey, true);
      document.documentElement.classList.add("nl-noscroll");
      this.next();
    }

    close() {
      document.removeEventListener("keydown", this.onKey, true);
      document.documentElement.classList.remove("nl-noscroll");
      this.root.remove();
    }

    box(s) {
      return this.progress[s.id]?.b || 1;
    }

    // Prikker: én pr. rigtigt svar i træk, 4 = lært
    dots(s) {
      const k = this.box(s) - 1;
      return el("span", { class: "nl-dots" + (k >= NEED ? " nl-dots-done" : ""), title: `${k} af ${NEED} rigtige i træk` },
        "●".repeat(k) + "○".repeat(NEED - k));
    }

    takeToast() {
      const t = this.toast;
      this.toast = null;
      return t ? el("div", { class: "nl-toast " + (t.ok ? "nl-ok" : "nl-bad") }, t.text, " ", t.dots) : null;
    }

    learnedCount() {
      return this.students.filter((s) => this.box(s) >= MAX_BOX).length;
    }

    async answer(s, correct) {
      const b = this.box(s);
      const nb = correct ? Math.min(MAX_BOX, b + 1) : 1;
      this.progress[s.id] = { b: nb };
      this.streak = correct ? this.streak + 1 : 0;
      const k = nb - 1;
      this.toast = {
        ok: correct,
        text: correct
          ? (b >= MAX_BOX ? `${s.fornavn} er stadig lært ✓`
            : nb >= MAX_BOX ? `🎉 ${s.fornavn} er nu lært!`
            : `${s.fornavn}: ${k} af ${NEED} rigtige i træk`)
          : (b > 1 ? `${s.fornavn} starter forfra (havde ${b - 1} af ${NEED})` : `${s.fornavn}: 0 af ${NEED} – prøv igen senere`),
        dots: this.dots(s),
      };
    }

    // Vægtet tilfældigt valg: lave bokse vises oftere, undgå samme elev to gange i træk.
    pick() {
      const pool = this.students.length > 1 ? this.students.filter((s) => s !== this.last) : this.students;
      const weights = pool.map((s) => 2 ** (MAX_BOX - this.box(s)));
      let r = Math.random() * weights.reduce((a, b) => a + b, 0);
      for (let i = 0; i < pool.length; i++) if ((r -= weights[i]) <= 0) return (this.last = pool[i]);
      return (this.last = pool[pool.length - 1]);
    }

    distractors(s, n = 3) {
      return shuffle(this.students.filter((o) => o !== s && o.navn !== s.navn)).slice(0, n);
    }

    header() {
      const modes = [
        ["list", "A–Å"],
        ["flash", "Flashcards"],
        ["choice", "Vælg navn"],
        ["type", "Skriv navn"],
        ["reverse", "Find billedet"],
        ["gallery", "Galleri"],
      ];
      const n = this.students.length;
      const learned = this.learnedCount();
      const onTheWay = this.students.filter((s) => this.box(s) > 1 && this.box(s) < MAX_BOX).length;
      // Bjælken viser samlet fremskridt: hvert rigtigt svar i træk rykker den lidt.
      const progress = this.students.reduce((sum, s) => sum + (this.box(s) - 1) / (MAX_BOX - 1), 0);
      const pct = Math.round((progress / n) * 100);
      const pctLearned = Math.round((learned / n) * 100);
      return el(
        "div",
        { class: "nl-header" },
        el("div", { class: "nl-title" }, `Navneleg · ${holdName()}`),
        el(
          "div",
          { class: "nl-modes" },
          ...modes.map(([m, label]) =>
            el("button", {
              class: "nl-mode" + (m === this.mode ? " nl-active" : ""),
              onclick: () => { if (m === "list") this.listState = null; this.mode = m; this.next(); },
            }, label)
          )
        ),
        el(
          "div",
          { class: "nl-stats", title: "Et navn er lært efter 4 rigtige svar i træk. Et forkert svar starter forfra for det navn." },
          el("div", { class: "nl-bar" },
            el("div", { class: "nl-bar-fill nl-bar-way", style: `width:${pct}%` }),
            el("div", { class: "nl-bar-fill", style: `width:${pctLearned}%` })),
          el("span", {}, `${learned}/${n} lært · ${onTheWay} på vej`),
          this.streak >= 3 ? el("span", { class: "nl-streak" }, `🔥 ${this.streak}`) : null
        ),
        el("button", { class: "nl-help-btn", title: "Sådan virker det", onclick: () => {
          if (this.mode !== "help") this.prevMode = this.mode;
          this.mode = "help";
          this.next();
        } }, "?"),
        el("button", { class: "nl-close", title: "Luk (Esc)", onclick: () => this.close() }, "✕")
      );
    }

    render(body, hint) {
      this.root.replaceChildren(
        el("div", { class: "nl-panel" }, this.header(), el("div", { class: "nl-body" }, this.takeToast(), body),
          el("div", { class: "nl-hint" }, hint || ""))
      );
    }

    next() {
      this.handlers = {};
      ({ help: this.help, list: this.list, flash: this.flash, choice: this.choice, type: this.type, reverse: this.reverse, gallery: this.gallery })[this.mode].call(this);
    }

    feedback(ok, s, extra) {
      const t = this.toast;
      this.toast = null;
      return el("div", { class: "nl-feedback " + (ok ? "nl-ok" : "nl-bad") },
        ok ? "✓ Rigtigt!" : `✗ Det er ${s.navn}`, extra ? el("small", {}, " " + extra) : null,
        t ? el("div", { class: "nl-feedback-sub" }, t.text, " ", t.dots) : null);
    }

    // --- Hjælp ---
    help() {
      const back = () => { this.mode = this.prevMode && this.prevMode !== "help" ? this.prevMode : "list"; this.next(); };
      const row = (title, text) => el("li", {}, el("strong", {}, title), " – " + text);
      const demo = (k) => el("span", { class: "nl-dots" + (k >= NEED ? " nl-dots-done" : "") }, "●".repeat(k) + "○".repeat(NEED - k));
      const body = el("div", { class: "nl-help" },
        el("h2", {}, "Sådan virker Navneleg"),
        el("h3", {}, "Hvornår er et navn lært?"),
        el("p", {}, `Et navn er lært, når du har svaret rigtigt på det ${NEED} gange i træk. Svarer du forkert, starter det navn forfra.`),
        el("ul", { class: "nl-help-dots" },
          el("li", {}, demo(0), " nyt / starter forfra"),
          el("li", {}, demo(2), " 2 rigtige i træk – på vej"),
          el("li", {}, demo(NEED), " lært")),
        el("p", {}, "Navne du ikke kan endnu, bliver vist oftere end dem du kan. Lærte navne dukker stadig op en gang imellem, så du ikke glemmer dem."),
        el("p", {}, "Bjælken øverst: lysegrøn = samlet fremskridt (vokser for hvert rigtigt svar), mørkegrøn = lærte navne."),
        el("h3", {}, "Tilstande"),
        el("ul", {},
          row("A–Å", "gå hele klasselisten igennem alfabetisk. Til sidst kan du øve dem, du ikke kunne. Slå \"Vis navnet med det samme\" til for en ren indlæringsrunde."),
          row("Flashcards", "se et billede, tænk på navnet, vis det og sig ærligt om du kunne det."),
          row("Vælg navn", "vælg det rigtige navn blandt fire."),
          row("Skriv navn", "skriv fornavn eller hele navnet. Små stavefejl godkendes."),
          row("Find billedet", "find den rigtige elev blandt fire billeder."),
          row("Galleri", "se alle elever og hvor langt du er med hver.")),
        el("h3", {}, "Taster"),
        el("p", {}, "Mellemrum = vis navn / næste · 1–4 = vælg svar · ← → = bladr i A–Å · Esc = luk"),
        el("p", { class: "nl-help-small" }, "Af hensyn til GDPR gemmes intet om eleverne. Fremskridtet findes kun, mens Lectio-siden er åben, og nulstilles når du genindlæser eller lukker siden. Du kan godt lukke og åbne quizzen igen uden at miste det."),
        el("div", { class: "nl-buttons" }, el("button", { class: "nl-btn nl-btn-ok", onclick: back }, "Kom i gang"))
      );
      this.handlers = { Enter: back, " ": back };
      this.render(body, "");
    }

    // --- A–Å: gennemgå klasselisten i alfabetisk rækkefølge ---
    list() {
      if (!this.listState) {
        const order = [...this.students].sort((a, b) =>
          a.fornavn.localeCompare(b.fornavn, "da") || a.efternavn.localeCompare(b.efternavn, "da"));
        this.listState = { order, i: 0, ok: new Set(), round: 1 };
      }
      const st = this.listState;
      if (st.i >= st.order.length) return this.listDone();
      const s = st.order[st.i];
      const showNow = !!this.listShowName;

      const nameEl = el("div", { class: "nl-name" + (showNow ? "" : " nl-hidden") }, s.navn);
      const go = (d) => { st.i = Math.max(0, st.i + d); this.next(); };
      const grade = async (ok) => {
        if (nameEl.classList.contains("nl-hidden")) return;
        if (ok) st.ok.add(s); else st.ok.delete(s);
        await this.answer(s, ok);
        go(1);
      };
      const btns = el("div", { class: "nl-buttons" + (showNow ? "" : " nl-hidden") },
        el("button", { class: "nl-btn nl-btn-bad", onclick: () => grade(false) }, "Kunne ikke (1)"),
        el("button", { class: "nl-btn nl-btn-ok", onclick: () => grade(true) }, "Kunne (2)")
      );
      const revealBtn = el("button", { class: "nl-btn", onclick: () => reveal() }, "Vis navn (mellemrum)");
      const reveal = () => {
        if (!nameEl.classList.contains("nl-hidden")) return;
        nameEl.classList.remove("nl-hidden");
        btns.classList.remove("nl-hidden");
        revealBtn.remove();
      };
      const img = photo(s);
      img.addEventListener("click", reveal);

      const toggle = el("input", { type: "checkbox" });
      toggle.checked = showNow;
      toggle.addEventListener("change", () => { this.listShowName = toggle.checked; this.next(); });

      const nav = el("div", { class: "nl-listnav" },
        el("button", { class: "nl-btn nl-btn-ghost", onclick: () => go(-1), ...(st.i === 0 ? { disabled: "" } : {}) }, "← Forrige"),
        el("span", { class: "nl-count" }, `${st.i + 1} af ${st.order.length}` + (st.round > 1 ? ` · runde ${st.round}` : "")),
        el("button", { class: "nl-btn nl-btn-ghost", onclick: () => go(1) }, "Spring over →")
      );
      const listBar = el("div", { class: "nl-bar nl-listbar" },
        el("div", { class: "nl-bar-fill", style: `width:${Math.round((st.i / st.order.length) * 100)}%` }));

      this.handlers = {
        " ": reveal, Enter: reveal,
        1: () => grade(false), 2: () => grade(true),
        ArrowLeft: () => go(-1), ArrowRight: () => go(1),
      };
      this.render(
        el("div", { class: "nl-card" }, nav, listBar, img, nameEl, showNow ? null : revealBtn, btns,
          el("label", { class: "nl-toggle" }, toggle, " Vis navnet med det samme (indlæringsrunde)")),
        "Mellemrum viser navnet · 1 = kunne ikke · 2 = kunne · ← → bladrer"
      );
    }

    listDone() {
      const st = this.listState;
      const missed = st.order.filter((m) => !st.ok.has(m));
      const kunne = st.ok.size;
      const again = () => {
        this.listState = { order: missed, i: 0, ok: new Set(), round: st.round + 1 };
        this.next();
      };
      const restart = () => { this.listState = null; this.next(); };
      const body = el("div", { class: "nl-card nl-done" },
        el("div", { class: "nl-name" }, missed.length ? "Runden er færdig" : "🎉 Du kunne dem alle!"),
        el("div", {}, `Du kunne ${kunne} af ${st.order.length}.`),
        missed.length
          ? el("div", { class: "nl-missed" }, "Mangler (ikke kunnet eller sprunget over): " + missed.map((m) => m.fornavn).join(", "))
          : null,
        el("div", { class: "nl-buttons" },
          missed.length ? el("button", { class: "nl-btn nl-btn-ok", onclick: again }, `Øv dem jeg ikke kunne (${missed.length})`) : null,
          el("button", { class: "nl-btn", onclick: restart }, "Start forfra")
        )
      );
      this.handlers = { Enter: missed.length ? again : restart, " ": missed.length ? again : restart };
      this.render(body, missed.length ? "Enter = øv dem du ikke kunne" : "Enter = start forfra");
    }

    // --- Flashcards ---
    flash() {
      const s = this.pick();
      const nameEl = el("div", { class: "nl-name nl-hidden" }, s.navn);
      const btns = el("div", { class: "nl-buttons nl-hidden" },
        el("button", { class: "nl-btn nl-btn-bad", onclick: () => grade(false) }, "Kunne ikke (1)"),
        el("button", { class: "nl-btn nl-btn-ok", onclick: () => grade(true) }, "Kunne (2)")
      );
      const reveal = () => {
        if (!nameEl.classList.contains("nl-hidden")) return;
        nameEl.classList.remove("nl-hidden");
        btns.classList.remove("nl-hidden");
        revealBtn.remove();
      };
      const grade = async (ok) => {
        if (nameEl.classList.contains("nl-hidden")) return;
        await this.answer(s, ok);
        this.next();
      };
      const revealBtn = el("button", { class: "nl-btn", onclick: reveal }, "Vis navn (mellemrum)");
      const img = photo(s);
      img.addEventListener("click", reveal);
      this.handlers = { " ": reveal, Enter: reveal, 1: () => grade(false), 2: () => grade(true) };
      this.render(el("div", { class: "nl-card" }, img, nameEl, revealBtn, btns),
        "Hvem er det? Mellemrum viser navnet · 1 = kunne ikke · 2 = kunne");
    }

    // --- Multiple choice ---
    choice() {
      const s = this.pick();
      const opts = shuffle([s, ...this.distractors(s)]);
      let done = false;
      const result = el("div", { class: "nl-result" });
      const buttons = opts.map((o, i) =>
        el("button", { class: "nl-btn nl-opt", onclick: () => choose(i) }, `${i + 1}. ${o.navn}`)
      );
      const choose = async (i) => {
        if (done) return this.next();
        done = true;
        const ok = opts[i] === s;
        buttons.forEach((b, j) => {
          if (opts[j] === s) b.classList.add("nl-btn-ok");
          else if (j === i) b.classList.add("nl-btn-bad");
        });
        await this.answer(s, ok);
        result.replaceChildren(this.feedback(ok, s), el("button", { class: "nl-btn", onclick: () => this.next() }, "Næste (mellemrum)"));
        if (ok) setTimeout(() => result.isConnected && this.next(), 900);
      };
      this.handlers = { 1: () => choose(0), 2: () => choose(1), 3: () => choose(2), 4: () => choose(3), " ": () => done && this.next(), Enter: () => done && this.next() };
      this.render(el("div", { class: "nl-card" }, photo(s), el("div", { class: "nl-options" }, ...buttons), result),
        "Vælg med 1–4");
    }

    // --- Skriv navnet ---
    type() {
      const s = this.pick();
      let done = false;
      const input = el("input", { class: "nl-input", type: "text", placeholder: "Skriv fornavn eller fulde navn", autocomplete: "off", spellcheck: "false" });
      const result = el("div", { class: "nl-result" });
      const submit = async () => {
        if (done) return this.next();
        done = true;
        input.disabled = true;
        const r = checkTyped(input.value, s);
        await this.answer(s, r !== "forkert");
        result.replaceChildren(
          r === "næsten" ? this.feedback(true, s, `(stavet: ${s.navn})`) : this.feedback(r === "rigtigt", s),
          el("button", { class: "nl-btn", onclick: () => this.next() }, "Næste (Enter)")
        );
        result.querySelector("button").focus();
      };
      const giveUp = el("button", { class: "nl-btn nl-btn-ghost", onclick: () => { input.value = ""; submit(); } }, "Ved ikke");
      this.handlers = { Enter: submit };
      this.render(el("div", { class: "nl-card" }, photo(s),
        el("form", { class: "nl-form", onsubmit: (e) => { e.preventDefault(); } }, input, giveUp), result),
        "Tryk Enter for at svare – små stavefejl godkendes");
      setTimeout(() => input.focus(), 30);
    }

    // --- Find billedet ---
    reverse() {
      const s = this.pick();
      const opts = shuffle([s, ...this.distractors(s)]);
      let done = false;
      const result = el("div", { class: "nl-result" });
      const tiles = opts.map((o, i) => {
        const t = el("button", { class: "nl-tile", onclick: () => choose(i) }, photo(o, "nl-tile-img"), el("span", { class: "nl-tile-num" }, String(i + 1)));
        return t;
      });
      const choose = async (i) => {
        if (done) return this.next();
        done = true;
        const ok = opts[i] === s;
        tiles.forEach((t, j) => {
          if (opts[j] === s) t.classList.add("nl-tile-ok");
          else if (j === i) {
            t.classList.add("nl-tile-bad");
            t.append(el("span", { class: "nl-tile-name" }, opts[j].navn));
          }
        });
        await this.answer(s, ok);
        result.replaceChildren(this.feedback(ok, s), el("button", { class: "nl-btn", onclick: () => this.next() }, "Næste (mellemrum)"));
        if (ok) setTimeout(() => result.isConnected && this.next(), 900);
      };
      this.handlers = { 1: () => choose(0), 2: () => choose(1), 3: () => choose(2), 4: () => choose(3), " ": () => done && this.next(), Enter: () => done && this.next() };
      this.render(el("div", { class: "nl-card" }, el("div", { class: "nl-name" }, `Hvem er ${s.navn}?`),
        el("div", { class: "nl-tiles" }, ...tiles), result), "Vælg med 1–4");
    }

    // --- Galleri ---
    gallery() {
      const grid = el("div", { class: "nl-gallery" },
        ...[...this.students].sort((a, b) => a.fornavn.localeCompare(b.fornavn, "da")).map((s) =>
          el("figure", { class: "nl-fig" }, photo(s, "nl-fig-img"),
            el("figcaption", {}, s.navn, this.dots(s)))
        )
      );
      const reset = el("button", { class: "nl-btn nl-btn-ghost", onclick: async () => {
        if (reset.dataset.confirm) {
          this.progress = {};
          this.streak = 0;
          this.gallery();
        } else {
          reset.dataset.confirm = "1";
          reset.textContent = "Klik igen for at bekræfte nulstilling";
        }
      } }, "Nulstil fremskridt");
      this.render(el("div", {}, grid, el("div", { class: "nl-reset" }, reset)), `Prikkerne viser rigtige svar i træk – ${NEED} = lært`);
    }

    onKey(e) {
      if (e.key === "Escape") { e.preventDefault(); return this.close(); }
      const typing = e.target instanceof HTMLInputElement && e.key !== "Enter";
      if (typing) return;
      const h = this.handlers?.[e.key];
      if (h) { e.preventDefault(); e.stopPropagation(); h(); }
    }
  }

  // ---------- Opstart ----------

  function init() {
    const table = findTable();
    if (!table || document.querySelector(".nl-launch")) return;
    const students = extractStudents(table);
    const btn = el("button", { class: "nl-launch", type: "button" }, `🎓 Øv navne (${students.length} elever)`);
    if (students.length < 2) {
      btn.disabled = true;
      btn.title = "Der skal være mindst 2 elever med foto";
    }
    let quiz = null; // genbruges, så fremskridt bevares når quizzen lukkes og åbnes igen
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      (quiz ||= new Quiz(students)).open();
    });
    const anchor = table.closest(".ls-table-wrapper") || table;
    anchor.parentNode.insertBefore(btn, anchor);
  }

  purgeOldProgress();
  init();
})();
