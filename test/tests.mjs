// Selve testene – køres af både Chrome- og Firefox-driveren.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { HERE, BASE, MEMBERS, mapping, withPhoto, nameOf, sleep, check, skip, sect, card, mode } from "./common.mjs";

export async function runTests(page, browser) {
  // ================= 1. Indlæsning =================
  sect("1. Indlæsning og hvor knappen vises");
  await page.goto(`${BASE}/forside.aspx`, false);
  check("Ingen knap på sider uden for members.aspx", !(await page.eval("!!document.querySelector('.nl-launch')")));

  await page.goto(MEMBERS);
  const btn = await page.eval(`(() => { const b = document.querySelector('.nl-launch'); return b && { text: b.textContent, disabled: b.disabled, n: document.querySelectorAll('.nl-launch').length, before: b.nextElementSibling?.className }; })()`);
  check("Knap vises på holdsiden", !!btn);
  check("Knappen tæller 27 elever (lærer og 3 uden foto er fravalgt)", btn?.text === "🎓 Øv navne (27 elever)", btn?.text);
  check("Kun én knap", btn?.n === 1, String(btn?.n));
  check("Knappen står lige før tabellen", btn?.before === "ls-table-wrapper", btn?.before);
  check("Udvidelsens kontekst kører på siden", await page.hasExtContext());

  await page.goto(`${BASE}/subnav/members.aspx?holdelementid=one`);
  check("Med kun 1 elev med foto er knappen deaktiveret", await page.eval("document.querySelector('.nl-launch').disabled"));
  await page.goto(`${BASE}/subnav/members.aspx?holdelementid=empty`, false);
  check("Ingen tabel → ingen knap og ingen fejl", !(await page.eval("!!document.querySelector('.nl-launch')")));

  // ================= 2. Lagring / GDPR =================
  sect("2. Lagring og GDPR");
  page.requests.length = 0;
  await page.goto(MEMBERS);
  await sleep(500);
  const baseline = new Set(page.requests.map((r) => r.url)); // hvad Lectio-siden selv henter
  if (page.canEvalExt) await page.evalExt(`chrome.storage.local.set({ "navnleg:123456789": { S1: { b: 3, t: 1 } }, "navnleg:999": { S2: { b: 2 } } })`);
  await page.eval(`localStorage.setItem("navnleg:123456789", '{"S1":{"b":3}}')`);
  await page.goto(MEMBERS);
  await sleep(300);
  if (page.canEvalExt) {
    const st1 = await page.evalExt("chrome.storage.local.get(null)");
    check("Gammelt fremskridt i extension-storage slettes ved indlæsning", !Object.keys(st1).some((k) => k.startsWith("navnleg:")), JSON.stringify(st1));
  } else skip("Gammelt fremskridt i extension-storage slettes ved indlæsning", page.noExtReason);
  check("Gammelt fremskridt i localStorage slettes", await page.eval(`Object.keys(localStorage).every(k => !k.startsWith("navnleg:"))`));

  // ================= 3. Første åbning / hjælp =================
  sect("3. Åbning, hjælpeside og lukning");
  const urlBefore = await page.eval("location.href");
  await page.click(".nl-launch");
  await page.waitFor("!!document.querySelector('.nl-help')");
  check("Første åbning viser hjælpesiden", await page.eval("document.querySelector('.nl-help h2')?.textContent === 'Sådan virker Navneleg'"));
  check("Klik på knappen sender ikke Lectio-formularen", (await page.eval("location.href")) === urlBefore);
  check("Siden bag overlay kan ikke scrolle", await page.eval("document.documentElement.classList.contains('nl-noscroll')"));
  if (page.canEvalExt) {
    const st2 = await page.evalExt("chrome.storage.local.get(null)");
    check("Det eneste gemte er hjaelpVist=true", JSON.stringify(st2) === '{"hjaelpVist":true}', JSON.stringify(st2));
  } else skip("Det eneste gemte er hjaelpVist=true", page.noExtReason);
  check("Hjælpeteksten nævner 4 rigtige i træk", (await page.text(".nl-help")).includes("4 gange i træk"));
  await page.key("Enter");
  let c = await card(page);
  check("Enter på hjælpesiden → A–Å som standard", c.count === "1 af 27", c.count);
  check("Forrige-knappen er deaktiveret på første elev", await page.eval("document.querySelector('.nl-listnav button').disabled"));
  await page.key("Escape");
  check("Esc lukker", !(await page.eval("!!document.querySelector('.nl-overlay')")));
  check("Scroll-lås fjernes ved lukning", !(await page.eval("document.documentElement.classList.contains('nl-noscroll')")));
  await page.keys(" ", "1", "2", "ArrowRight");
  check("Taster efter lukning gør ingenting (lytter fjernet)", !(await page.eval("!!document.querySelector('.nl-overlay')")));
  await page.click(".nl-launch");
  await page.waitFor("!!document.querySelector('.nl-overlay')");
  check("Anden åbning viser ikke hjælpen igen", !(await page.eval("!!document.querySelector('.nl-help')")));
  await page.click(".nl-help-btn");
  check("?-knappen viser hjælpen", await page.eval("!!document.querySelector('.nl-help')"));
  await page.clickText(".nl-help .nl-btn", "Kom i gang");
  check("'Kom i gang' vender tilbage til A–Å", !!(await card(page)).count);
  await page.click(".nl-close");
  check("✕ lukker", !(await page.eval("!!document.querySelector('.nl-overlay')")));
  await page.click(".nl-launch");
  await page.waitFor("!!document.querySelector('.nl-overlay')");

  // ================= 4. A–Å =================
  sect("4. A–Å-gennemgang");
  await mode(page, "A–Å");
  const order = [];
  const pairErrors = [], srcErrors = [];
  for (let i = 0; i < 27; i++) {
    c = await card(page);
    order.push(c.name);
    if (nameOf(c.pid) !== c.name) pairErrors.push(`${c.pid}: viste "${c.name}", forventet "${nameOf(c.pid)}"`);
    if (c.pid !== "1013" && !/fullsize=1/.test(c.src)) srcErrors.push(c.src);
    if (c.pid !== "1013" && /fullsize=3/.test(c.src)) srcErrors.push(c.src);
    if (i === 0) check("Navnet er skjult før mellemrum", c.hidden === true);
    await page.key("ArrowRight");
  }
  const expected = withPhoto.map(([pid]) => mapping[pid])
    .sort((a, b) => a.fornavn.localeCompare(b.fornavn, "da") || a.efternavn.localeCompare(b.efternavn, "da"))
    .map((s) => `${s.fornavn} ${s.efternavn}`);
  check("Alle 27 elever gennemgås", order.length === 27 && new Set(order).size === 27, String(new Set(order).size));
  check("Rækkefølgen er alfabetisk", JSON.stringify(order) === JSON.stringify(expected), order.join(", "));
  check("Æ, Ø, Å kommer til sidst", order.slice(-3).join("|") === expected.slice(-3).join("|") && /^[ÆØÅ]/.test(order.at(-1)), order.slice(-3).join(", "));
  check("Emma Hansen før Emma Jensen", order.indexOf("Emma Hansen") < order.indexOf("Emma Jensen"));
  check("Navn og billede passer sammen for alle", pairErrors.length === 0, pairErrors.join("; "));
  check("Store billeder bruger &fullsize=1 (også når thumbnail havde &fullsize=3)", srcErrors.length === 0, srcErrors.slice(0, 3).join(" "));
  let done = await page.text(".nl-done");
  check("Overspringede tæller ikke som kunnet", done?.includes("Du kunne 0 af 27"), done);

  await mode(page, "A–Å");
  c = await card(page);
  check("Klik på A–Å starter forfra", c.count === "1 af 27", c.count);
  await page.key("2");
  check("1/2 før navnet er vist ignoreres", (await card(page)).count === "1 af 27");
  await page.key(" ");
  check("Mellemrum viser navnet", (await card(page)).hidden === false);
  await page.key("2");
  c = await card(page);
  const first = expected[0].split(" ")[0] === "Anna" ? "Anna Marie" : expected[0].split(" ")[0];
  check("Rigtigt svar → næste elev", c.count === "2 af 27", c.count);
  check("Besked: '1 af 4 rigtige i træk'", c.toast?.includes(`${first}: 1 af 4 rigtige i træk`), c.toast);
  check("Status: 1 på vej", c.stats === "0/27 lært · 1 på vej", c.stats);
  await page.key("ArrowLeft");
  c = await card(page);
  check("← går tilbage", c.count === "1 af 27", c.count);
  await page.keys(" ", "1");
  c = await card(page);
  check("Forkert svar → 'starter forfra (havde 1 af 4)'", c.toast?.includes("starter forfra (havde 1 af 4)"), c.toast);
  check("Status tilbage til 0 på vej", c.stats === "0/27 lært · 0 på vej", c.stats);

  // fuld runde: 5 rigtige, resten forkert
  await mode(page, "A–Å");
  for (let i = 0; i < 27; i++) await page.keys(" ", i < 5 ? "2" : "1");
  done = await page.text(".nl-done");
  check("Resumé: 'Du kunne 5 af 27'", done?.includes("Du kunne 5 af 27"), done);
  check("Knap: 'Øv dem jeg ikke kunne (22)'", done?.includes("Øv dem jeg ikke kunne (22)"), done);
  await page.key("Enter");
  c = await card(page);
  check("Runde 2 med de 22 manglende", c.count === "1 af 22 · runde 2", c.count);
  check("Runde 2 starter med 6. elev", c.name === expected[5], `${c.name} vs ${expected[5]}`);
  for (let i = 0; i < 22; i++) await page.keys(" ", "2");
  done = await page.text(".nl-done");
  check("Alle kunnet → '🎉 Du kunne dem alle!'", done?.includes("Du kunne dem alle"), done);
  await page.key("Enter");
  check("Enter → start forfra", (await card(page)).count === "1 af 27");

  await page.click(".nl-toggle input");
  c = await card(page);
  check("'Vis navnet med det samme' viser navnet uden mellemrum", c.hidden === false);
  check("…og skjuler 'Vis navn'-knappen", !(await page.eval("[...document.querySelectorAll('.nl-card .nl-btn')].some(b => b.textContent.startsWith('Vis navn'))")));
  await page.key("2");
  check("…og 2 virker direkte", (await card(page)).count === "2 af 27");
  await page.click(".nl-toggle input");
  check("Slå fra igen → navnet skjult", (await card(page)).hidden === true);

  // ================= 5. Læringsregel =================
  sect("5. Regel: lært efter 4 rigtige i træk");
  await mode(page, "Galleri");
  await page.click(".nl-reset .nl-btn"); await page.click(".nl-reset .nl-btn");
  const toasts = [];
  for (let r = 0; r < 5; r++) {
    await mode(page, "A–Å");
    await page.keys(" ", "2");
    toasts.push((await card(page)).toast);
  }
  check("2. og 3. rigtige: '2 af 4', '3 af 4'", toasts[1]?.includes("2 af 4") && toasts[2]?.includes("3 af 4"), toasts.join(" | "));
  check("4. rigtige: '🎉 … er nu lært!'", toasts[3]?.includes("er nu lært!"), toasts[3]);
  check("5. rigtige: 'er stadig lært ✓'", toasts[4]?.includes("er stadig lært"), toasts[4]);
  check("Status: 1/27 lært", (await card(page)).stats === "1/27 lært · 0 på vej", (await card(page)).stats);
  check("Bjælken: mørkegrøn ≈ 4%", await page.eval("document.querySelectorAll('.nl-stats .nl-bar-fill')[1].style.width === '4%'"));
  await mode(page, "A–Å");
  await page.keys(" ", "1");
  c = await card(page);
  check("Forkert på lært navn → 'starter forfra (havde 4 af 4)'", c.toast?.includes("havde 4 af 4"), c.toast);
  check("Status: 0/27 lært", c.stats === "0/27 lært · 0 på vej", c.stats);

  // ================= 6. Flashcards =================
  sect("6. Flashcards og udvælgelse");
  await mode(page, "Flashcards");
  const seen = new Map();
  let prev = null, repeats = 0, mism = 0;
  for (let i = 0; i < 300; i++) {
    c = await card(page);
    if (c.pid === prev) repeats++;
    if (nameOf(c.pid) !== c.name) mism++;
    seen.set(c.pid, (seen.get(c.pid) || 0) + 1);
    prev = c.pid;
    await page.keys(" ", "1");
  }
  check("Samme elev vises aldrig to gange i træk (300 kort)", repeats === 0, String(repeats));
  check("Alle 27 elever dukker op", seen.size === 27, String(seen.size));
  check("Navn og billede passer på alle 300 kort", mism === 0, String(mism));

  const groupA = new Set(withPhoto.slice(0, 5).map(([pid]) => pid));
  const freq = { A: 0, B: 0 };
  for (let i = 0; i < 400; i++) {
    c = await card(page);
    const inA = groupA.has(c.pid);
    if (i >= 200) freq[inA ? "A" : "B"]++;
    await page.keys(" ", inA ? "2" : "1");
  }
  const perA = freq.A / 5, perB = freq.B / 22;
  check("Lærte navne vises sjældnere (pr. elev < ¼ af ulærte)", perA < perB / 4, `lærte ${perA.toFixed(1)} vs ulærte ${perB.toFixed(1)} pr. elev`);
  check("…men lærte navne vises stadig af og til", freq.A > 0, String(freq.A));
  c = await card(page);
  const sm = c.stats?.match(/^(\d+)\/27 lært · (\d+) på vej$/);
  check("De 5 altid-rigtige er lært eller på vej, ingen andre", sm && +sm[1] + +sm[2] === 5, c.stats);
  const learnedNow = sm ? +sm[1] : -1;

  // ================= 7. Vælg navn =================
  sect("7. Vælg navn");
  await mode(page, "Vælg navn");
  let optErr = [], autoAdv = 0, wrongOk = 0;
  for (let i = 0; i < 25; i++) {
    const q = await page.eval(`(() => { const img = document.querySelector('.nl-overlay .nl-photo'); return { pid: img.getAttribute('src').match(/pictureid=(\\d+)/)[1], opts: [...document.querySelectorAll('.nl-opt')].map(b => b.textContent.replace(/^\\d\\. /, '')) }; })()`);
    const correct = nameOf(q.pid);
    const idx = q.opts.indexOf(correct);
    if (q.opts.length !== 4 || new Set(q.opts).size !== 4 || idx < 0) optErr.push(JSON.stringify(q));
    if (i % 2 === 0) {
      await page.key(String(idx + 1));
      const fb = await page.text(".nl-feedback");
      const okCls = await page.eval(`document.querySelectorAll('.nl-opt')[${idx}].classList.contains('nl-btn-ok')`);
      if (fb?.startsWith("✓ Rigtigt!") && okCls) wrongOk++;
      if (await page.waitFor(`!document.querySelector('.nl-feedback')`, 1500)) autoAdv++;
    } else {
      const w = (idx + 1) % 4;
      await page.key(String(w + 1));
      const st = await page.eval(`(() => { const b = [...document.querySelectorAll('.nl-opt')]; return { bad: b[${w}].classList.contains('nl-btn-bad'), ok: b[${idx}].classList.contains('nl-btn-ok'), fb: document.querySelector('.nl-feedback')?.textContent }; })()`);
      await sleep(1200);
      const still = await page.eval("!!document.querySelector('.nl-feedback')");
      if (st.bad && st.ok && st.fb.includes(`✗ Det er ${correct}`) && still) wrongOk++;
      await page.key(" ");
    }
  }
  check("Altid 4 forskellige svar inkl. det rigtige", optErr.length === 0, optErr.slice(0, 2).join(" "));
  check("Rigtigt/forkert markeres korrekt (25 spørgsmål)", wrongOk === 25, `${wrongOk}/25`);
  check("Rigtigt svar går automatisk videre", autoAdv === 13, `${autoAdv}/13`);
  const fbSub = await (async () => { await page.key("1"); return page.text(".nl-feedback-sub"); })();
  check("Tilbagemelding viser fremskridt for eleven", /af 4|lært/.test(fbSub || ""), fbSub);

  // ================= 8. Skriv navn =================
  sect("8. Skriv navn");
  await mode(page, "Skriv navn");
  async function typeAnswer(fn) {
    const pid = await page.eval(`document.querySelector('.nl-overlay .nl-photo').getAttribute('src').match(/pictureid=(\\d+)/)[1]`);
    await page.waitFor("document.activeElement?.classList.contains('nl-input')");
    const txt = fn(mapping[pid]);
    if (txt) await page.insertText(txt);
    await page.key("Enter");
    const fb = await page.text(".nl-feedback");
    await page.key("Enter");
    return { pid, txt, fb };
  }
  let r;
  r = await typeAnswer((s) => `${s.fornavn} ${s.efternavn}`);
  check("Fulde navn → rigtigt", r.fb?.startsWith("✓"), JSON.stringify(r));
  r = await typeAnswer((s) => s.fornavn.toUpperCase());
  check("Fornavn med store bogstaver → rigtigt", r.fb?.startsWith("✓"), JSON.stringify(r));
  r = await typeAnswer((s) => "  " + s.fornavn + "  ");
  check("Ekstra mellemrum ignoreres", r.fb?.startsWith("✓"), JSON.stringify(r));
  r = await typeAnswer(() => "qwxz");
  check("Forkert navn → '✗ Det er …'", r.fb?.startsWith("✗ Det er " + nameOf(r.pid)), JSON.stringify(r));
  r = await typeAnswer(() => "");
  check("Tomt svar → forkert", r.fb?.startsWith("✗"), JSON.stringify(r));
  // stavefejl: find en elev med fornavn > 4 tegn
  let typoOk = null, shortStrict = null, accentOk = null, midOk = null;
  for (let i = 0; i < 300 && (typoOk === null || shortStrict === null || accentOk === null || midOk === null); i++) {
    const pid = await page.eval(`document.querySelector('.nl-overlay .nl-photo').getAttribute('src').match(/pictureid=(\\d+)/)[1]`);
    const s = mapping[pid];
    let txt = null, kind = null;
    if (typoOk === null && s.fornavn.length > 4 && !s.fornavn.includes(" ")) { txt = s.fornavn.slice(0, -1) + "x"; kind = "typo"; }
    else if (shortStrict === null && s.fornavn.length <= 4 && /^[A-Za-z]+$/.test(s.fornavn)) { txt = s.fornavn.slice(0, -1) + "x"; kind = "short"; }
    else if (accentOk === null && s.fornavn === "Zoë") { txt = "zoe"; kind = "accent"; }
    else if (midOk === null && s.fornavn === "Anna Marie") { txt = "anna marie"; kind = "mid"; }
    await page.waitFor("document.activeElement?.classList.contains('nl-input')");
    if (txt) await page.insertText(txt);
    await page.key("Enter");
    const fb = await page.text(".nl-feedback");
    if (kind === "typo") typoOk = { ok: fb.startsWith("✓") && fb.includes("stavet:"), fb };
    if (kind === "short") shortStrict = { ok: fb.startsWith("✗"), fb };
    if (kind === "accent") accentOk = { ok: fb.startsWith("✓"), fb };
    if (kind === "mid") midOk = { ok: fb.startsWith("✓"), fb };
    await page.key("Enter");
  }
  check("Én stavefejl i langt fornavn godkendes med '(stavet: …)'", typoOk?.ok, JSON.stringify(typoOk));
  check("Stavefejl i kort fornavn (≤4 tegn) godkendes ikke", shortStrict?.ok, JSON.stringify(shortStrict));
  check("'zoe' godkendes for Zoë (accenter ignoreres)", accentOk?.ok, JSON.stringify(accentOk));
  check("Dobbelt fornavn 'anna marie' godkendes", midOk?.ok, JSON.stringify(midOk));
  await page.waitFor("document.activeElement?.classList.contains('nl-input')");
  await page.insertText("12 3");
  check("Tal og mellemrum i feltet trigger ikke genveje", (await page.eval("document.querySelector('.nl-input').value")) === "12 3" && !(await page.eval("!!document.querySelector('.nl-feedback')")));
  await page.key(" ");
  check("Mellemrum-tast i feltet skriver mellemrum (ingen genvej)", (await page.eval("document.querySelector('.nl-input').value")) === "12 3 ");
  await page.clickText(".nl-btn", "Ved ikke");
  check("'Ved ikke' giver forkert og viser navnet", (await page.text(".nl-feedback"))?.startsWith("✗ Det er"));
  await page.key("Enter");
  await page.waitFor("document.activeElement?.classList.contains('nl-input')");
  await page.key("Escape");
  check("Esc lukker også mens man skriver", !(await page.eval("!!document.querySelector('.nl-overlay')")));
  await page.click(".nl-launch");
  await page.waitFor("!!document.querySelector('.nl-overlay')");

  // ================= 9. Find billedet =================
  sect("9. Find billedet");
  await mode(page, "Find billedet");
  let tileErr = [], tileOk = 0;
  for (let i = 0; i < 20; i++) {
    const q = await page.eval(`(() => ({ name: document.querySelector('.nl-overlay .nl-name').textContent.replace(/^Hvem er /, '').replace(/\\?$/, ''),
      pids: [...document.querySelectorAll('.nl-tile img')].map(i => i.getAttribute('src').match(/pictureid=(\\d+)/)[1]) }))()`);
    const idx = q.pids.findIndex((p) => nameOf(p) === q.name);
    if (q.pids.length !== 4 || new Set(q.pids).size !== 4 || idx < 0 || q.pids.filter((p) => nameOf(p) === q.name).length !== 1) tileErr.push(JSON.stringify(q));
    if (i % 2 === 0) {
      await page.key(String(idx + 1));
      if (await page.eval(`document.querySelectorAll('.nl-tile')[${idx}].classList.contains('nl-tile-ok')`)) tileOk++;
      await page.waitFor(`!document.querySelector('.nl-feedback')`, 1500);
    } else {
      const w = (idx + 1) % 4;
      await page.key(String(w + 1));
      const st = await page.eval(`(() => { const t = document.querySelectorAll('.nl-tile'); return t[${w}].classList.contains('nl-tile-bad') && t[${idx}].classList.contains('nl-tile-ok') && t[${w}].querySelector('.nl-tile-name')?.textContent; })()`);
      if (st === nameOf(q.pids[w])) tileOk++;
      await page.key(" ");
    }
  }
  check("Altid 4 forskellige billeder, præcis ét rigtigt", tileErr.length === 0, tileErr.slice(0, 2).join(" "));
  check("Rigtigt/forkert markeres, forkert billede får navneskilt", tileOk === 20, `${tileOk}/20`);

  // ================= 10. Billeder =================
  sect("10. Billeder");
  await mode(page, "Galleri");
  await sleep(800);
  const imgs = await page.eval(`[...document.querySelectorAll('.nl-fig-img')].map(i => ({ src: i.getAttribute('src'), w: i.naturalWidth }))`);
  check("Galleriet viser 27 elever", imgs.length === 27, String(imgs.length));
  check("Alle billeder er indlæst", imgs.every((i) => i.w > 0), JSON.stringify(imgs.filter((i) => !i.w)));
  check("Store billeder (300 px) bruges", imgs.filter((i) => i.w === 300).length === 26, String(imgs.filter((i) => i.w === 300).length));
  const fb1013 = imgs.find((i) => /pictureid=1013/.test(i.src));
  check("Mangler stort billede → falder tilbage til thumbnail", fb1013 && !/fullsize=1/.test(fb1013.src) && fb1013.w === 36, JSON.stringify(fb1013));
  const gal = await page.eval(`[...document.querySelectorAll('.nl-fig figcaption')].map(f => f.firstChild.textContent)`);
  check("Galleriet er sorteret alfabetisk", JSON.stringify(gal) === JSON.stringify(expected), gal.join(", "));

  // ================= 11. Galleri / nulstil =================
  sect("11. Galleri og nulstilling");
  // Sørg for mindst én lært elev (første i A–Å), uanset tilfældigheder tidligere i testen
  for (let r = 0; r < 4; r++) { await mode(page, "A–Å"); await page.keys(" ", "2"); }
  await mode(page, "Galleri");
  const learnedAtGallery = +((await card(page)).stats.match(/^(\d+)\//)[1]);
  const dots = await page.eval(`[...document.querySelectorAll('.nl-fig .nl-dots')].map(d => ({ t: d.textContent, done: d.classList.contains('nl-dots-done') }))`);
  check("Prikker: 4 pr. elev", dots.every((d) => d.t.length === 4));
  check("Lærte elever har ●●●● og grøn markering (antal = status)", dots.filter((d) => d.t === "●●●●" && d.done).length === learnedAtGallery && dots.filter((d) => d.done).length === learnedAtGallery && learnedAtGallery > 0, `${dots.filter((d) => d.done).length} vs ${learnedAtGallery}`);
  await page.click(".nl-reset .nl-btn");
  check("Første klik på Nulstil beder om bekræftelse", (await page.text(".nl-reset .nl-btn"))?.includes("bekræfte"));
  check("…og nulstiller ikke endnu", !(await page.eval("document.querySelector('.nl-stats span').textContent.startsWith('0/27 lært · 0')")));
  await page.click(".nl-reset .nl-btn");
  check("Andet klik nulstiller", (await card(page)).stats === "0/27 lært · 0 på vej", (await card(page)).stats);
  check("Alle prikker tomme efter nulstilling", await page.eval(`[...document.querySelectorAll('.nl-fig .nl-dots')].every(d => d.textContent === '○○○○')`));

  // ================= 12. Hukommelse =================
  sect("12. Fremskridt kun i hukommelsen");
  await mode(page, "A–Å");
  await page.keys(" ", "2", " ", "2", " ", "2");
  await page.key("Escape");
  await page.click(".nl-launch");
  await page.waitFor("!!document.querySelector('.nl-overlay')");
  c = await card(page);
  check("Luk og åbn igen → fremskridt bevaret", c.stats === "0/27 lært · 3 på vej", c.stats);
  check("…og A–Å fortsætter hvor man slap", c.count === "4 af 27", c.count);
  if (page.canEvalExt) {
    const st3 = await page.evalExt("chrome.storage.local.get(null)");
    check("Intet elevfremskridt i extension-storage", JSON.stringify(st3) === '{"hjaelpVist":true}', JSON.stringify(st3));
  } else skip("Intet elevfremskridt i extension-storage", page.noExtReason);
  check("Intet i localStorage/sessionStorage fra udvidelsen", await page.eval(`[...Object.keys(localStorage), ...Object.keys(sessionStorage)].every(k => !/navnleg|hjaelp/i.test(k))`));
  await page.goto(MEMBERS);
  await page.click(".nl-launch");
  await page.waitFor("!!document.querySelector('.nl-overlay')");
  c = await card(page);
  check("Genindlæsning nulstiller fremskridt", c.stats === "0/27 lært · 0 på vej", c.stats);
  check("Hjælpesiden vises ikke efter genindlæsning", !(await page.eval("!!document.querySelector('.nl-help')")));

  // ================= 13. Netværk og fejl =================
  sect("13. Netværk, privatliv og fejl");
  const reqLog = readFileSync(join(HERE, "requests.log"), "utf8").trim().split("\n");
  const foreign = page.requests.map((r) => r.url).filter((u) => !/^(https:\/\/www\.lectio\.dk\/|data:|chrome-extension:|moz-extension:|about:)/.test(u));
  check("Ingen forespørgsler til andre domæner end lectio.dk", foreign.length === 0, [...new Set(foreign)].slice(0, 5).join(" "));
  const extReq = page.requests.filter((r) => (r.fromExt || !baseline.has(r.url)) && !r.url.startsWith("data:"));
  const extBad = extReq.filter((r) => !/^https:\/\/www\.lectio\.dk\/lectio\/76\/GetImage\.aspx\?pictureid=\d+&fullsize=1$|^https:\/\/www\.lectio\.dk\/lectio\/76\/GetImage\.aspx\?pictureid=1013(&fullsize=3)?$/.test(r.url));
  check(`Alt ud over sidens egne forespørgsler (${extReq.length}) er elevbilleder fra Lectio`, extReq.length > 0 && extBad.length === 0, extBad.slice(0, 5).map((r) => r.url).join(" | "));
  check("Ingen POST-forespørgsler (ingen data sendes)", !reqLog.some((l) => l.startsWith("POST")), reqLog.filter((l) => l.startsWith("POST")).join(" "));
  const extErrors = await page.extErrors();
  check("Ingen JavaScript-fejl eller console-advarsler fra udvidelsen", extErrors.length === 0, extErrors.slice(0, 3).join(" | "));

  // ================= 14. Skærmbilleder =================
  sect("14. Skærmbilleder (til visuel kontrol)");
  mkdirSync(join(HERE, "shots"), { recursive: true });
  async function shot(name) {
    await sleep(400);
    writeFileSync(join(HERE, "shots", `${browser}-${name}.png`), Buffer.from(await page.screenshot(), "base64"));
  }
  for (const [w, h, tag] of [[1280, 900, "desktop"], [390, 800, "mobil"]]) {
    await page.setViewport(w, h, tag === "mobil");
    await page.click(".nl-help-btn"); await shot(`${tag}-0-hjaelp`);
    await mode(page, "A–Å"); await page.keys(" ", "2", " "); await shot(`${tag}-1-a-aa`);
    await mode(page, "Flashcards"); await shot(`${tag}-2-flash`);
    await mode(page, "Vælg navn"); await page.key("1"); await shot(`${tag}-3-vaelg`);
    await page.key(" ");
    await mode(page, "Skriv navn"); await shot(`${tag}-4-skriv`);
    await mode(page, "Find billedet"); await page.key("1"); await shot(`${tag}-5-find`);
    await page.key(" ");
    await mode(page, "Galleri"); await shot(`${tag}-6-galleri`);
    const covered = await page.eval(`(() => { const pts = [[5,5],[${w}/2,${h}-5],[${w}-5,${h}/2],[${w}/2,5]]; return pts.map(([x,y]) => { const e = document.elementFromPoint(x,y); return e && e.closest('.nl-overlay') ? null : (e?.tagName + '.' + e?.className); }).filter(Boolean); })()`);
    check(`Overlay dækker hele skærmen (${tag}) – Lectio-elementer ligger ikke ovenpå`, covered.length === 0, covered.join(", "));
  }
  check("Skærmbilleder gemt", true);
}
