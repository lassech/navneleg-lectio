// End-to-end test af Navneleg-udvidelsen.
// Kør: node test.mjs chrome  <chrome-binær>  <udvidelsesmappe> <server-port>
//      node test.mjs firefox <firefox-binær> <udvidelsesmappe> <server-port> <proxy-port>
import { results, check, report } from "./common.mjs";
import { runTests } from "./tests.mjs";

const [browser, bin, extDir, port, proxyPort] = process.argv.slice(2);
const driver = await import(browser === "firefox" ? "./driver-bidi.mjs" : "./driver-cdp.mjs");

let session;
try {
  session = await driver.launch(bin, extDir, +port, +proxyPort);
  console.log("Browser:", session.name);
  await runTests(session.page, browser);
} catch (e) {
  check("Testkørslen gennemførtes uden at gå ned", false, e.stack);
} finally {
  await session?.close();
  process.exit(report() ? 1 : 0);
}
