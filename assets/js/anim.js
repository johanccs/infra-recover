/* infra-recover — animated step-through diagrams (figure.anim).
 *
 * A figure holds an inline SVG and a JSON list of steps:
 *   <figure class="anim" aria-label="…">
 *     <div class="anim-stage"><svg …> … <g class="a-pkt off">…</g> … </svg></div>
 *     <script type="application/json">[ { "text": "…", "on": "a b", "path": [[x, y], …] }, … ]</script>
 *   </figure>
 * In a step, "on", "off", "bad" and "good" name the parts (data-k) to highlight, hide, mark as a problem or
 * mark as fine. "path" is the list of points the packet moves through (leave it out for a step with no packet),
 * and "back": true colours the packet as a reply. The caption and the controls are added here.
 */
(function () {
  "use strict";
  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var HOLD = 4200;   // ms a step stays on screen after its packet has arrived

  document.querySelectorAll("figure.anim").forEach(function (fig) {
    var data = fig.querySelector('script[type="application/json"]');
    var steps;
    try { steps = JSON.parse(data.textContent); } catch (e) { return; }
    if (!steps || !steps.length) return;

    var bar = document.createElement("div");
    bar.className = "anim-bar";
    bar.innerHTML =
      '<p class="anim-text" aria-live="off"></p>' +
      '<div class="anim-ctl"><span class="anim-count"></span>' +
      '<button type="button" class="anim-btn" data-act="back" aria-label="Previous step">◀</button>' +
      '<button type="button" class="anim-btn" data-act="play">Pause</button>' +
      '<button type="button" class="anim-btn" data-act="next" aria-label="Next step">▶</button></div>';
    fig.appendChild(bar);
    var stage = fig.querySelector(".anim-stage");
    if (stage) { stage.tabIndex = 0; stage.setAttribute("role", "group"); stage.setAttribute("aria-label", "Diagram. Scrolls sideways on a narrow screen."); }

    var pkt = fig.querySelector(".a-pkt"), text = bar.querySelector(".anim-text"), count = bar.querySelector(".anim-count");
    var playBtn = bar.querySelector('[data-act="play"]');
    var parts = fig.querySelectorAll("[data-k]");
    var i = 0, playing = !reduce, visible = false, timer = null, run = null;

    function at(p) { return "translate(" + p[0] + "px," + p[1] + "px)"; }
    function show(n, animate) {
      i = (n + steps.length) % steps.length;
      var s = steps[i], path = s.path || [], dur = 0;
      text.innerHTML = s.text;
      count.textContent = (i + 1) + " / " + steps.length;
      fig.classList.toggle("back", !!s.back);
      ["on", "off", "bad", "good"].forEach(function (c) {
        var keys = (s[c] || "").split(" ");
        parts.forEach(function (el) { el.classList.toggle(c, keys.indexOf(el.getAttribute("data-k")) >= 0); });
      });
      if (pkt) {
        pkt.classList.toggle("off", !path.length);
        if (run) { run.cancel(); run = null; }
        if (path.length) pkt.style.transform = at(path[path.length - 1]);
        if (animate && !reduce && path.length > 1 && pkt.animate) {
          var d = [0], total = 0;
          for (var k = 1; k < path.length; k++) { total += Math.hypot(path[k][0] - path[k - 1][0], path[k][1] - path[k - 1][1]); d.push(total); }
          dur = Math.max(800, Math.min(2800, total * 5.5));
          run = pkt.animate(path.map(function (p, k) { return { transform: at(p), offset: d[k] / total }; }),
            { duration: dur, easing: "cubic-bezier(.45, 0, .25, 1)" });
        }
      }
      return dur;
    }
    function schedule(dur) {
      clearTimeout(timer);
      if (playing && visible) timer = setTimeout(function () { schedule(show(i + 1, true)); }, dur + HOLD);
    }
    function setPlaying(p) {
      playing = p;
      playBtn.textContent = p ? "Pause" : "Play";
      text.setAttribute("aria-live", p ? "off" : "polite");   // announce steps only when the reader drives them
      clearTimeout(timer);
    }
    playBtn.addEventListener("click", function () { setPlaying(!playing); if (playing) schedule(show(i + 1, true)); });
    bar.querySelector('[data-act="next"]').addEventListener("click", function () { setPlaying(false); show(i + 1, true); });
    bar.querySelector('[data-act="back"]').addEventListener("click", function () { setPlaying(false); show(i - 1, false); });
    setPlaying(playing);
    show(0, false);
    fig.classList.add("anim-ready");

    // Only run while the diagram is on screen.
    if ("IntersectionObserver" in window) {
      new IntersectionObserver(function (entries) {
        visible = entries[entries.length - 1].isIntersecting;
        if (visible) schedule(0); else clearTimeout(timer);
      }, { threshold: 0.4 }).observe(fig);
    } else { visible = true; schedule(0); }
  });
})();
