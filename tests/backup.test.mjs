// Checks the optional local server (server.js) and the SQLite backup of notes, bookmarks, place and progress.
// The server under test uses a temporary database (INFRA_RECOVER_DB), never the real one.
// Usage: npm run test:backup
import { spawn, execFileSync } from "node:child_process";
import { createServer } from "node:net";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tmp = mkdtempSync(path.join(os.tmpdir(), "infra-recover-"));
const DB = path.join(tmp, "test.db");

let failures = 0;
const fail = (msg) => { failures++; console.error("  ✗ " + msg); };
const ok = (msg) => console.log("  ✓ " + msg);
const check = (cond, msg) => (cond ? ok(msg) : fail(msg));

const PORT = await new Promise((resolve) => { const s = createServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => resolve(p)); }); });
const origin = `http://127.0.0.1:${PORT}`, site = origin + "/infra-recover/";
let child = null;
function start() {
  return new Promise((resolve, reject) => {
    child = spawn(process.execPath, ["--no-warnings", path.join(ROOT, "server.js")], { env: { ...process.env, PORT: String(PORT), INFRA_RECOVER_DB: DB }, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (d) => { out += d; if (out.includes("infra-recover on")) resolve(out); });
    child.stderr.on("data", (d) => { out += d; });
    child.on("exit", (code) => reject(new Error("server exited " + code + ": " + out)));
  });
}
function stop() { return new Promise((resolve) => { if (!child) return resolve(); child.removeAllListeners("exit"); child.on("exit", resolve); child.kill(); child = null; }); }
const H = { "x-tutorial": "1", "content-type": "application/json" };
const api = (method, q, body, headers = H) => fetch(origin + "/api/state" + q, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
const put = (body, headers) => api("PUT", "", body, headers);
// fetch() does not let a test choose the Host header
const rawGet = (p, host) => new Promise((resolve) => { http.get({ host: "127.0.0.1", port: PORT, path: p, headers: { host } }, (r) => { r.resume(); resolve(r.statusCode); }); });

let browser = null;
try {
  const banner = await start();
  console.log("\n7. Local server and SQLite backup");
  check(banner.includes(DB), "the server starts and names its database");
  const status = await (await fetch(origin + "/api/status")).json();
  if (!status.backup) throw new Error("this Node.js has no node:sqlite (needs 22.13 or newer): " + process.version);
  ok("/api/status reports backup: true");

  // ---- the site ----
  check((await fetch(site)).status === 200 && (await fetch(site + "lessons/10-pods-and-deployments.html")).status === 200 &&
    (await fetch(site + "assets/js/backup.js")).status === 200, "it serves the course under /infra-recover/");
  check((await fetch(origin + "/", { redirect: "manual" })).status === 302, "/ redirects to the course");
  const hidden = await Promise.all(["server.js", "package.json", "data/test.db", ".git/config", "tests/run-tests.mjs", "src/lessons/01-first-container.html", "assets/%2e%2e/server.js", "lessons/..%2fserver.js"]
    .map(async (p) => (await fetch(site + p)).status));
  check(hidden.every((s) => s === 404), "it serves nothing but the site's own pages and assets" + (hidden.every((s) => s === 404) ? "" : ": " + hidden.join(",")));
  check(await rawGet("/api/status", "evil.example") === 403 && await rawGet("/api/status", `localhost:${PORT}`) === 200, "requests for another Host name are refused");

  // ---- write protections and bad input ----
  const good = { page: "lesson-10", key: "notes", value: "[]", updated: 1000 };
  check((await put(good, { "content-type": "application/json" })).status === 403, "a write without the x-tutorial header is refused");
  check((await put(good, { ...H, origin: "https://evil.example" })).status === 403 && (await api("GET", "", undefined, { ...H, origin: "https://evil.example" })).status === 403, "a request from another origin is refused");
  const bad = [{ ...good, page: "../etc" }, { ...good, page: "index.html" }, { ...good, key: "theme" }, { ...good, value: "{not json" }, { ...good, value: 5 }, { ...good, updated: "now" }, null];
  const codes = await Promise.all(bad.map(async (b) => (await put(b)).status));
  check(codes.every((s) => s === 400), "unknown pages and keys, non-JSON values and bad dates are rejected" + (codes.every((s) => s === 400) ? "" : ": " + codes.join(",")));
  const big = await put({ ...good, value: JSON.stringify("x".repeat(600 * 1024)) }).then((r) => r.status, () => 413);
  check(big === 400 || big === 413, "an oversized value is rejected");
  check((await api("GET", "?page=nope")).status === 400, "reading an unknown page is rejected");

  // ---- storing ----
  const get = async (page) => (await (await api("GET", "?page=" + page)).json()).state;
  await put({ ...good, value: '[{"id":"a"}]', updated: 2000 });
  await put({ ...good, value: '[{"id":"old"}]', updated: 1500 });
  check((await get("lesson-10")).notes.value === '[{"id":"a"}]', "an older write does not replace a newer one");
  await put({ ...good, value: null, updated: 3000 });
  const removed = (await get("lesson-10")).notes;
  check(removed.value === null && removed.updated === 3000, "a removal is kept as the newest state");
  await put({ page: "lesson-11", key: "notes", value: '[{"id":"b"}]', updated: 10 });
  await put({ page: "course", key: "done", value: "[1,2]", updated: 10 });
  const all = (await (await api("GET", "")).json()).state;
  check(all["lesson-11"].notes.value === '[{"id":"b"}]' && all["lesson-10"].notes.value === null && all.course.done.value === "[1,2]", "pages are kept apart, and one request returns them all");
  await stop(); await start();
  check((await get("lesson-11")).notes.value === '[{"id":"b"}]', "the data survives a server restart");
  await api("DELETE", "?page=lesson-10"); await api("DELETE", "?page=lesson-11"); await api("DELETE", "?page=course");
  check(Object.keys((await (await api("GET", "")).json()).state).length === 0, "DELETE forgets a page");

  // ---- in the browser ----
  browser = await chromium.launch();
  const L10 = site + "lessons/10-pods-and-deployments.html";
  const errors = [];
  async function fresh(init) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    if (init) await ctx.addInitScript(init);
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => { if (m.type() === "error" && /Content Security Policy|Uncaught/i.test(m.text())) errors.push(m.text()); });
    return { ctx, page };
  }
  const backedUp = (page) => page.waitForFunction(() => window.__backup && window.__backup.state() === "ok" && document.querySelector("#backup-state .t")?.textContent === "Backed up");
  const noteIds = (page) => page.evaluate(() => JSON.parse(localStorage.getItem("infrasim.notes.10") || "[]").map((n) => n.id));

  const a = await fresh();
  await a.page.goto(L10);
  await backedUp(a.page);
  ok("the top bar says “Backed up” when the page is opened through the server");
  const word = await a.page.evaluate(() => {
    const p = document.querySelector("article h2 + p"); p.scrollIntoView({ block: "center", behavior: "instant" });
    const t = p.firstChild, i = t.data.indexOf("front"); const r = document.createRange(); r.setStart(t, i); r.setEnd(t, i + 5);
    const b = r.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
  });
  await a.page.waitForTimeout(200);
  await a.page.mouse.click(word.x, word.y, { button: "right" });
  await a.page.click('.note-menu [data-act="note"]');
  await a.page.fill("#note-text", "Backed up to SQLite.");
  await a.page.keyboard.press("Control+Enter");
  await a.page.waitForSelector("mark.note-hl");
  await a.page.click("#complete-btn");
  let saved = null;
  for (let i = 0; i < 40 && !(saved && saved.notes && saved.notes.value && saved.notes.value.includes("Backed up to SQLite.")); i++) { await a.page.waitForTimeout(100); saved = await get("lesson-10"); }
  const course = await get("course");
  check(saved.notes && saved.notes.value.includes("Backed up to SQLite.") && course.done && course.done.value === "[10]", "a new note and a completed lesson reach the database");
  await backedUp(a.page);
  const [firstId] = await noteIds(a.page);

  // wiped browser data comes back
  const b = await fresh();
  await b.page.goto(L10);
  await b.page.waitForSelector("mark.note-hl");
  check(await b.page.evaluate(() => document.querySelector("mark.note-hl").textContent === "front" && document.querySelector("#sidebar .lesson-link.active").classList.contains("done")),
    "a browser with no data gets the note and the completed lesson back");
  await b.ctx.close();

  // a browser that never synced keeps its own notes and adds the saved ones
  const c = await fresh(() => {
    if (!localStorage.getItem("infrasim.sync-ts") && !localStorage.getItem("infrasim.notes.10")) {
      localStorage.setItem("infrasim.notes.10", JSON.stringify([{ id: "local1", sec: "", offset: 5, quote: "Pods", text: "Written before the first sync", ts: 5 }]));
      localStorage.setItem("infrasim.completed.v1", "[3]");
    }
  });
  await c.page.goto(L10);
  await backedUp(c.page);
  const merged = await noteIds(c.page);
  const doneC = await c.page.evaluate(() => JSON.parse(localStorage.getItem("infrasim.completed.v1")));
  check(merged.includes("local1") && merged.includes(firstId) && doneC.includes(3) && doneC.includes(10), "a never-synced browser merges: its own note and tick plus the saved ones");
  let both = false;
  for (let i = 0; i < 40 && !both; i++) { await c.page.waitForTimeout(100); both = ((await get("lesson-10")).notes.value || "").includes("local1"); }
  check(both, "and the merged list is sent to the database");

  // a newer copy wins, including a removal
  await c.page.evaluate(() => localStorage.setItem("infrasim.notes.10", "[]"));
  let empty = false;
  for (let i = 0; i < 40 && !empty; i++) { await c.page.waitForTimeout(100); empty = (await get("lesson-10")).notes.value === "[]"; }
  await a.page.reload();
  await backedUp(a.page);
  check(empty && (await noteIds(a.page)).length === 0 && await a.page.evaluate(() => !document.querySelector("mark.note-hl")), "a newer copy wins in the other browser, including a removal");
  await c.ctx.close();

  // the server stops answering
  await a.page.route("**/api/state", (r) => r.abort());
  await a.page.evaluate(() => localStorage.setItem("infrasim.sections.10", JSON.stringify(["the-situation"])));
  await a.page.waitForFunction(() => document.querySelector("#backup-state .t")?.textContent === "Backup off");
  ok("the badge says “Backup off” when the server does not answer");
  await a.page.unroute("**/api/state");
  await a.page.evaluate(() => localStorage.setItem("infrasim.sections.10", JSON.stringify(["the-situation", "the-manifest"])));
  await backedUp(a.page);
  check(((await get("lesson-10")).sections || {}).value === '["the-situation","the-manifest"]', "and the change is sent once the server is back");
  check(errors.length === 0, "no page or CSP errors" + (errors.length ? ": " + errors[0] : ""));
  await a.ctx.close();

  // ---- export ----
  await put({ page: "lesson-10", key: "notes", value: JSON.stringify([{ id: "n1", quote: "front end", text: "Exported note", ts: Date.UTC(2026, 9, 11, 12, 30) }]), updated: Date.now() + 1000 });
  const md = execFileSync(process.execPath, ["--no-warnings", path.join(ROOT, "tools/export-notes.js")], { env: { ...process.env, INFRA_RECOVER_DB: DB }, encoding: "utf8" });
  check(md.includes("## Lesson 10: Pods, Deployments and Self-Healing") && md.includes("**front end**") && md.includes("Exported note") && md.includes("11 Oct 2026") && md.includes("Lessons completed: 2"), "the export tool prints notes with their date as Markdown");
  check(!existsSync(path.join(ROOT, "data", "test.db")), "the tests never touch the real database folder");
} catch (e) {
  fail(e.stack || String(e));
} finally {
  if (browser) await browser.close();
  await stop();
  rmSync(tmp, { recursive: true, force: true });
}
console.log(failures ? `\n${failures} check(s) failed` : "\nAll backup checks passed");
process.exit(failures ? 1 : 0);
