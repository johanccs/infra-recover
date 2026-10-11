// End-to-end checks for the course site.
// Serves the repository under /infra-recover/ (like GitHub Pages) and drives Chromium with Playwright.
// Usage: npm ci && npx playwright install chromium && npm test
import { createServer } from "node:http";
import { readFile, readdir } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE = "/infra-recover/";
const AXE = await readFile(require.resolve("axe-core/axe.min.js"), "utf8");
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json" };

let failures = 0;
const fail = (msg) => { failures++; console.error("  ✗ " + msg); };
const ok = (msg) => console.log("  ✓ " + msg);
const check = (cond, msg) => (cond ? ok(msg) : fail(msg));

// ---------- static server ----------
const server = createServer(async (req, res) => {
  const url = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (!url.startsWith(BASE)) { res.writeHead(404); return res.end(); }
  let rel = url.slice(BASE.length) || "index.html";
  if (rel.endsWith("/")) rel += "index.html";
  const file = path.join(ROOT, rel);
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  try {
    const body = await readFile(file);
    res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404, { "content-type": "text/html; charset=utf-8" });
    res.end(await readFile(path.join(ROOT, "404.html")));
  }
});
await new Promise((r) => server.listen(0, r));
const origin = `http://127.0.0.1:${server.address().port}`;
const lessons = (await readdir(path.join(ROOT, "lessons"))).filter((f) => f.endsWith(".html")).sort();
const pages = ["index.html", "sandbox.html", ...lessons.map((f) => "lessons/" + f)];

const browser = await chromium.launch();

async function open(p, opts = {}) {
  const page = await browser.newPage(opts);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && /Content Security Policy|Uncaught/i.test(m.text())) errors.push(m.text()); });
  await page.goto(origin + BASE + p);
  return { page, errors };
}

