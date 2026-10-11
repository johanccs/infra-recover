/* infra-recover — personal notes and bookmarks on lesson text, and "back where you left off".
 *
 * Right-click a word (or select a phrase first) and choose "Add a note". The text stays highlighted, and the note
 * sits in a panel on the right, level with its word and joined to it by a line. Notes are saved in this browser
 * only (localStorage), one list per lesson. Shift + right-click keeps the browser's own menu.
 *
 * The same right-click menu offers "Bookmark this spot" (a small flag before the word, listed under Bookmarks in
 * the top bar) and "Ask the AI tutor", which hands the click on to ai-assistant.js.
 * The page also remembers the place where you stopped reading and returns to it on the next visit.
 * A note remembers the character offset of its words inside the lesson text plus the words themselves, so the
 * highlight can be put back on the next visit, and found again if the text around it has changed a little.
 */
(function () {
  "use strict";
  var article = document.querySelector("article");
  var lessonId = parseInt(document.body.getAttribute("data-lesson") || "0", 10);
  if (!article || !lessonId || !window.Range || !document.createTreeWalker) return;

  var KEY = "infrasim.notes." + lessonId;
  var OPEN_KEY = "infrasim.notes.open", MODE_KEY = "infrasim.notes.mode";
  var SVGNS = "http://www.w3.org/2000/svg";
  // Text that scripts add or change after load is never part of a note, so the saved offsets stay valid.
  var SKIP = "button, script, noscript, style, svg, textarea, input, select, .ln, .lab, .meta, .complete-box, .anim-bar, .note-ui";
  var WORD = /[A-Za-z0-9_.\-\/:@$]/;

  function read(key, fallback) { try { var v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch (e) { return fallback; } }
  function write(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* storage unavailable */ } }
  function el(tag, cls, text) { var x = document.createElement(tag); if (cls) x.className = cls; if (text != null) x.textContent = text; return x; }

  var notes = read(KEY, []);
  if (!Array.isArray(notes)) notes = [];
  function save() { write(KEY, notes); }

  /* ---------- UI ---------- */
  var menu = el("div", "note-menu note-ui");
  menu.hidden = true;
  menu.setAttribute("role", "group");
  menu.setAttribute("aria-label", "Actions for this text");
  menu.innerHTML =
    '<button type="button" data-act="note"><span class="lbl">Add a note</span><span class="sub"></span></button>' +
    '<button type="button" data-act="bm">Bookmark this spot</button>' +
    '<button type="button" data-act="ask">✨ Ask the AI tutor</button>';

  var dlg = el("dialog", "note-dlg note-ui");
  dlg.setAttribute("aria-labelledby", "note-title");
  dlg.innerHTML =
    '<div class="note-form">' +
      '<h2 id="note-title">Add a note</h2>' +
      '<p class="note-quote"></p>' +
      '<label class="sr-only" for="note-text">Your note</label>' +
      '<textarea id="note-text" placeholder="Write your note. Ctrl+Enter saves."></textarea>' +
      '<div class="note-actions">' +
        '<button type="button" class="danger" data-act="del" hidden>Delete</button><span class="sp"></span>' +
        '<button type="button" data-act="cancel">Cancel</button>' +
        '<button type="button" class="primary" data-act="save" disabled>Save</button>' +
      '</div>' +
    '</div>';

  var pane = el("aside", "notes-pane note-ui margin");
  pane.id = "notes-pane";
  pane.hidden = true;
  pane.setAttribute("aria-label", "Your notes");
  pane.innerHTML =
    '<div class="notes-head"><h2>Your notes</h2>' +
    '<button type="button" id="notes-mode">List</button>' +
    '<button type="button" id="notes-close" aria-label="Close the notes panel">✕</button></div>' +
    '<div class="notes-margin"></div>';

  var svg = document.createElementNS(SVGNS, "svg");
  svg.setAttribute("class", "notes-lines note-ui");
  svg.setAttribute("aria-hidden", "true");

  var btn = el("button", "icon-btn");
  btn.type = "button"; btn.id = "notes-btn";
  btn.setAttribute("aria-pressed", "false");
  btn.setAttribute("aria-controls", "notes-pane");
  btn.innerHTML = 'Notes<span class="notes-count" hidden></span>';

  document.body.appendChild(menu);
  document.body.appendChild(dlg);
  document.body.appendChild(pane);
  document.body.appendChild(svg);
  var bar = document.querySelector(".topbar");
  if (bar) bar.insertBefore(btn, bar.querySelector(".font-ctl") || bar.querySelector("#theme-btn"));

  var box = pane.querySelector(".notes-margin"), countEl = btn.querySelector(".notes-count");
  var area = dlg.querySelector("textarea"), saveBtn = dlg.querySelector('[data-act="save"]'), delBtn = dlg.querySelector('[data-act="del"]');
  var modeBtn = pane.querySelector("#notes-mode");
  var pending = null, cur = null, open = false, raf = 0;
  var wideQuery = window.matchMedia ? window.matchMedia("(min-width: 981px)") : null;
  function wide() { return !wideQuery || wideQuery.matches; }

  /* ---------- Text positions ---------- */
  function textNodes() {
    var out = [], w = document.createTreeWalker(article, NodeFilter.SHOW_TEXT, null), n;
    while ((n = w.nextNode())) if (n.data && !n.parentElement.closest(SKIP)) out.push(n);
    return out;
  }
  function fullText() { return textNodes().map(function (t) { return t.data; }).join(""); }
  function offsetOf(node, off) {
    var r = document.createRange(); r.setStart(article, 0); r.setEnd(node, off);
    var acc = 0;
    textNodes().forEach(function (t) {
      if (t === node) acc += off;
      else if (r.comparePoint(t, t.length) <= 0) acc += t.length;
    });
    return acc;
  }
  function describe(range) {
    var text = fullText();
    var s = offsetOf(range.startContainer, range.startOffset);
    var e = article.contains(range.endContainer) ? offsetOf(range.endContainer, range.endOffset) : text.length;
    while (s < e && /\s/.test(text[s])) s++;
    while (e > s && /\s/.test(text[e - 1])) e--;
    if (e - s > 300) e = s + 300;
    if (e <= s) return null;
    return { offset: s, quote: text.slice(s, e) };
  }
  function wordRange(x, y) {
    var node, off, p;
    if (document.caretPositionFromPoint) { p = document.caretPositionFromPoint(x, y); if (p) { node = p.offsetNode; off = p.offset; } }
    else if (document.caretRangeFromPoint) { p = document.caretRangeFromPoint(x, y); if (p) { node = p.startContainer; off = p.startOffset; } }
    if (!node || node.nodeType !== 3 || !article.contains(node) || node.parentElement.closest(SKIP)) return null;
    var t = node.data, s = off, e = off;
    while (s > 0 && WORD.test(t[s - 1])) s--;
    while (e < t.length && WORD.test(t[e])) e++;
    while (s < e && /[.:\/]/.test(t[s])) s++;
    while (e > s && /[.:\/]/.test(t[e - 1])) e--;
    if (s >= e) return null;
    var r = document.createRange(); r.setStart(node, s); r.setEnd(node, e);
    return r;
  }
  function locate(text, n) {
    if (text.substr(n.offset, n.quote.length) === n.quote) return n.offset;
    var best = -1, i = text.indexOf(n.quote);
    while (i >= 0) { if (best < 0 || Math.abs(i - n.offset) < Math.abs(best - n.offset)) best = i; i = text.indexOf(n.quote, i + 1); }
    return best;
  }

  /* ---------- Highlighting (wraps text in <mark> without changing the text itself) ---------- */
  function highlight(n, bm) {
    var at = locate(fullText(), n);
    if (at < 0) return false;
    var end = at + n.quote.length, pos = 0, last = null, first = null;
    textNodes().forEach(function (t) {
      var a = pos, b = pos + t.length; pos = b;
      var s = Math.max(at, a), e = Math.min(end, b);
      if (s >= e || !t.data.slice(s - a, e - a).trim()) return;
      var r = document.createRange(); r.setStart(t, s - a); r.setEnd(t, e - a);
      var m = document.createElement("mark"); m.className = bm ? "bm-hl" : "note-hl"; m.setAttribute(bm ? "data-bm" : "data-note", n.id);
      r.surroundContents(m);
      last = m; if (!first) first = m;
    });
    if (bm) { if (first) first.classList.add("bm-start"); }
    else if (last) last.classList.add("note-end");
    return !!last;
  }
  function marksOf(id, bm) { return Array.prototype.slice.call(article.querySelectorAll(bm ? 'mark.bm-hl[data-bm="' + id + '"]' : 'mark.note-hl[data-note="' + id + '"]')); }
  function unhighlight(id, bm) {
    marksOf(id, bm).forEach(function (m) {
      var p = m.parentNode;
      while (m.firstChild) p.insertBefore(m.firstChild, m);
      p.removeChild(m); p.normalize();
    });
  }
  function find(id) { for (var i = 0; i < notes.length; i++) if (notes[i].id === id) return notes[i]; return null; }

  /* ---------- The right-click menu ---------- */
  function hideMenu() { menu.hidden = true; }
  article.addEventListener("contextmenu", function (e) {
    if (e.notesPass || e.shiftKey) return;               // Shift + right-click keeps the browser's own menu
    if (!e.target.closest || e.target.closest("input, textarea, select, a[href], " + SKIP)) return;
    var sel = window.getSelection(), range = null;
    if (sel && sel.rangeCount && !sel.isCollapsed && article.contains(sel.anchorNode) && article.contains(sel.focusNode)) range = sel.getRangeAt(0).cloneRange();
    if (!range) range = wordRange(e.clientX, e.clientY);
    if (!range) return;
    var info = describe(range);
    if (!info) return;
    e.preventDefault(); e.stopPropagation();
    var mark = e.target.closest("mark.note-hl"), bmark = e.target.closest("mark.bm-hl");
    pending = { info: info, range: range, note: mark ? find(mark.getAttribute("data-note")) : null,
      bm: bmark ? findBm(bmark.getAttribute("data-bm")) : null, target: e.target, x: e.clientX, y: e.clientY };
    menu.querySelector('[data-act="bm"]').textContent = pending.bm ? "Remove bookmark" : "Bookmark this spot";
    menu.querySelector(".lbl").textContent = pending.note ? "Edit note" : "Add a note";
    menu.querySelector(".sub").textContent = "“" + (info.quote.length > 40 ? info.quote.slice(0, 40) + "…" : info.quote) + "”";
    menu.hidden = false;
    var w = menu.offsetWidth, h = menu.offsetHeight;
    menu.style.left = Math.max(8, Math.min(e.clientX, window.innerWidth - w - 8)) + "px";
    menu.style.top = Math.max(8, Math.min(e.clientY, window.innerHeight - h - 8)) + "px";
    menu.querySelector("button").focus();
  }, true);
  menu.addEventListener("mousedown", function (e) { e.preventDefault(); });   // keep the text selected
  menu.addEventListener("click", function (e) {
    var b = e.target.closest("button[data-act]");
    if (!b) return;
    hideMenu();
    var p = pending; if (!p) return;
    if (b.getAttribute("data-act") === "note") { edit(p.note, p.info); return; }
    if (b.getAttribute("data-act") === "bm") { toggleBm(p); return; }
    // Ask: select the words and repeat the right-click for the AI tutor, which listens for it.
    try { var s = window.getSelection(); s.removeAllRanges(); s.addRange(p.range); } catch (err) { /* keep the current selection */ }
    setTimeout(function () {
      var ev = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: p.x, clientY: p.y, button: 2 });
      ev.notesPass = true;
      (p.target.isConnected ? p.target : article).dispatchEvent(ev);
    }, 0);
  });
  document.addEventListener("mousedown", function (e) { if (!menu.hidden && !menu.contains(e.target)) hideMenu(); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") hideMenu(); });
  window.addEventListener("resize", hideMenu);
  window.addEventListener("scroll", hideMenu, { passive: true });

  /* ---------- The note box ---------- */
  function quoteText(q) { return "“" + (q.length > 160 ? q.slice(0, 160) + "…" : q) + "”"; }
  function edit(note, info) {
    cur = { note: note, info: note ? { offset: note.offset, quote: note.quote } : info };
    dlg.querySelector("#note-title").textContent = note ? "Note" : "Add a note";
    dlg.querySelector(".note-quote").textContent = quoteText(cur.info.quote);
    area.value = note ? note.text : "";
    delBtn.hidden = !note; delBtn.textContent = "Delete"; delBtn.removeAttribute("data-sure");
    saveBtn.disabled = !area.value.trim();
    if (dlg.showModal) dlg.showModal(); else dlg.setAttribute("open", "");
    area.focus();
  }
  function closeBox() { if (dlg.close) dlg.close(); else dlg.removeAttribute("open"); cur = null; }
  function saveNote() {
    var text = area.value.trim();
    if (!text || !cur) return;
    if (cur.note) { cur.note.text = text; cur.note.upd = Date.now(); }
    else {
      var n = { id: "n" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), offset: cur.info.offset, quote: cur.info.quote, text: text, ts: Date.now() };
      notes.push(n); highlight(n);
      setOpen(true);
    }
    save(); closeBox(); render();
  }
  area.addEventListener("input", function () { saveBtn.disabled = !area.value.trim(); });
  area.addEventListener("keydown", function (e) { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); saveNote(); } });
  saveBtn.addEventListener("click", saveNote);
  dlg.querySelector('[data-act="cancel"]').addEventListener("click", closeBox);
  dlg.addEventListener("click", function (e) { if (e.target === dlg) closeBox(); });
  dlg.addEventListener("close", function () { cur = null; });
  delBtn.addEventListener("click", function () {
    if (!cur || !cur.note) return;
    if (delBtn.getAttribute("data-sure") !== "1") { delBtn.setAttribute("data-sure", "1"); delBtn.textContent = "Click again to delete"; return; }
    var gone = cur.note;
    unhighlight(gone.id);
    notes = notes.filter(function (n) { return n !== gone; });
    save(); closeBox(); render();
  });
  article.addEventListener("click", function (e) {
    var m = e.target.closest ? e.target.closest("mark.note-hl") : null;
    var sel = window.getSelection();
    if (!m || (sel && !sel.isCollapsed)) return;
    var n = find(m.getAttribute("data-note")); if (n) edit(n);
  });
  function setActive(id, on) {
    marksOf(id).forEach(function (m) { m.classList.toggle("active", on); });
    var c = box.querySelector('.note-card[data-id="' + id + '"]'); if (c) c.classList.toggle("active", on);
  }
  article.addEventListener("mouseover", function (e) { var m = e.target.closest ? e.target.closest("mark.note-hl") : null; if (m) setActive(m.getAttribute("data-note"), true); });
  article.addEventListener("mouseout", function (e) { var m = e.target.closest ? e.target.closest("mark.note-hl") : null; if (m) setActive(m.getAttribute("data-note"), false); });

  /* ---------- The notes panel ---------- */
  var headings = Array.prototype.slice.call(article.querySelectorAll("h2"));
  function sectionLabel(n, bm) {
    var m = marksOf(n.id, bm)[0], label = "";
    if (m) headings.forEach(function (h) { if (h.compareDocumentPosition(m) & Node.DOCUMENT_POSITION_FOLLOWING) label = h.textContent; });
    return label || "Introduction";
  }
  // One date and time format for notes, bookmarks and "where you stopped", for example "11 Oct 2026, 14:32".
  function stamp(ts) {
    var d = new Date(ts);
    return isNaN(d) ? "" : d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) + ", " + d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  }
  function whenText(n) { var t = stamp(n.upd || n.ts); return t ? (n.upd ? "Edited " : "") + t : ""; }
  function render() {
    box.innerHTML = "";
    countEl.hidden = !notes.length; countEl.textContent = notes.length;
    btn.setAttribute("aria-label", "Notes" + (notes.length ? " (" + notes.length + ")" : ""));
    if (!notes.length) box.appendChild(el("p", "notes-empty", "No notes yet. Right-click a word in the lesson and choose “Add a note”."));
    notes.slice().sort(function (a, b) { return a.offset - b.offset; }).forEach(function (n) {
      var c = el("div", "note-card"); c.setAttribute("data-id", n.id);
      var top = el("div", "note-top");
      top.appendChild(el("span", "note-step", sectionLabel(n)));
      top.appendChild(el("p", "note-quote-s", quoteText(n.quote)));
      var b = el("button", "note-edit", "Edit"); b.type = "button"; b.setAttribute("aria-label", "Edit this note");
      top.appendChild(b);
      c.appendChild(top);
      c.appendChild(el("p", "note-text", n.text));
      var when = el("p", "note-date", whenText(n)); when.title = "Saved " + new Date(n.ts).toLocaleString(); c.appendChild(when);
      if (!marksOf(n.id).length) c.appendChild(el("p", "note-old", "This text has changed, so the highlight is gone."));
      c.addEventListener("mouseenter", function () { setActive(n.id, true); });
      c.addEventListener("mouseleave", function () { setActive(n.id, false); });
      b.addEventListener("click", function (e) { e.stopPropagation(); edit(n); });
      c.addEventListener("click", function () { jump(n); });
      box.appendChild(c);
    });
    schedule();
  }
  function jump(n) {
    var m = marksOf(n.id)[0]; if (!m) return;
    var d = m.closest("details"); while (d) { d.open = true; d = d.parentElement ? d.parentElement.closest("details") : null; }
    m.scrollIntoView({ block: "center", behavior: "smooth" });
    setActive(n.id, true); setTimeout(function () { setActive(n.id, false); }, 1400);
  }
  function mode() { return !wide() || read(MODE_KEY, "margin") === "list" ? "list" : "margin"; }
  function setOpen(v) {
    open = v; write(OPEN_KEY, v);
    pane.hidden = !v;
    btn.setAttribute("aria-pressed", v ? "true" : "false");
    applyMode();
  }
  function applyMode() {
    var m = mode();
    pane.classList.toggle("list", m === "list"); pane.classList.toggle("margin", m === "margin");
    modeBtn.textContent = m === "list" ? "Beside text" : "List";
    document.body.classList.toggle("notes-open", open && wide());
    schedule();
  }
  btn.addEventListener("click", function () { setOpen(!open); });
  pane.querySelector("#notes-close").addEventListener("click", function () { setOpen(false); btn.focus(); });
  modeBtn.addEventListener("click", function () { write(MODE_KEY, mode() === "list" ? "margin" : "list"); applyMode(); });

  // Place each note card level with its word and draw the line between them.
  function layout() {
    raf = 0;
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    var cards = Array.prototype.slice.call(box.querySelectorAll(".note-card"));
    if (!open || mode() !== "margin") { cards.forEach(function (c) { c.hidden = false; c.style.top = ""; }); return; }
    var br = box.getBoundingClientRect(), items = [];
    cards.forEach(function (c) {
      var ms = marksOf(c.getAttribute("data-id")), last = ms[ms.length - 1], rs = last ? last.getClientRects() : [];
      var r = rs[rs.length - 1];
      if (!r || (!r.width && !r.height)) { c.hidden = true; return; }
      var y = r.top + r.height / 2;
      if (y < br.top - 4 || y > br.bottom - 8) { c.hidden = true; return; }
      c.hidden = false; items.push({ c: c, y: y, ly: r.bottom + 1, x: r.right });
    });
    items.sort(function (a, b) { return a.y - b.y; });
    var cursor = 0;
    items.forEach(function (it) {
      var top = Math.max(it.y - br.top - 16, cursor);
      it.c.style.top = top + "px";
      cursor = top + it.c.offsetHeight + 8;
      if (top + it.c.offsetHeight > br.height) { it.c.hidden = true; return; }
      var cy = br.top + top + 16, cx = br.left + 16, mx = Math.max(it.x + 6, cx - 18);
      var p = document.createElementNS(SVGNS, "path");
      p.setAttribute("d", "M" + (it.x - 8) + " " + it.ly + " L" + mx + " " + it.ly + " L" + cx + " " + cy);
      svg.appendChild(p);
      var d = document.createElementNS(SVGNS, "circle");
      d.setAttribute("cx", it.x - 8); d.setAttribute("cy", it.ly); d.setAttribute("r", 3);
      svg.appendChild(d);
    });
  }
  function schedule() { if (!raf) raf = requestAnimationFrame(layout); }
  window.addEventListener("scroll", schedule, { passive: true });
  window.addEventListener("resize", applyMode);
  document.addEventListener("toggle", schedule, true);
  if (window.ResizeObserver) new ResizeObserver(schedule).observe(article);
  window.addEventListener("load", schedule);

  /* ---------- Bookmarks ---------- */
  var BM_KEY = "infrasim.bookmarks." + lessonId, POS_KEY = "infrasim.pos." + lessonId;
  var marks = read(BM_KEY, []);
  if (!Array.isArray(marks)) marks = [];
  var lastPos = read(POS_KEY, null);
  function saveMarks() { write(BM_KEY, marks); }
  function findBm(id) { for (var i = 0; i < marks.length; i++) if (marks[i].id === id) return marks[i]; return null; }
  function short(q) { return "“" + (q.length > 40 ? q.slice(0, 40) + "…" : q) + "”"; }

  var bmWrap = el("span", "bm-wrap note-ui");
  bmWrap.innerHTML =
    '<button type="button" class="icon-btn" id="bm-btn" aria-expanded="false" aria-controls="bm-list" aria-label="Bookmarks" title="Bookmarks">⚑<span class="bm-word"> Bookmarks</span></button>' +
    '<div class="bm-list" id="bm-list" hidden></div>';
  if (bar) bar.insertBefore(bmWrap, btn);
  var bmBtn = bmWrap.querySelector("#bm-btn"), bmList = bmWrap.querySelector("#bm-list");

  var toast = el("div", "bm-toast note-ui"), toastT = 0;
  toast.hidden = true; toast.setAttribute("role", "status");
  document.body.appendChild(toast);
  function showToast(text, actionLabel, action) {
    toast.innerHTML = ""; toast.appendChild(el("span", "", text));
    if (actionLabel) {
      var b = el("button", "", actionLabel); b.type = "button";
      b.addEventListener("click", function () { toast.hidden = true; action(); });
      toast.appendChild(b);
    }
    toast.hidden = false; clearTimeout(toastT); toastT = setTimeout(function () { toast.hidden = true; }, 7000);
  }
  function toggleBm(p) {
    if (p.bm) {
      unhighlight(p.bm.id, true);
      marks = marks.filter(function (b) { return b !== p.bm; });
      showToast("Bookmark removed.");
    } else {
      var b = { id: "b" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), offset: p.info.offset, quote: p.info.quote, ts: Date.now() };
      marks.push(b); highlight(b, true);
      showToast("Bookmarked " + short(b.quote) + ". Find it under Bookmarks in the top bar.");
    }
    saveMarks(); renderBm(); schedule();
  }
  function goBm(b) {
    var m = marksOf(b.id, true)[0]; if (!m) return;
    var d = m.closest("details"); while (d) { d.open = true; d = d.parentElement ? d.parentElement.closest("details") : null; }
    m.scrollIntoView({ block: "center", behavior: "smooth" });
    m.classList.add("active"); setTimeout(function () { m.classList.remove("active"); }, 1400);
  }
  function hideBm() { bmList.hidden = true; bmBtn.setAttribute("aria-expanded", "false"); }
  function bmRow(title, sub, go, remove) {
    var row = el("div", "bm-item");
    var t = el("button", "bm-go"); t.type = "button";
    t.appendChild(el("span", "t", title)); t.appendChild(el("span", "s", sub));
    t.addEventListener("click", function () { hideBm(); go(); });
    row.appendChild(t);
    if (remove) {
      var x = el("button", "bm-x", "×"); x.type = "button"; x.setAttribute("aria-label", "Remove the bookmark " + title);
      x.addEventListener("click", function (e) { e.stopPropagation(); remove(); });
      row.appendChild(x);
    }
    return row;
  }
  function renderBm() {
    bmList.innerHTML = "";
    if (lastPos && posTarget(lastPos)) {
      bmList.appendChild(el("p", "bm-head", "Where you stopped"));
      bmList.appendChild(bmRow("Continue: " + posName(lastPos), stamp(lastPos.ts), function () { toPos(lastPos, true); }));
    }
    bmList.appendChild(el("p", "bm-head", "Your bookmarks"));
    if (!marks.length) bmList.appendChild(el("p", "bm-empty", "None yet. Right-click a word in the lesson and choose “Bookmark this spot”."));
    marks.slice().sort(function (a, b) { return a.offset - b.offset; }).forEach(function (b) {
      bmList.appendChild(bmRow(quoteText(b.quote), sectionLabel(b, true) + " · " + stamp(b.ts),
        function () { goBm(b); }, function () { toggleBm({ bm: b }); }));
    });
  }
  bmBtn.addEventListener("click", function (e) {
    e.stopPropagation();
    var show = bmList.hidden;
    if (show) renderBm();
    bmList.hidden = !show; bmBtn.setAttribute("aria-expanded", show ? "true" : "false");
  });
  document.addEventListener("click", function (e) { if (!bmList.hidden && !bmWrap.contains(e.target)) hideBm(); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !bmList.hidden) { hideBm(); bmBtn.focus(); } });

  /* ---------- Back where you left off ----------
   * The place is saved as a section (the lesson start or an h2) plus how far through that section you are,
   * so it still fits after the text size or the window size changes. */
  var TOP = 72;   // just under the sticky top bar
  var ready = false, userMoved = false, saveT = 0;
  function sectionTops() {
    var out = [{ id: "", top: article.getBoundingClientRect().top }];
    headings.forEach(function (h) { if (h.id) out.push({ id: h.id, top: h.getBoundingClientRect().top }); });
    out.push({ id: null, top: article.getBoundingClientRect().bottom });
    return out;
  }
  function here() {
    var tops = sectionTops();
    for (var i = tops.length - 2; i >= 0; i--) {
      if (tops[i].top <= TOP || i === 0) {
        var h = tops[i + 1].top - tops[i].top;
        return { sec: tops[i].id, f: Math.max(0, Math.min(1, (TOP - tops[i].top) / (h || 1))), ts: Date.now() };
      }
    }
    return null;
  }
  function posTarget(p) { return p && typeof p.f === "number" && (p.sec === "" || (typeof p.sec === "string" && document.getElementById(p.sec))); }
  function posName(p) { var h = p.sec ? document.getElementById(p.sec) : null; return h ? h.textContent : "Introduction"; }
  function savePos() {
    if (!ready) return;
    var h = here(); if (!h) return;
    lastPos = h; write(POS_KEY, h);
  }
  function toPos(p, smooth) {
    var tops = sectionTops();
    for (var i = 0; i < tops.length - 1; i++) {
      if (tops[i].id === p.sec) {
        var y = window.scrollY + tops[i].top + p.f * (tops[i + 1].top - tops[i].top) - TOP;
        window.scrollTo({ top: Math.max(0, y), behavior: smooth ? "smooth" : "instant" });
        return;
      }
    }
  }
  ["wheel", "touchstart", "keydown", "mousedown"].forEach(function (ev) {
    window.addEventListener(ev, function () { userMoved = true; }, { passive: true, capture: true });
  });
  window.addEventListener("scroll", function () { clearTimeout(saveT); saveT = setTimeout(savePos, 250); }, { passive: true });
  window.addEventListener("pagehide", savePos);
  document.addEventListener("visibilitychange", function () { if (document.visibilityState === "hidden") savePos(); });
  function resume() {
    var p = lastPos;
    // A link to a heading wins over the saved place, and so does a reader who has already started scrolling.
    if (!posTarget(p) || location.hash || userMoved || (p.sec === "" && p.f < 0.02)) { setTimeout(function () { ready = true; }, 300); return; }
    try { if ("scrollRestoration" in history) history.scrollRestoration = "manual"; } catch (e) { /* not supported */ }
    toPos(p, false);
    setTimeout(function () { if (!userMoved) toPos(p, false); }, 500);   // once the scenarios and fonts have settled
    showToast("Back where you left off: " + posName(p), "Start at the top", function () { window.scrollTo({ top: 0, behavior: "smooth" }); });
    setTimeout(function () { ready = true; }, 1000);
  }
  if (document.readyState === "complete") resume(); else window.addEventListener("load", resume);

  /* ---------- Start up: put the saved highlights back ---------- */
  marks.forEach(function (b) { try { highlight(b, true); } catch (e) { /* the text changed */ } });
  notes.forEach(function (n) { try { highlight(n); } catch (e) { /* the text changed */ } });
  open = read(OPEN_KEY, false) === true && notes.length > 0;
  pane.hidden = !open;
  btn.setAttribute("aria-pressed", open ? "true" : "false");
  applyMode();
  render();
})();
