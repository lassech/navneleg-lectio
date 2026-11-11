// Fælles hjælpere for testen (uafhængig af browser).
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const HERE = dirname(fileURLToPath(import.meta.url));
export const BASE = "https://www.lectio.dk/lectio/76";
export const MEMBERS = `${BASE}/subnav/members.aspx?holdelementid=123456789&showteachers=1&showstudents=1`;
export const mapping = JSON.parse(readFileSync(join(HERE, "fix/mapping.json"), "utf8"));
export const withPhoto = Object.entries(mapping).filter(([, v]) => v.foto);
export const nameOf = (pid) => `${mapping[pid].fornavn} ${mapping[pid].efternavn}`;
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- resultater ----------
export const results = [];
let section = "";
export function check(name, ok, detail = "") {
  results.push({ section, name, ok: !!ok, detail });
  console.log(`${ok ? "  ✓" : "  ✗"} ${name}${!ok && detail ? "  → " + detail : ""}`);
}
export function skip(name, why) {
  results.push({ section, name, ok: true, skipped: why });
  console.log(`  – ${name}  (sprunget over: ${why})`);
}
export function sect(n) { section = n; console.log(`\n## ${n}`); }
export function report() {
  const failed = results.filter((r) => !r.ok);
  const skipped = results.filter((r) => r.skipped);
  console.log(`\n==== ${results.length - failed.length - skipped.length}/${results.length - skipped.length} bestået${skipped.length ? `, ${skipped.length} sprunget over` : ""} ====`);
  for (const f of failed) console.log(`FEJL [${f.section}] ${f.name}\n     ${f.detail}`);
  return failed.length;
}

// Aflæs det aktuelle kort: pictureid og navn (også når navnet er skjult)
const CARD = `(() => {
  const img = document.querySelector('.nl-overlay .nl-photo');
  const nameEl = document.querySelector('.nl-overlay .nl-card > .nl-name');
  const pid = img ? (img.getAttribute('src').match(/pictureid=(\\d+)/) || [])[1] : null;
  return { pid, src: img?.getAttribute('src'), name: nameEl?.textContent, hidden: nameEl ? getComputedStyle(nameEl).visibility === 'hidden' : null,
           count: document.querySelector('.nl-count')?.textContent, toast: document.querySelector('.nl-toast')?.textContent,
           stats: document.querySelector('.nl-stats span')?.textContent };
})()`;
export const card = (p) => p.eval(CARD);
export const mode = (p, label) => p.clickText(".nl-mode", label);