try {
  // ---------- 1. every page renders ----------
  console.log(`\n1. Pages render (${pages.length})`);
  for (const p of pages) {
    const { page, errors } = await open(p);
    const r = await page.evaluate(() => ({
      sidebar: document.querySelectorAll("#sidebar a.lesson-link").length,
      quiz: document.querySelectorAll(".quiz").length,
      labs: document.querySelectorAll("[data-lab]").length,
      labsReady: document.querySelectorAll("[data-lab].lab-ready").length,
      goal: !!document.querySelector(".goal"),
      overflow: document.documentElement.scrollWidth > window.innerWidth,
      dupIds: (() => { const ids = [...document.querySelectorAll("[id]")].map((e) => e.id); return ids.length - new Set(ids).size; })(),
    }));
    const isLesson = p.startsWith("lessons/");
    const problems = [];
    if (r.sidebar !== lessons.length + 2) problems.push(`sidebar links ${r.sidebar}`);
    if (isLesson && r.labs < 1) problems.push("no scenario");
    if (isLesson && r.labs !== r.labsReady) problems.push(`scenarios not mounted ${r.labsReady}/${r.labs}`);
    if (isLesson && r.quiz !== 3) problems.push(`quizzes ${r.quiz}`);
    if (!r.goal) problems.push("no goal section");
    if (r.overflow) problems.push("horizontal overflow");
    if (r.dupIds) problems.push(`${r.dupIds} duplicate ids`);
    if (errors.length) problems.push("errors: " + errors.join(" | "));
    problems.length ? fail(`${p}: ${problems.join(", ")}`) : null;
    await page.close();
  }
  if (!failures) ok("all pages render with sidebar, goal, quizzes, scenarios, unique ids and no errors");

  // ---------- 2. internal links resolve ----------
  console.log("\n2. Internal links");
  {
    const { page } = await open("index.html");
    const hrefs = new Set();
    for (const p of pages) {
      await page.goto(origin + BASE + p);
      for (const h of await page.$$eval("a[href]", (as) => as.map((a) => a.href))) if (h.startsWith(origin)) hrefs.add(h.split("#")[0]);
    }
    let broken = 0;
    for (const h of hrefs) { const r = await fetch(h); if (r.status !== 200) { broken++; fail(`broken link ${h} (${r.status})`); } }
    check(broken === 0, `${hrefs.size} internal links resolve`);
    await page.close();
  }

  // ---------- 3. accessibility (axe, both themes) ----------
  console.log("\n3. Accessibility (axe-core, WCAG 2.1 AA)");
  for (const scheme of ["light", "dark"]) {
    let total = 0;
    for (const p of pages) {
      const { page } = await open(p, { colorScheme: scheme, bypassCSP: true });   // axe is injected inline
      await page.addScriptTag({ content: AXE });
      await page.evaluate(() => document.querySelector(".quiz button.opt")?.click());
      if (p === "lessons/12-configmaps-and-secrets.html" || p === "sandbox.html") {   // also check a running scenario (terminal, tasks, diagnosis)
        if (p === "sandbox.html") await page.click('.lib-card[data-id="k-fix-netpol"]');
        await page.click('.lab [data-act="start"]');
        await page.waitForSelector(".term input");
        await page.fill(".term input", "kubectl get pods -A"); await page.keyboard.press("Enter");
        await page.waitForFunction(() => !document.querySelector(".term.busy"));
        await page.evaluate(() => { document.querySelectorAll("details").forEach((d) => { d.open = true; }); });
      }
      const v = await page.evaluate(async () => (await axe.run(document, { runOnly: ["wcag2a", "wcag2aa", "wcag21aa", "best-practice"] })).violations);
      for (const x of v) { total++; fail(`${scheme} ${p}: ${x.id} (${x.nodes.length}) ${x.help}`); }
      await page.close();
    }
    check(total === 0, `no axe violations in ${scheme} mode`);
  }

  // ---------- 4. interactions: quiz, progress, search ----------
  console.log("\n4. Interactions");
  {
    const { page } = await open("lessons/11-services-and-dns.html");
    await page.click(".quiz button.opt[data-opt='a']");
    check(await page.$eval(".quiz", (q) => q.classList.contains("answered")), "quiz records an answer and shows the explanation");
    await page.click("#complete-btn");
    await page.goto(origin + BASE + "index.html");
    check((await page.textContent("#progress-pill")).startsWith("1 /"), "completion persists and shows on the home page");
    await page.keyboard.press("/");
    await page.keyboard.type("CrashLoopBackOff");
    await page.waitForSelector(".search-hit", { timeout: 5000 });
    const first = await page.$eval(".search-hit", (a) => a.getAttribute("href"));
    check(/15-the-debugging-loop\.html/.test(first), `search finds the debugging-loop lesson first (${first})`);
    await page.click(".search-hit");
    await page.waitForLoadState();
    check(page.url().includes("15-the-debugging-loop.html"), "search result navigates to the lesson");
    await page.close();
  }

  // ---------- 4a. the sandbox: terminal, task checks, editor, scenario library ----------
  console.log("\n4a. Sandbox");
  {
    const { page, errors } = await open("lessons/01-first-container.html", { viewport: { width: 1280, height: 900 } });
    const run = async (cmd) => { await page.fill(".term input", cmd); await page.keyboard.press("Enter"); await page.waitForFunction(() => !document.querySelector(".term.busy"), null, { timeout: 60000 }); };
    await page.click('.lab [data-act="start"]');
    await page.waitForSelector(".term input");
    await run("docker run hello-world");
    check((await page.textContent(".term-out")).includes("Hello from Docker!"), "a command typed in the terminal runs in the simulator");
    await run("docker run -d --name web -p 8080:80 nginx:1.29");
    await run("curl -s localhost:8080 | head -4");
    await run("docker ps");
    check((await page.textContent(".term-out")).includes("0.0.0.0:8080->80/tcp"), "pipes work and docker ps shows the published port");
    check((await page.$$eval(".lab-task.done", (l) => l.length)) === 3, "tasks are ticked off as the learner completes them");
    await page.locator(".term input").pressSequentially("docker lo"); await page.keyboard.press("Tab");
    check((await page.inputValue(".term input")).startsWith("docker log"), "Tab completes sub-commands");
    await page.fill(".term input", ""); await page.keyboard.press("ArrowUp");
    check((await page.inputValue(".term input")) === "docker ps", "↑ recalls the previous command");
    await run("docker rm -f web");
    await page.waitForSelector(".lab.lab-done", { timeout: 5000 });
    check(await page.isVisible(".lab-solution[open] .callout"), "solving the scenario marks it done and reveals the explanation");
    await page.fill(".term input", "nano notes.txt"); await page.keyboard.press("Enter");
    await page.waitForSelector(".sim-editor textarea");
    await page.fill(".sim-editor textarea", "hello from the editor");
    await page.keyboard.press("Control+s");
    await page.waitForFunction(() => !document.querySelector(".term.busy"));
    await run("cat notes.txt");
    check((await page.textContent(".term-out")).includes("hello from the editor"), "nano opens the editor dialog and saves the file");
    check((await page.$eval(".lab", (l) => l.scrollWidth <= l.clientWidth + 1)), "the terminal stays inside the scenario panel");
    check(errors.length === 0, "no page errors in the lesson sandbox" + (errors.length ? ": " + errors.join(" | ") : ""));

    await page.goto(origin + BASE + "sandbox.html");
    const cards = await page.$$eval(".lib-card", (c) => c.length);
    const labCount = await page.evaluate(() => Object.keys(window.InfraSim.labs).length);
    check(cards === labCount && cards > 40, `the library lists every scenario (${cards})`);
    check(await page.$eval('.lib-card[data-id="d-first"]', (c) => c.classList.contains("done")), "solved scenarios are remembered across pages");
    await page.click('[data-kind="fix"]');
    const fixCards = await page.$$eval(".lib-card", (c) => c.length);
    const home = await (await fetch(origin + BASE + "index.html")).text();
    check(home.includes(`${labCount} scenarios, ${fixCards} of them broken`), `the home page states the real scenario counts (${labCount} total, ${fixCards} fix-it)`);
    await page.click('.lib-card[data-id="k-fix-service"]');
    await page.click('#stage .lab [data-act="start"]');
    await page.waitForSelector("#stage .term input");
    await run("kubectl -n shop get endpoints api");
    check(/api\s+<none>/.test(await page.textContent("#stage .term-out")), "a fix-it scenario starts in its broken state");
    await run(`kubectl -n shop patch service api -p '{"spec":{"selector":{"app":"api"}}}'`);
    await page.click('.lab-diagnose button.opt[data-i="1"]');
    check(await page.$eval('.lab-diagnose button.opt[data-i="1"]', (b) => b.classList.contains("correct")), "the diagnosis question accepts the right answer");
    await run("kubectl -n shop run tmp --rm -it --restart=Never --image=curlimages/curl -- curl -s http://web");
    check((await page.textContent("#stage .term-out")).includes("Products: Keyboard"), "the fix makes the simulated shop work end to end");
    check(errors.length === 0, "no page errors on the sandbox page" + (errors.length ? ": " + errors.join(" | ") : ""));
    await page.close();
  }

  // ---------- 4b. sidebar resize and collapse ----------
  console.log("\n4b. Sidebar resize and collapse");
  {
    const { page, errors } = await open("lessons/03-ports-env-restarts.html", { viewport: { width: 1280, height: 800 } });
    const navWidth = () => page.$eval("#sidebar", (n) => Math.round(n.getBoundingClientRect().width));
    const box = await page.locator(".sidebar-resizer").boundingBox();
    const y = box.y + 300;
    await page.mouse.move(box.x + box.width / 2, y);
    await page.mouse.down();
    await page.mouse.move(box.x + 150, y, { steps: 5 });
    await page.mouse.up();
    const dragged = await navWidth();
    check(dragged > 400 && dragged <= 560, `dragging the border widens the menu (${dragged}px)`);
    await page.reload();
    check(Math.abs((await navWidth()) - dragged) <= 1, "the width is remembered after reload");
    await page.click(".sidebar-toggle");
    check(!(await page.isVisible("#sidebar")), "« hides the menu");
    await page.reload();
    check(!(await page.isVisible("#sidebar")) && (await page.textContent(".sidebar-toggle")) === "»", "hidden state is remembered and shows »");
    await page.click(".sidebar-toggle");
    check(await page.isVisible("#sidebar") && Math.abs((await navWidth()) - dragged) <= 1, "» shows the menu at its saved width");
    await page.focus(".sidebar-resizer");
    await page.keyboard.press("Home");
    check((await navWidth()) === 200, "keyboard (Home) resizes the menu to its minimum");
    await page.dblclick(".sidebar-resizer");
    check((await navWidth()) === 300, "double-click resets the default width");
    const pkg = JSON.parse(await readFile(path.join(ROOT, "package.json"), "utf8"));
    check((await page.textContent(".topbar .version")) === "v" + pkg.version, `top bar shows the version from package.json (v${pkg.version})`);
    check(errors.length === 0, "no page errors while resizing" + (errors.length ? ": " + errors.join(" | ") : ""));
    await page.close();
  }

  // ---------- 4c. reading tools: theme, text size, reading bar, line numbers, diagrams, notes ----------
  console.log("\n4c. Reading tools");
  {
    const { page, errors } = await open("lessons/11-services-and-dns.html", { viewport: { width: 1440, height: 900 }, colorScheme: "dark" });
    const theme = () => page.evaluate(() => document.documentElement.getAttribute("data-theme"));
    const seen = [await theme()];
    for (let i = 0; i < 3; i++) { await page.click("#theme-btn"); seen.push(await theme()); }
    check(JSON.stringify(seen) === JSON.stringify([null, "light", "dark", null]), "theme button cycles Auto → Light → Dark → Auto");
    await page.click("#theme-btn");
    await page.reload();
    check((await theme()) === "light" && (await page.textContent("#theme-btn")).includes("Light"), "the chosen theme is remembered after reload");

    const zoom = () => page.evaluate(() => getComputedStyle(document.querySelector(".content")).zoom);
    await page.click("#font-up"); await page.click("#font-up");
    check((await zoom()) === "1.2" && (await page.textContent("#font-reset")) === "120%", "A+ enlarges the lesson text (120%)");
    await page.reload();
    check((await zoom()) === "1.2", "the text size is remembered after reload");
    await page.click("#font-reset");
    check((await zoom()) === "1" && (await page.textContent("#font-reset")) === "100%", "the percentage button resets the text size");
    for (let i = 0; i < 2; i++) await page.click("#font-down");
    check(await page.isDisabled("#font-down") && (await page.textContent("#font-reset")) === "80%", "A− stops at 80%");
    await page.click("#font-reset");

    const bar = () => page.$eval("#readbar", (b) => new DOMMatrix(getComputedStyle(b).transform).a);
    const atTop = await bar();
    await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" }));
    await page.waitForFunction(() => new DOMMatrix(getComputedStyle(document.querySelector("#readbar")).transform).a > 0.98);
    check(atTop < 0.02 && (await bar()) > 0.98, "the reading bar fills as the lesson is scrolled");

    const code = await page.evaluate(() => {
      const pre = [...document.querySelectorAll("article > pre")].find((p) => p.dataset.label === "service.yaml");
      const out = [...document.querySelectorAll("article > pre")].find((p) => p.querySelector("code.language-plaintext"));
      const oneLine = [...document.querySelectorAll("pre > code")].find((c) => !c.textContent.trim().includes("\n"));
      return { nums: pre.querySelector(".ln").textContent.split("\n").length, lines: pre.querySelector("code").textContent.split("\n").length,
        copied: pre.querySelector("code").innerText.startsWith("apiVersion: v1"), outNumbered: out.classList.contains("numbered"),
        oneLineNumbered: !!oneLine && oneLine.parentElement.classList.contains("numbered") };
    });
    check(code.nums === code.lines && code.nums > 5, `code blocks show one number per line (${code.nums})`);
    check(code.copied && !code.outNumbered && !code.oneLineNumbered, "numbers are not copied; terminal output and one-liners stay unnumbered");

    const fig = page.locator("figure.anim");
    await fig.scrollIntoViewIfNeeded();
    check((await page.locator("figure.anim.anim-ready").count()) === 1 && (await fig.locator(".anim-count").textContent()) === "1 / 5", "the animated diagram starts at step 1 of 5");
    const first = await fig.locator(".anim-text").textContent();
    await fig.locator('[data-act="next"]').click();
    check((await fig.locator(".anim-count").textContent()) === "2 / 5" && (await fig.locator(".anim-text").textContent()) !== first, "▶ shows the next step and its caption");
    check((await fig.locator('[data-act="play"]').textContent()) === "Play" && (await fig.locator('[data-k="pod1"]').getAttribute("class")).includes("on"), "stepping pauses playback and lights up the pod on the route");
    await fig.locator('[data-act="back"]').click();
    check((await fig.locator(".anim-count").textContent()) === "1 / 5", "◀ goes back a step");
    await page.waitForTimeout(600);   // let the fade between steps finish before checking contrast
    await page.close();

    for (const f of ["10-pods-and-deployments", "13-rollouts-and-rollbacks", "24-sync-policies"]) {
      const { page: p2, errors: e2 } = await open(`lessons/${f}.html`);
      const n = await p2.locator("figure.anim.anim-ready").count();
      const steps = Number((await p2.locator("figure.anim .anim-count").textContent()).split("/")[1]);
      let walked = 0;
      for (let i = 0; i < steps; i++) { await p2.locator('figure.anim [data-act="next"]').click(); walked++; }
      check(n === 1 && steps >= 5 && (await p2.locator("figure.anim .anim-count").textContent()) === `1 / ${steps}` && e2.length === 0, `${f}: diagram steps through all ${walked} steps and wraps round`);
      await p2.close();
    }
    {
      const { page: p3 } = await open("lessons/11-services-and-dns.html", { reducedMotion: "reduce" });
      check((await p3.locator('figure.anim [data-act="play"]').textContent()) === "Play", "diagrams do not autoplay when reduced motion is requested");
      await p3.close();
    }
    check(errors.length === 0, "no page or CSP errors" + (errors.length ? ": " + errors.join(" | ") : ""));
  }

  console.log("\n4d. Notes");
  for (const scheme of ["light", "dark"]) {
    const { page, errors } = await open("lessons/11-services-and-dns.html", { viewport: { width: 1440, height: 900 }, colorScheme: scheme, bypassCSP: true });   // axe is injected inline
    const before = await page.$eval("article", (a) => a.textContent.length);
    const word = await page.evaluate(() => {
      const p = document.querySelector("article h2 + p"); p.scrollIntoView({ block: "center", behavior: "instant" });
      const t = p.firstChild, i = t.data.indexOf("front"); const r = document.createRange(); r.setStart(t, i); r.setEnd(t, i + 5);
      const b = r.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
    });
    await page.waitForTimeout(200);   // let the scroll settle: scrolling closes the menu
    await page.mouse.click(word.x, word.y, { button: "right" });
    check(await page.isVisible(".note-menu") && (await page.textContent(".note-menu .sub")).includes("front"), `${scheme}: right-clicking a word offers “Add a note” for that word`);
    await page.click('.note-menu [data-act="note"]');
    check(await page.isDisabled('.note-dlg [data-act="save"]'), "Save is disabled while the note is empty");
    await page.fill("#note-text", "The front end is the web Deployment.");
    await page.keyboard.press("Control+Enter");
    await page.waitForSelector(".notes-pane .note-card");
    const st = await page.evaluate(() => ({ mark: document.querySelector("mark.note-hl")?.textContent, pane: !document.querySelector(".notes-pane").hidden,
      count: document.querySelector(".notes-count").textContent, date: document.querySelector(".note-date").textContent.length > 6,
      len: document.querySelector("article").textContent.length, overflow: document.documentElement.scrollWidth > innerWidth }));
    check(st.mark === "front" && st.pane && st.count === "1" && st.date, "Ctrl+Enter saves: the word is highlighted and the note card shows its date");
    check(st.len === before && !st.overflow, "highlighting leaves the lesson text unchanged and the page does not overflow");
    await page.waitForFunction(() => document.querySelectorAll(".notes-lines path").length === 1);
    ok("a line joins the highlighted word to its note");
    if (scheme === "light") {
      await page.addScriptTag({ content: AXE });
      const v = await page.evaluate(async () => (await axe.run(document, { runOnly: ["wcag2a", "wcag2aa", "wcag21aa", "best-practice"] })).violations);
      check(v.length === 0, "notes panel and highlight have no axe violations" + (v.length ? ": " + v.map((x) => x.id).join(", ") : ""));
    } else {
      await page.addScriptTag({ content: AXE });
      const v = await page.evaluate(async () => (await axe.run(document, { runOnly: ["wcag2a", "wcag2aa", "wcag21aa", "best-practice"] })).violations);
      check(v.length === 0, "dark: notes panel and highlight have no axe violations" + (v.length ? ": " + v.map((x) => x.id).join(", ") : ""));
    }
    await page.reload();
    await page.waitForSelector("mark.note-hl");
    check((await page.textContent("mark.note-hl")) === "front" && await page.isVisible(".notes-pane .note-card"), "the note and its highlight are restored after reload");
    await page.click("#notes-mode");
    check(await page.$eval(".notes-pane", (p) => p.classList.contains("list")) && (await page.textContent(".note-step")) === "The situation", "list mode shows each note with its section heading");
    await page.click("#notes-mode");
    await page.click("mark.note-hl");
    await page.fill("#note-text", "Edited text.");
    await page.click('.note-dlg [data-act="save"]');
    check((await page.textContent(".note-card .note-text")) === "Edited text." && (await page.textContent(".note-date")).startsWith("Edited"), "clicking the highlight edits the note and marks it as edited");
    await page.click(".note-card .note-edit");
    await page.click('.note-dlg [data-act="del"]');
    check((await page.locator("mark.note-hl").count()) === 1, "Delete asks for a second click");
    await page.click('.note-dlg [data-act="del"]');
    check((await page.locator("mark.note-hl").count()) === 0 && (await page.$eval("article", (a) => a.textContent.length)) === before && await page.isHidden(".notes-count"), "deleting removes the highlight and the card");
    check(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
    await page.close();
  }
  {
    const { page } = await open("lessons/11-services-and-dns.html", { viewport: { width: 390, height: 800 } });
    await page.click("#font-up"); await page.click("#font-up"); await page.click("#notes-btn");
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth) && await page.isVisible(".notes-pane.list"), "on a phone the notes open as a list sheet and larger text does not overflow");
    await page.close();
  }

  console.log("\n4e. Bookmarks and resume");
  {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });   // one context, so storage survives a second tab
    const errors = [];
    const url = origin + BASE + "lessons/11-services-and-dns.html";
    const page = await context.newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(url);
    const before = await page.$eval("article", (a) => a.textContent);
    const word = await page.evaluate(() => {
      const h = [...document.querySelectorAll("article h2")].find((x) => x.textContent === "Cluster DNS");
      const p = h.nextElementSibling; p.scrollIntoView({ block: "center", behavior: "instant" });
      const t = p.firstChild, i = t.data.indexOf("cluster"); const r = document.createRange(); r.setStart(t, i); r.setEnd(t, i + 7);
      const b = r.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
    });
    await page.waitForTimeout(200);   // let the scroll settle: scrolling closes the menu
    await page.mouse.click(word.x, word.y, { button: "right" });
    await page.click('.note-menu [data-act="bm"]');
    const flag = await page.evaluate(() => ({ text: document.querySelector("mark.bm-hl")?.textContent, flag: getComputedStyle(document.querySelector("mark.bm-start"), "::before").content, toast: document.querySelector(".bm-toast").textContent }));
    check(flag.text === "cluster" && flag.flag.includes("⚑") && flag.toast.includes("Bookmarked"), "“Bookmark this spot” puts a flag before the word and confirms it");
    check((await page.$eval("article", (a) => a.textContent)) === before, "the bookmark leaves the lesson text unchanged");
    await page.click("#bm-btn");
    check(await page.isVisible("#bm-list") && (await page.textContent("#bm-list .bm-item .t >> nth=-1")).includes("cluster") && (await page.textContent("#bm-list .bm-item .s >> nth=-1")).startsWith("Cluster DNS · "), "the Bookmarks list shows the words, the section and the date");
    await page.keyboard.press("Escape");
    check(await page.isHidden("#bm-list"), "Escape closes the Bookmarks list");

    const y = await page.evaluate(() => window.scrollY);
    await page.waitForTimeout(700);   // the place is saved once scrolling stops
    await page.reload();
    await page.waitForSelector(".bm-toast:not([hidden])");
    await page.waitForTimeout(700);
    const y2 = await page.evaluate(() => window.scrollY);
    check(Math.abs(y2 - y) < 40 && (await page.textContent(".bm-toast")).includes("Back where you left off: "), `reopening the lesson returns to the saved place (${Math.round(y)} → ${Math.round(y2)})`);
    check((await page.textContent("mark.bm-hl")) === "cluster", "the bookmark survives a reload");
    await page.click(".bm-toast button");
    await page.waitForFunction(() => window.scrollY < 5);
    ok("“Start at the top” scrolls back to the top");
    await page.click("#bm-btn");
    await page.click("#bm-list .bm-item .bm-go >> nth=-1");
    await page.waitForFunction(() => { const r = document.querySelector("mark.bm-hl").getBoundingClientRect(); return r.top > 100 && r.bottom < innerHeight - 100; });
    ok("clicking a bookmark scrolls to it");
    await page.waitForTimeout(700);

    const linked = await context.newPage();
    await linked.goto(url + "#the-service-checklist");
    await linked.waitForTimeout(900);
    check(await linked.evaluate(() => { const r = document.getElementById("the-service-checklist").getBoundingClientRect(); return r.top > 0 && r.top < 200 && document.querySelector(".bm-toast").hidden; }), "a link to a heading wins over the saved place");
    await linked.close();

    const m = await page.locator("mark.bm-hl").boundingBox();
    await page.mouse.click(m.x + m.width - 4, m.y + m.height / 2, { button: "right" });
    check((await page.textContent('.note-menu [data-act="bm"]')) === "Remove bookmark", "right-clicking a bookmarked word offers “Remove bookmark”");
    await page.click('.note-menu [data-act="bm"]');
    check((await page.locator("mark.bm-hl").count()) === 0 && (await page.$eval("article", (a) => a.textContent)) === before, "removing the bookmark leaves the text unchanged");
    await page.click("#bm-btn");
    check((await page.textContent("#bm-list")).includes("None yet") && (await page.textContent("#bm-list")).includes("Where you stopped"), "the empty list says how to add a bookmark and still offers “Where you stopped”");
    check(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
    await context.close();
  }
  {
    const { page } = await open("lessons/11-services-and-dns.html", { viewport: { width: 390, height: 800 }, bypassCSP: true });
    await page.click("#bm-btn");
    await page.addScriptTag({ content: AXE });
    const v = await page.evaluate(async () => (await axe.run(document, { runOnly: ["wcag2a", "wcag2aa", "wcag21aa", "best-practice"] })).violations);
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth) && v.length === 0, "phone: the top bar fits and the open Bookmarks list has no axe violations" + (v.length ? ": " + v.map((x) => x.id).join(", ") : ""));
    await page.close();
  }

  // ---------- 4f. sections in the menu, glossary and line by line ----------
  console.log("\n4f. Section ticks and explanations");
  {
    const { page, errors } = await open("lessons/10-pods-and-deployments.html", { viewport: { width: 1280, height: 800 }, bypassCSP: true });
    const first = await page.evaluate(() => {
      const links = [...document.querySelectorAll("#sidebar .section-list a")];
      const heads = [...document.querySelectorAll("article h2:not(.box-title)")];
      return { n: links.length, heads: heads.length, read: links.filter((a) => a.classList.contains("read")).length,
        after: document.querySelector("#sidebar .lesson-link.active").nextElementSibling.className, brand: document.querySelector(".brand").textContent };
    });
    check(first.n > 3 && first.n === first.heads && first.after === "section-list", `the open lesson lists its ${first.n} sections in the menu`);
    check(first.read === 0, "no section is ticked before you read");
    check(await page.evaluate(() => document.getElementById("backup-state").hidden && !window.__backup), "on a plain file server there is no backup badge");
    check(first.brand.includes("infra-recover") && (await page.title()).endsWith("· infra-recover"), "the site is named infra-recover in the top bar and the title");
    // scroll past the first two sections
    await page.evaluate(() => { const h = document.querySelectorAll("article h2:not(.box-title)")[2]; window.scrollTo(0, h.getBoundingClientRect().top + scrollY - 100); });
    await page.waitForFunction(() => document.querySelectorAll("#sidebar .section-list a.read").length === 2 &&
      document.querySelector("#sidebar .section-list a.now")?.getAttribute("data-section") === document.querySelectorAll("article h2:not(.box-title)")[2].id);
    const mid = await page.evaluate(() => ({ now: document.querySelector("#sidebar .section-list a.now")?.getAttribute("data-section"),
      third: document.querySelectorAll("article h2:not(.box-title)")[2].id, cur: document.querySelector("#sidebar .section-list a.now")?.getAttribute("aria-current") }));
    check(mid.now === mid.third && mid.cur === "location", "scrolling past two sections ticks them and marks the one being read" + (mid.now === mid.third ? "" : `: ${JSON.stringify(mid)}`));
    await page.reload();
    await page.waitForFunction(() => document.querySelectorAll("#sidebar .section-list a.read").length >= 2);
    ok("the ticks survive a reload");
    // jump to the last section through the menu
    await page.click("#sidebar .section-list li:last-child a");
    await page.waitForFunction(() => document.querySelectorAll("#sidebar .section-list a:not(.read)").length <= 1);
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.waitForFunction(() => document.querySelectorAll("#sidebar .section-list a:not(.read)").length === 0);
    ok("jumping past sections ticks them, and the end of the lesson ticks the last one");
    check(await page.evaluate(() => !document.querySelector("#sidebar .lesson-link.active").classList.contains("done")), "the lesson itself is still only completed with its button");

    // glossary and line by line
    const ex = await page.evaluate(() => {
      const g = document.querySelector("details.glossary"), l = document.querySelector("details.lbl");
      return { g: !!g && !g.open && g.querySelectorAll("dt").length, l: !!l && !l.open && l.querySelectorAll("dt").length,
        afterCode: l && l.previousElementSibling.tagName, afterObjectives: g && g.previousElementSibling.className };
    });
    check(ex.g >= 4 && ex.afterObjectives === "objectives", `a closed glossary of ${ex.g} terms follows the objectives`);
    check(ex.l >= 4 && ex.afterCode === "PRE", `a closed “Line by line” section of ${ex.l} rows follows the manifest`);
    await page.click("details.lbl > summary");
    await page.click("details.glossary > summary");
    check(await page.isVisible("details.lbl dd") && await page.isVisible("details.glossary dd"), "both open on a click");
    await page.addScriptTag({ content: AXE });
    const v = await page.evaluate(async () => (await axe.run(document, { runOnly: ["wcag2a", "wcag2aa", "wcag21aa", "best-practice"] })).violations);
    check(v.length === 0, "section list and open explanations have no axe violations" + (v.length ? ": " + v.map((x) => x.id + " " + x.nodes[0].target).join(", ") : ""));
    if (process.env.SHOTS) { await page.locator("details.lbl").scrollIntoViewIfNeeded(); await page.screenshot({ path: process.env.SHOTS + "/lbl.png" }); }
    check(errors.length === 0, "no script errors" + (errors.length ? ": " + errors[0] : ""));
    await page.close();

    const counts = await Promise.all(lessons.map(async (f) => { const h = await readFile(path.join(ROOT, "lessons", f), "utf8"); return (h.match(/<details class="glossary">/g) || []).length; }));
    check(counts.every((n) => n === 1), "every lesson has one glossary");

    const phone = await open("lessons/10-pods-and-deployments.html", { viewport: { width: 390, height: 800 } });
    await phone.page.click("details.lbl > summary");
    await phone.page.click("details.glossary > summary");
    check(await phone.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "open explanations do not widen the page on a phone");
    await phone.page.click("#menu-btn");
    await phone.page.click("#sidebar .section-list li:nth-child(2) a");
    check(await phone.page.evaluate(() => !document.body.classList.contains("nav-open")), "on a phone, choosing a section closes the menu");
    await phone.page.close();
  }

  // ---------- 5. AI tutor with a mocked OpenAI API ----------
  console.log("\n5. AI tutor (mocked API)");
  {
    const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "GET,POST,OPTIONS" };
    const sse = (evs) => evs.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join("");
    const answer = "**Direct answer.**\n\n```bash\nkubectl get endpoints api\n```";
    const bodies = [];
    const { page, errors } = await open("lessons/11-services-and-dns.html", { bypassCSP: true });   // axe is injected inline
    await page.route("https://api.openai.com/**", async (route) => {
      const req = route.request();
      if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
      if (req.url().endsWith("/models")) return route.fulfill({ status: 200, headers: { ...cors, "content-type": "application/json" }, body: JSON.stringify({ data: [{ id: "gpt-6-sol" }] }) });
      const b = JSON.parse(req.postData()); bodies.push(b);
      if (bodies.length === 1) return route.fulfill({ status: 400, headers: { ...cors, "content-type": "application/json" }, body: JSON.stringify({ error: { message: "Unsupported parameter: 'reasoning.effort'" } }) });
      return route.fulfill({ status: 200, headers: { ...cors, "content-type": "text/event-stream" }, body: sse([
        { type: "response.web_search_call.searching" },
        ...answer.match(/.{1,12}/gs).map((d) => ({ type: "response.output_text.delta", delta: d })),
        { type: "response.output_text.annotation.added", annotation: { type: "url_citation", url: "https://kubernetes.io/docs/concepts/services-networking/service/", title: "Kubernetes docs" } },
        { type: "response.completed", response: { usage: { total_tokens: 42 }, output: [] } },
      ]) });
    });
    const sel = await page.evaluate(() => {
      const p = document.querySelector("article h2 + p"); p.scrollIntoView({ block: "center", behavior: "instant" });
      const r = document.createRange(); r.selectNodeContents(p);
      getSelection().removeAllRanges(); getSelection().addRange(r); const b = r.getClientRects()[0];
      return { x: b.left + 10, y: b.top + 5, text: p.textContent.trim().slice(0, 30) };
    });
    await page.waitForTimeout(200);   // let the scroll settle: scrolling closes the menu
    await page.mouse.click(sel.x, sel.y, { button: "right" });
    check(await page.isVisible(".note-menu") && !(await page.isVisible(".ai-modal")), "right-clicking selected text offers a note or the tutor");
    await page.click('.note-menu [data-act="ask"]');
    await page.waitForSelector(".ai-modal", { state: "visible", timeout: 3000 }).catch(() => {});
    check(await page.isVisible(".ai-modal"), "“Ask the AI tutor” in that menu opens the tutor");
    check(await page.isVisible(".ai-settings"), "settings are shown when no API key is stored");
    await page.fill("#ai-key", "sk-test");
    await page.click('[data-s="save"]');
    await page.click(".ai-chips button");
    await page.waitForSelector(".ai-msg.assistant .meta-line:not([hidden])", { timeout: 8000 });
    check(await page.$eval(".ai-msg.assistant .bubble", (b) => b.innerHTML.includes("<pre>")), "streamed Markdown answer renders code blocks");
    check((await page.textContent(".ai-sources")).includes("Kubernetes docs"), "web-search citations are listed as sources");
    check(bodies.length === 2 && !bodies[1].reasoning && bodies[1].store === false, "unsupported reasoning falls back once; requests use store:false");
    check(bodies[1].instructions.includes(sel.text) && bodies[1].instructions.includes("Lesson 11"), "prompt includes the selected passage and lesson context");
    await page.addScriptTag({ content: AXE });
    const v = await page.evaluate(async () => (await axe.run(".ai-modal", { runOnly: ["wcag2a", "wcag2aa"] })).violations);
    check(v.length === 0, "AI modal has no axe violations" + (v.length ? ": " + v.map((x) => x.id).join(",") : ""));
    // Focus can legitimately leave the modal (e.g. clicking plain text in it); Escape must still close it
    await page.evaluate(() => document.activeElement && document.activeElement.blur());
    await page.keyboard.press("Escape");
    check(!(await page.isVisible(".ai-modal")), "Escape closes the modal, even when focus has left it");
    check(errors.length === 0, "no page or CSP errors" + (errors.length ? ": " + errors.join(" | ") : ""));
    await page.close();
  }

  // ---------- 6. 404 ----------
  console.log("\n6. Not-found page");
  {
    const r = await fetch(origin + BASE + "lessons/99-does-not-exist.html");
    check(r.status === 404 && (await r.text()).includes("Page not found"), "unknown URLs serve the 404 page");
  }
} finally {
  await browser.close();
  server.close();
}

console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
process.exit(failures ? 1 : 0);
