/* infra-recover — backup of your notes, bookmarks, reading place, ticked sections, completed lessons and solved scenarios.
 *
 * The pages keep all of that in this browser (localStorage). When the site is opened through server.js (npm start), this
 * script also sends each change to the server, which keeps it in a SQLite file. When a page opens, the newer copy of each
 * item wins, so a new browser, or one whose site data was cleared, gets everything back. A browser that never synced
 * before keeps its own items and adds the saved ones. On GitHub Pages or any other host there is no such server, and this
 * script does nothing.
 *
 * Loaded in <head>, before the scripts that read localStorage.
 */
(function () {
  "use strict";
  if (!/^https?:$/.test(location.protocol) || !/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) return;
  var ls, rawSet = Storage.prototype.setItem, rawRemove = Storage.prototype.removeItem;
  try { ls = window.localStorage; ls.getItem("x"); } catch (e) { return; }

  // localStorage key <-> { page, key } in the database
  var GLOBAL = { "infrasim.completed.v1": "done", "infrasim.labs.v1": "labs" };
  var PER_LESSON = /^infrasim\.(notes|bookmarks|pos|sections)\.(\d{1,3})$/;
  function idOf(k) {
    if (GLOBAL[k]) return "course/" + GLOBAL[k];
    var m = PER_LESSON.exec(k);
    return m ? "lesson-" + m[2] + "/" + m[1] : null;
  }
  function keyOf(id) {
    var p = id.split("/");
    if (p[0] === "course") { for (var k in GLOBAL) if (GLOBAL[k] === p[1]) return k; return null; }
    return "infrasim." + p[1] + "." + p[0].slice(7);
  }

  var TSKEY = "infrasim.sync-ts";                                 // when each item last changed in this browser
  var ts = {}; try { ts = JSON.parse(ls.getItem(TSKEY) || "{}") || {}; } catch (e) { ts = {}; }
  var dirty = {}, timer = null, state = "absent", lastOk = 0;
  function setTs(id, t) { ts[id] = t; try { rawSet.call(ls, TSKEY, JSON.stringify(ts)); } catch (e) { /* storage full */ } }
  function put(id, v) { var k = keyOf(id); if (!k) return; if (v === null) rawRemove.call(ls, k); else rawSet.call(ls, k, v); }

  // Combine two copies of something that was never synced before, so neither side loses anything.
  function union(id, a, b) {
    var kind = id.split("/")[1];
    try {
      var A = JSON.parse(a), B = JSON.parse(b);
      if (kind === "done" || kind === "labs" || kind === "sections") {
        B.forEach(function (x) { if (A.indexOf(x) === -1) A.push(x); });
        return JSON.stringify(A);
      }
      if (kind === "notes" || kind === "bookmarks") {
        var seen = {}; A.forEach(function (x) { seen[x.id] = 1; });
        B.forEach(function (x) { if (!seen[x.id]) A.push(x); });
        return JSON.stringify(A.sort(function (x, y) { return (x.ts || 0) - (y.ts || 0); }));
      }
    } catch (e) { /* not the expected shape: take the saved copy */ }
    return b;                                                     // "where you stopped": the saved copy
  }

  // Restore before the page's own scripts read localStorage. A synchronous request is fine: the server is on this machine.
  var srv = null;
  try {
    var x = new XMLHttpRequest();
    x.open("GET", "/api/state", false);
    x.setRequestHeader("x-tutorial", "1");
    x.send();
    if (x.status === 200) { srv = JSON.parse(x.responseText).state || {}; state = "ok"; lastOk = Date.now(); }
    else if (x.status === 503) state = "none";                    // our server, without SQLite
    else if (x.status === 404 || x.status === 405 || x.status === 501) return;   // a plain file server: no backup here
    else state = "off";
  } catch (e) { state = "off"; }

  if (srv) {
    var ids = {};
    Object.keys(srv).forEach(function (page) { Object.keys(srv[page]).forEach(function (key) { ids[page + "/" + key] = srv[page][key]; }); });
    for (var i = 0; i < ls.length; i++) { var id0 = idOf(ls.key(i)); if (id0 && !(id0 in ids)) ids[id0] = null; }
    Object.keys(ids).forEach(function (id) {
      var k = keyOf(id); if (!k) return;
      var remote = ids[id], lv = ls.getItem(k), lt = ts[id] || 0;
      if (!remote) { if (lv !== null) { dirty[id] = true; if (!lt) setTs(id, Date.now()); } return; }
      if (!lt && lv !== null && lv !== remote.value) {             // first sync of this browser: merge
        if (remote.value !== null) put(id, union(id, lv, remote.value));
        setTs(id, Date.now()); dirty[id] = true; return;
      }
      if (remote.updated > lt || (lv === null && remote.value !== null && !lt)) { put(id, remote.value); setTs(id, remote.updated); }
      else if (lt > remote.updated) dirty[id] = true;
    });
  }

  // Send every later change.
  function changed(k) { var id = idOf(k); if (!id || state === "none") return; setTs(id, Date.now()); dirty[id] = true; schedule(500); }
  Storage.prototype.setItem = function (k, v) { rawSet.call(this, k, v); if (this === ls) changed(k); };
  Storage.prototype.removeItem = function (k) { rawRemove.call(this, k); if (this === ls) changed(k); };
  function schedule(ms) { clearTimeout(timer); timer = setTimeout(push, ms); if (state === "ok") { state = "saving"; show(); } }
  function push() {
    timer = null;
    var list = Object.keys(dirty); dirty = {};
    if (!list.length) { if (state === "saving") { state = "ok"; show(); } return; }
    Promise.all(list.map(function (id) {
      var p = id.split("/");
      return fetch("/api/state", { method: "PUT", keepalive: true, headers: { "content-type": "application/json", "x-tutorial": "1" },
        body: JSON.stringify({ page: p[0], key: p[1], value: ls.getItem(keyOf(id)), updated: ts[id] || Date.now() }) })
        .then(function (r) { if (r.status === 503) { state = "none"; return; } if (!r.ok) throw new Error(String(r.status)); });
    })).then(function () { if (state !== "none") { state = "ok"; lastOk = Date.now(); } show(); }, function () {
      list.forEach(function (id) { dirty[id] = true; }); state = "off"; show(); schedule(15000);
    });
  }
  window.addEventListener("pagehide", function () { if (Object.keys(dirty).length) push(); });
  if (Object.keys(dirty).length) schedule(300);

  // The small status in the top bar (the element is created by course.js).
  function show() {
    var el = document.getElementById("backup-state"); if (!el) return;
    el.hidden = false;
    var txt = { ok: "Backed up", saving: "Saving…", off: "Backup off", none: "Backup off" }[state];
    el.className = "bk-state" + (state === "ok" ? "" : state === "saving" ? " saving" : " off");
    el.textContent = "";
    var t = document.createElement("span"); t.className = "t"; t.textContent = txt; el.appendChild(t);
    el.title = state === "ok" ? "Your notes, bookmarks, place and progress are saved in the course database (last saved " + new Date(lastOk).toLocaleTimeString() + ")."
      : state === "saving" ? "Sending your latest changes to the course database."
      : state === "none" ? "The course server has no SQLite support (it needs Node.js 22.13 or newer), so nothing is backed up. Your changes stay in this browser."
      : "The course server is not answering. Your changes stay in this browser and are sent when it is back.";
  }
  document.addEventListener("DOMContentLoaded", show);
  window.__backup = { state: function () { return state; }, show: show };
})();
