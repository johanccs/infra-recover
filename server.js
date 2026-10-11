// Optional local server for the course.
// The site is static and works from GitHub Pages or any file server. Run it through this server instead and your notes,
// bookmarks, reading place, ticked sections, completed lessons and solved scenarios are also kept in a SQLite file, so a
// new browser or a cleared profile gets them back.
//
//   npm start          then open http://localhost:8790/infra-recover/
//
// Settings (environment variables): PORT (default 8790), INFRA_RECOVER_DB (default data/infra-recover.db).
// The database is created on first start with Node's built-in node:sqlite (Node 22.13 or newer, nothing to install).
'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const PORT = Number(process.env.PORT) || 8790;
const ROOT = __dirname;
const BASE = '/infra-recover/';                                       // the same path as on GitHub Pages
const DB_FILE = process.env.INFRA_RECOVER_DB ? path.resolve(process.env.INFRA_RECOVER_DB) : path.join(ROOT, 'data', 'infra-recover.db');
const ORIGINS = [`http://localhost:${PORT}`, `http://127.0.0.1:${PORT}`];
const HOSTS = new RegExp(`^(localhost|127\\.0\\.0\\.1):${PORT}$`);   // refuse other Host names (DNS rebinding)
const STATE_KEYS = new Set(['notes', 'bookmarks', 'pos', 'sections', 'done', 'labs']);   // what the pages back up
const MAX_STATE = 512 * 1024;
const SITE = /^(index\.html|sandbox\.html|404\.html|(lessons|assets)\/[\w./-]+)$/;        // the only files served
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json' };

let db = null;
try {
  const { DatabaseSync } = require('node:sqlite');
  fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
  db = new DatabaseSync(DB_FILE);
  db.exec('CREATE TABLE IF NOT EXISTS state (page TEXT NOT NULL, key TEXT NOT NULL, value TEXT, updated INTEGER NOT NULL, PRIMARY KEY (page, key))');
} catch (e) {
  db = null;
  console.error('Backup is off: ' + (e.code === 'ERR_UNKNOWN_BUILTIN_MODULE' ? 'this Node.js has no node:sqlite (use Node 22.13 or newer).' : e.message));
}
const validPage = (p) => typeof p === 'string' && /^(course|lesson-\d{1,3})$/.test(p);

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.end(JSON.stringify(body));
}

function readBody(req, max) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > max) { reject(new Error('too_large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

// Only pages this server served may read or change the backup, not another site open in the browser.
function sameSite(req) {
  const origin = req.headers.origin;
  return !(origin && !ORIGINS.includes(origin)) && req.headers['x-tutorial'] === '1';
}
const isJson = (s) => { try { JSON.parse(s); return true; } catch (e) { return false; } };

// GET /api/state            -> { state: { "lesson-10": { notes: { value, updated }, ... }, course: { ... } } }
// GET /api/state?page=x     -> { state: { notes: { value, updated }, ... } }
// PUT /api/state            <- { page, key, value (a JSON string, or null for "removed"), updated (ms) }
// DELETE /api/state?page=x     forgets everything saved for that page
async function stateApi(req, res, url) {
  if (!sameSite(req)) return json(res, 403, { code: 'forbidden', message: 'Not allowed.' });
  if (!db) return json(res, 503, { code: 'no_backup', message: 'The backup database is not available.' });
  if (req.method === 'PUT') {
    let b;
    try { b = JSON.parse(await readBody(req, MAX_STATE + 1024)); } catch (e) { b = null; }
    const okValue = b && (b.value === null || (typeof b.value === 'string' && b.value.length <= MAX_STATE && isJson(b.value)));
    if (!b || !validPage(b.page) || !STATE_KEYS.has(b.key) || !okValue || !Number.isFinite(b.updated)) {
      return json(res, 400, { code: 'bad_request', message: 'Expected { page, key, value, updated }.' });
    }
    // An older write never replaces a newer one.
    db.prepare('INSERT INTO state (page, key, value, updated) VALUES (?, ?, ?, ?) ON CONFLICT (page, key) DO UPDATE SET value = excluded.value, updated = excluded.updated WHERE excluded.updated >= state.updated')
      .run(b.page, b.key, b.value, Math.round(b.updated));
    return json(res, 200, { ok: true });
  }
  const page = url.searchParams.get('page');
  if (page === null && req.method === 'GET') {
    const state = {};
    for (const r of db.prepare('SELECT page, key, value, updated FROM state').all()) (state[r.page] = state[r.page] || {})[r.key] = { value: r.value, updated: r.updated };
    return json(res, 200, { state });
  }
  if (!validPage(page)) return json(res, 400, { code: 'bad_request', message: 'Expected ?page=course or ?page=lesson-<number>.' });
  if (req.method === 'DELETE') { db.prepare('DELETE FROM state WHERE page = ?').run(page); return json(res, 200, { ok: true }); }
  const state = {};
  for (const r of db.prepare('SELECT key, value, updated FROM state WHERE page = ?').all(page)) state[r.key] = { value: r.value, updated: r.updated };
  return json(res, 200, { state });
}

function file(res, rel, status) {
  const full = path.join(ROOT, rel);
  if (!SITE.test(rel) || rel.includes('..') || !full.startsWith(ROOT + path.sep)) return notFound(res);
  fs.readFile(full, (err, data) => {
    if (err) return rel === '404.html' ? json(res, 404, { code: 'not_found', message: 'Not found.' }) : notFound(res);
    res.writeHead(status || 200, { 'content-type': TYPES[path.extname(full)] || 'application/octet-stream', 'cache-control': 'no-cache', 'x-content-type-options': 'nosniff' });
    res.end(data);
  });
}
function notFound(res) { file(res, '404.html', 404); }

const server = http.createServer((req, res) => {
  if (!HOSTS.test(req.headers.host || '')) return json(res, 403, { code: 'forbidden', message: 'Not allowed.' });
  let url;
  try { url = new URL(req.url, `http://localhost:${PORT}`); } catch (e) { return json(res, 400, { code: 'bad_request', message: 'Bad URL.' }); }
  if (req.method === 'GET' && url.pathname === '/api/status') return json(res, 200, { backup: !!db });
  if (url.pathname === '/api/state' && ['GET', 'PUT', 'DELETE'].includes(req.method)) {
    return stateApi(req, res, url).catch((e) => {
      if (res.headersSent) return res.end();
      if (e && e.message === 'too_large') return json(res, 413, { code: 'too_large', message: 'Too large.' });
      json(res, 500, { code: 'server_error', message: 'Something went wrong.' });
    });
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { code: 'not_allowed', message: 'Method not allowed.' });
  if (url.pathname === '/' || url.pathname === BASE.slice(0, -1)) { res.writeHead(302, { location: BASE }); return res.end(); }
  let rel;
  try { rel = decodeURIComponent(url.pathname); } catch (e) { return notFound(res); }
  if (!rel.startsWith(BASE)) return notFound(res);
  rel = rel.slice(BASE.length) || 'index.html';
  file(res, rel);
});

server.on('error', (e) => {
  console.error(e.code === 'EADDRINUSE' ? `Port ${PORT} is already in use. The server is probably already running: open http://localhost:${PORT}${BASE}` : e.message);
  process.exit(1);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`infra-recover on http://localhost:${PORT}${BASE}  (backup ${db ? DB_FILE : 'off'})`);
});
