// Firefox-driver: WebDriver BiDi (Firefox' indbyggede fjernstyrings-protokol).
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { HERE, sleep } from "./common.mjs";

const KEYS = { Enter: "", Escape: "", ArrowLeft: "", ArrowRight: "" };

class Page {
  canEvalExt = false;
  noExtReason = "Firefox giver ikke testværktøjer adgang til udvidelsens storage";

  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map(); this.waiters = [];
    this.requests = []; this.logs = [];
    ws.addEventListener("message", (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) {
        const { res, rej } = this.pending.get(m.id); this.pending.delete(m.id);
        m.type === "error" ? rej(new Error(`${m.error}: ${m.message}`)) : res(m.result);
      } else if (m.type === "event") this.onEvent(m);
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((res, rej) => this.pending.set(id, { res, rej }));
  }
  onEvent(m) {
    const p = m.params;
    if (m.method === "network.beforeRequestSent") this.requests.push({ url: p.request.url });
    if (m.method === "log.entryAdded") this.logs.push(p);
    for (const w of this.waiters.filter((w) => w.method === m.method)) { w.res(p); this.waiters.splice(this.waiters.indexOf(w), 1); }
  }
  async eval(expr) {
    const r = await this.send("script.evaluate", {
      expression: `(async () => { const v = await (${expr}); return v === undefined ? "__undef__" : JSON.stringify(v); })()`,
      target: { context: this.ctx }, awaitPromise: true,
    });
    if (r.type === "exception") throw new Error("eval: " + (r.exceptionDetails?.text || JSON.stringify(r.exceptionDetails)));
    const v = r.result.value;
    return v === "__undef__" ? undefined : JSON.parse(v);
  }
  async hasExtContext() {
    // Firefox viser ikke content-script-verdener via BiDi; vi tjekker i stedet at
    // udvidelsens stylesheet er anvendt (sættes kun af udvidelsen).
    return this.eval(`(() => { const b = document.querySelector('.nl-launch'); return !!b && getComputedStyle(b).backgroundColor === 'rgb(47, 111, 179)'; })()`);
  }
  async goto(url, waitForButton = true) {
    await this.send("browsingContext.navigate", { context: this.ctx, url, wait: "complete" });
    if (waitForButton) await this.waitFor("!!document.querySelector('.nl-launch')", 3000);
    else await sleep(800);
  }
  async waitFor(expr, timeout = 2000) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      try { if (await this.eval(expr)) return true; } catch {}
      await sleep(30);
    }
    return false;
  }
  async key(k) {
    const v = KEYS[k] || k;
    await this.send("input.performActions", { context: this.ctx, actions: [{ type: "key", id: "kbd", actions: [{ type: "keyDown", value: v }, { type: "keyUp", value: v }] }] });
    await sleep(15);
  }
  async keys(...ks) { for (const k of ks) await this.key(k); }
  async insertText(text) {
    const actions = [...text].flatMap((ch) => [{ type: "keyDown", value: ch }, { type: "keyUp", value: ch }]);
    await this.send("input.performActions", { context: this.ctx, actions: [{ type: "key", id: "kbd", actions }] });
  }
  async click(sel) {
    const ok = await this.eval(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return false; e.click(); return true; })()`);
    if (!ok) throw new Error("ikke fundet: " + sel);
    await sleep(30);
  }
  async clickText(sel, text) {
    const ok = await this.eval(`(() => { const e = [...document.querySelectorAll(${JSON.stringify(sel)})].find(x => x.textContent.includes(${JSON.stringify(text)})); if (!e) return false; e.click(); return true; })()`);
    if (!ok) throw new Error(`ikke fundet: ${sel} "${text}"`);
    await sleep(30);
  }
  text(sel) { return this.eval(`document.querySelector(${JSON.stringify(sel)})?.textContent ?? null`); }
  async screenshot() { return (await this.send("browsingContext.captureScreenshot", { context: this.ctx })).data; }
  setViewport(width, height) {
    return this.send("browsingContext.setViewport", { context: this.ctx, viewport: { width, height }, devicePixelRatio: 1 });
  }
  async extErrors() {
    return this.logs
      .filter((l) => /error|warn/.test(l.level) && JSON.stringify(l).includes("moz-extension://"))
      .map((l) => l.text);
  }
}

// Find en ledig port, så en tidligere (hængende) Firefox ikke blokerer
const freePort = () => new Promise((res) => { const s = createServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => res(p)); }); });

export async function launch(bin, extDir, port, proxyPort) {
  const BIDI = await freePort();
  // Snap-Firefox kan ikke se /tmp udefra, så profilen lægges i testmappen.
  const profile = mkdtempSync(join(HERE, "ff-profile-"));
  const prefs = {
    "network.proxy.type": 1,
    "network.proxy.ssl": "127.0.0.1", "network.proxy.ssl_port": proxyPort,
    "network.proxy.http": "127.0.0.1", "network.proxy.http_port": proxyPort,
    "network.proxy.no_proxies_on": "", "network.proxy.allow_hijacking_localhost": true,
    "network.dns.disablePrefetch": true, "network.prefetch-next": false,
    "browser.shell.checkDefaultBrowser": false, "datareporting.policy.dataSubmissionEnabled": false,
    "toolkit.telemetry.enabled": false, "app.update.enabled": false, "browser.startup.page": 0,
  };
  writeFileSync(join(profile, "user.js"), Object.entries(prefs).map(([k, v]) => `user_pref(${JSON.stringify(k)}, ${JSON.stringify(v)});`).join("\n"));
  const proc = spawn(bin, ["--headless", "--no-remote", "--profile", profile, "--remote-debugging-port", String(BIDI), "about:blank"],
    { stdio: ["ignore", "pipe", "pipe"] });
  proc.on("error", () => {}); // fx EACCES ved kill af snap-processen
  let out = "";
  const onData = (d) => (out += d);
  proc.stdout.on("data", onData); proc.stderr.on("data", onData);
  for (let i = 0; i < 200 && !/WebDriver BiDi listening/.test(out); i++) await sleep(100);
  if (!/WebDriver BiDi listening/.test(out)) throw new Error("Firefox startede ikke:\n" + out.slice(-2000));

  const ws = new WebSocket(`ws://127.0.0.1:${BIDI}/session`);
  await new Promise((r, j) => { ws.addEventListener("open", r); ws.addEventListener("error", j); });
  const page = new Page(ws);
  const sess = await page.send("session.new", { capabilities: { alwaysMatch: { acceptInsecureCerts: true } } });
  const name = `${sess.capabilities.browserName} ${sess.capabilities.browserVersion}`;
  const inst = await page.send("webExtension.install", { extensionData: { type: "path", path: extDir } });
  page.extensionId = inst.extension;
  const tree = await page.send("browsingContext.getTree", {});
  page.ctx = tree.contexts[0].context;
  await page.send("session.subscribe", { events: ["network.beforeRequestSent", "log.entryAdded"], contexts: [page.ctx] });
  await page.setViewport(1280, 900);
  return {
    page, name,
    async close() {
      // Snap-Firefox må ikke dræbes direkte (EACCES), så vi beder den lukke sig selv.
      const exited = new Promise((r) => proc.once("exit", r));
      try { await Promise.race([page.send("browser.close"), sleep(3000)]); } catch {}
      try { ws.close(); } catch {}
      await Promise.race([exited, sleep(5000)]);
      try { proc.kill("SIGTERM"); } catch {}
      rmSync(profile, { recursive: true, force: true });
    },
  };
}
