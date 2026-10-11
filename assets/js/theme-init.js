/* Applies the saved theme, text size and sidebar layout before first paint to avoid a flash. */
(function () {
  try {
    var t = JSON.parse(localStorage.getItem("infrasim.theme") || "null");
    if (t === "light" || t === "dark") document.documentElement.setAttribute("data-theme", t);
    var f = JSON.parse(localStorage.getItem("infrasim.font") || "null");
    if (typeof f === "number" && f >= 80 && f <= 160 && f !== 100) document.documentElement.style.setProperty("--font-zoom", String(f / 100));
    var s = JSON.parse(localStorage.getItem("infrasim.sidebar") || "null");
    if (s && typeof s.w === "number") document.documentElement.style.setProperty("--sidebar-w", Math.min(560, Math.max(200, s.w)) + "px");
    if (s && s.collapsed) document.documentElement.classList.add("sidebar-collapsed");
  } catch (e) { /* storage unavailable */ }
})();
