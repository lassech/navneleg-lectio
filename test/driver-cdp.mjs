// Chrome-driver: Chrome for Testing via DevTools Protocol.
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sleep } from "./common.mjs";

// ---------- CDP ----------
class Page {
  canEvalExt = true;
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map();
    this.contexts = new Map(); this.exceptions = []; this.console = []; this.requests = [];
    this.waiters = [];
    ws.addEventListener("message", (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) {
        const { res, rej } = this.pending.get(m.id); this.pending.delete(m.id);
        m.error ? rej(new Error(m.error.message)) : res(m.result);
      } else if (m.method) this.onEvent(m);
    });
  }
  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((r, j) => { ws.addEventListener("open", r); ws.addEventListener("error", j); });
    const p = new Page(ws);
    for (const d of ["Page", "Runtime", "Network", "Log"]) await p.send(`${d}.enable`);
    return p;
  }
  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((res, rej) => this.pending.set(id, { res, rej }));
  }
  onEvent(m) {
    const p = m.params;
    if (m.method === "Runtime.executionContextCreated") this.contexts.set(p.context.id, p.context);
    if (m.method === "Runtime.executionContextDestroyed") this.contexts.delete(p.executionContextId);
    if (m.method === "Runtime.executionContextsCleared") this.contexts.clear();
    if (m.method === "Runtime.exceptionThrown") this.exceptions.push(p.exceptionDetails);
    if (m.method === "Runtime.consoleAPICalled") this.console.push({ type: p.type, args: p.args.map((a) => a.value ?? a.description), ctx: p.executionContextId });
    if (m.method === "Network.requestWillBeSent") this.requests.push({ url: p.request.url, fromExt: JSON.stringify(p.initiator || {}).includes("chrome-extension://") });
    for (const w of this.waiters.filter((w) => w.method === m.method)) { w.res(p); this.waiters.splice(this.waiters.indexOf(w), 1); }
  }
  once(method) { return new Promise((res) => this.waiters.push({ method, res })); }
  async eval(expr) {
    const r = await this.send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error("eval: " + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    return r.result.value;
  }
  extContext() {
    return [...this.contexts.values()].find((c) => c.auxData?.type === "isolated" && c.origin?.startsWith("chrome-extension://"))
      || [...this.contexts.values()].find((c) => c.name === "Navneleg for Lectio");
  }
  async evalExt(expr) {
    const c = this.extContext();
    if (!c) throw new Error("udvidelsens isolerede kontekst ikke fundet");
    const r = await this.send("Runtime.evaluate", { expression: expr, contextId: c.id, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error("evalExt: " + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    return r.result.value;
  }
  async goto(url, waitForButton = true) {
    const loaded = this.once("Page.loadEventFired");
    await this.send("Page.navigate", { url });
    await loaded;
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
    const map = {
      " ": { key: " ", code: "Space", text: " ", keyCode: 32 },
      Enter: { key: "Enter", code: "Enter", text: "\r", keyCode: 13 },
      Escape: { key: "Escape", code: "Escape", keyCode: 27 },
      ArrowLeft: { key: "ArrowLeft", code: "ArrowLeft", keyCode: 37 },
      ArrowRight: { key: "ArrowRight", code: "ArrowRight", keyCode: 39 },
    };
    const d = map[k] || { key: k, code: "Digit" + k, text: k, keyCode: k.charCodeAt(0) };
    await this.send("Input.dispatchKeyEvent", { type: d.text ? "keyDown" : "rawKeyDown", key: d.key, code: d.code, text: d.text, windowsVirtualKeyCode: d.keyCode });
    await this.send("Input.dispatchKeyEvent", { type: "keyUp", key: d.key, code: d.code, windowsVirtualKeyCode: d.keyCode });
    await sleep(15);
  }
  async keys(...ks) { for (const k of ks) await this.key(k); }
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
}

Object.assign(Page.prototype, {
  async hasExtContext() { return !!this.extContext(); },
  insertText(text) { return this.send("Input.insertText", { text }); },
  async screenshot() { return (await this.send("Page.captureScreenshot", { format: "png" })).data; },
  setViewport(width, height, mobile) {
    return this.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile });
  },
  async extErrors() {
    const ext = this.extContext()?.id;
    const ex = this.exceptions.filter((e) => JSON.stringify(e).includes("chrome-extension://") || e.executionContextId === ext)
      .map((e) => e.exception?.description || e.text);
    const con = this.console.filter((m) => m.ctx === ext && /error|warn/.test(m.type)).map((m) => m.args.join(" "));
    return [...ex, ...con];
  },
});

export async function launch(bin, extDir, port) {
  const DBG = 9333;
  const profile = mkdtempSync(join(tmpdir(), "nl-prof-"));
  const proc = spawn(bin, [
    "--headless=new", `--user-data-dir=${profile}`, `--remote-debugging-port=${DBG}`,
    `--load-extension=${extDir}`, `--disable-extensions-except=${extDir}`,
    `--host-resolver-rules=MAP www.lectio.dk 127.0.0.1:${port}`, "--ignore-certificate-errors",
    "--no-first-run", "--no-default-browser-check", "--window-size=1280,900", "about:blank",
  ], { stdio: ["ignore", "ignore", "pipe"] });
  let err = "";
  proc.stderr.on("data", (d) => (err += d));
  let info;
  for (let i = 0; i < 100 && !info; i++) {
    try { info = await (await fetch(`http://127.0.0.1:${DBG}/json/version`)).json(); } catch { await sleep(100); }
  }
  if (!info) throw new Error("Chrome startede ikke:\n" + err.slice(-2000));
  await sleep(500);
  const tab = (await (await fetch(`http://127.0.0.1:${DBG}/json/list`)).json()).find((t) => t.type === "page");
  const page = await Page.connect(tab.webSocketDebuggerUrl);
  return {
    page, name: info.Browser,
    async close() {
      try { page.ws.close(); } catch {}
      proc.kill("SIGKILL");
      await sleep(300);
      rmSync(profile, { recursive: true, force: true });
    },
  };
}
