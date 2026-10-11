// Prints your notes, bookmarks and progress from the backup database as Markdown, so you can read or keep them anywhere.
//   node tools/export-notes.js > my-notes.md
// Reads data/infra-recover.db (or the file named by INFRA_RECOVER_DB) and never changes it.
'use strict';
const path = require('node:path');
const fs = require('node:fs');
const ROOT = path.join(__dirname, '..');
const file = process.env.INFRA_RECOVER_DB ? path.resolve(process.env.INFRA_RECOVER_DB) : path.join(ROOT, 'data', 'infra-recover.db');
if (!fs.existsSync(file)) { console.error(`No backup database at ${file} yet. Run "npm start" and use the course first.`); process.exit(1); }
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync(file, { readOnly: true });
const when = (ms) => new Date(ms).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const parse = (v) => { try { return v ? JSON.parse(v) : null; } catch (e) { return null; } };

// Lesson titles from the built pages
const titles = {};
for (const f of fs.readdirSync(path.join(ROOT, 'lessons')).filter((x) => x.endsWith('.html'))) {
  const m = /<h1>(.*?)<\/h1>/s.exec(fs.readFileSync(path.join(ROOT, 'lessons', f), 'utf8'));
  titles[parseInt(f, 10)] = m ? m[1].replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').trim() : f;
}

const rows = {};
for (const r of db.prepare('SELECT page, key, value FROM state').all()) (rows[r.page] = rows[r.page] || {})[r.key] = parse(r.value);
const out = ['# My infra-recover notes', ''];
const course = rows.course || {};
const done = Array.isArray(course.done) ? course.done : [], labs = Array.isArray(course.labs) ? course.labs : [];
if (done.length || labs.length) out.push(`Lessons completed: ${done.length} of ${Object.keys(titles).length}. Scenarios solved: ${labs.length}.`, '');

const lessons = Object.keys(rows).filter((p) => /^lesson-\d+$/.test(p)).map((p) => Number(p.slice(7))).sort((a, b) => a - b);
for (const n of lessons) {
  const r = rows['lesson-' + n];
  const notes = (Array.isArray(r.notes) ? r.notes : []).slice().sort((a, b) => (a.ts || 0) - (b.ts || 0));
  const marks = (Array.isArray(r.bookmarks) ? r.bookmarks : []).slice().sort((a, b) => (a.ts || 0) - (b.ts || 0));
  const read = Array.isArray(r.sections) ? r.sections.length : 0;
  if (!notes.length && !marks.length && !read) continue;
  out.push(`## Lesson ${n}: ${titles[n] || ''}`.trim(), '');
  if (read) out.push(`Sections read: ${read}${done.includes(n) ? ' (lesson completed)' : ''}`, '');
  if (notes.length) {
    out.push('### Notes', '');
    for (const x of notes) out.push(`- **${x.quote}** (${when(x.upd || x.ts)}${x.upd ? ', edited' : ''})`, `  ${String(x.text).replace(/\n/g, '\n  ')}`);
    out.push('');
  }
  if (marks.length) { out.push('### Bookmarks', ''); for (const x of marks) out.push(`- ${x.quote} (${when(x.ts)})`); out.push(''); }
}
if (out.length === 2) out.push('Nothing saved yet.');
console.log(out.join('\n'));
