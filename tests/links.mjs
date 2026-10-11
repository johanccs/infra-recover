// Opens every external link in the site and reports the ones that do not answer.
// Needs network access, so it is not part of `npm test`. Run it with: npm run test:links
// Checked: every <a href="http…"> and <script src="http…"> in index.html, sandbox.html, 404.html and lessons/*.html,
// plus the libraries the AI tutor loads on demand. A link with a #fragment also has its anchor looked up in the page
// it points to; a missing anchor is a warning, because some sites create their anchors with JavaScript.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dns from "node:dns";
import net from "node:net";

// Some hosts publish an IPv6 address that a machine without IPv6 (WSL, for one) can never reach. Try IPv4 first
// and give each address time to answer, or those hosts are reported as timed out.
dns.setDefaultResultOrder("ipv4first");
if (net.setDefaultAutoSelectFamilyAttemptTimeout) net.setDefaultAutoSelectFamilyAttemptTimeout(5000);

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pages = ["index.html", "sandbox.html", "404.html"].concat(
  readdirSync(path.join(ROOT, "lessons")).filter((f) => f.endsWith(".html")).sort().map((f) => "lessons/" + f));
const UA = "Mozilla/5.0 (X11; Linux x86_64) infra-recover-link-check";
const TIMEOUT = 20000, PARALLEL = 6;

const found = new Map();   // url -> pages that use it
function add(url, where) {
  url = url.replace(/&amp;/g, "&");
  if (!found.has(url)) found.set(url, []);
  if (found.get(url).indexOf(where) === -1) found.get(url).push(where);
}
for (const page of pages) {
  const html = readFileSync(path.join(ROOT, page), "utf8");
  for (const m of html.matchAll(/<(?:a|script|link)\b[^>]*?\s(?:href|src)="(https?:\/\/[^"]+)"/g)) add(m[1], page);
}
const tutor = readFileSync(path.join(ROOT, "assets/js/ai-assistant.js"), "utf8");
for (const m of tutor.matchAll(/"(https:\/\/cdn\.jsdelivr\.net\/[^"]+)"/g)) add(m[1], "assets/js/ai-assistant.js");

async function get(url, method) {
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), TIMEOUT);
  try { return await fetch(url, { method, redirect: "follow", signal: ctl.signal, headers: { "user-agent": UA, accept: "text/html,*/*" } }); }
  finally { clearTimeout(timer); }
}
async function check(url) {
  const [bare, fragment] = url.split("#");
  let res, error = "";
  for (let attempt = 0; attempt < 2 && !(res && res.ok); attempt++) {
    try { res = await get(bare, "GET"); error = ""; }
    catch (e) { error = e.name === "AbortError" ? "timed out" : (e.cause && e.cause.code) || e.message; }
  }
  if (!res) return { url, ok: false, why: error };
  if (!res.ok) return { url, ok: false, why: "HTTP " + res.status };
  let warn = "";
  if (fragment) {
    const body = await res.text(), id = fragment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (!new RegExp('(?:id|name)=["\']?' + id + '["\'\\s>]').test(body)) warn = "page opens, but no #" + fragment + " anchor in its HTML";
  }
  return { url, ok: true, warn };
}

const urls = [...found.keys()].sort(), results = [];
let next = 0;
await Promise.all(Array.from({ length: PARALLEL }, async () => {
  while (next < urls.length) { const url = urls[next++]; results.push(await check(url)); }
}));

const bad = results.filter((r) => !r.ok), warned = results.filter((r) => r.ok && r.warn);
for (const r of warned) console.log(`  ! ${r.url}\n      ${r.warn} (${found.get(r.url).join(", ")})`);
for (const r of bad) console.error(`  ✗ ${r.url}\n      ${r.why} (${found.get(r.url).join(", ")})`);
console.log(bad.length ? `\n${bad.length} of ${urls.length} links did not open` : `  ✓ ${urls.length} external links open` + (warned.length ? ` (${warned.length} with a warning)` : ""));
process.exit(bad.length ? 1 : 0);
