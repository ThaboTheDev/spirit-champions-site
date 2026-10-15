/* Shared setup and helpers for the Spirit Champions HQ team site. */
window.SC = (function () {
  const SUPABASE_URL = "https://cuvkisbvazskxwqbjtdw.supabase.co";
  const SUPABASE_KEY = "sb_publishable_yWjCyXfCyXnOfVsIG6ccwA_uZfNkAnq";
  const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, storageKey: "sc-hq-auth" },
  });
  const SILHOUETTE = '<svg viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="34" r="20"/><path d="M12 96c2-22 18-36 38-36s36 14 38 36z"/></svg>';

  function initials(name) {
    if (!name) return "";
    return name.trim().split(/\s+/).map(w => w[0]).slice(0, 2).join("").toUpperCase();
  }
  function safeUrl(u) {
    if (typeof u !== "string" || !u) return null;
    if (u.startsWith("/team/")) return u;
    if (u.startsWith(SUPABASE_URL + "/storage/v1/object/public/sc-member-photos/")) return u;
    return null;
  }
  function fillEmpty(d, m) {
    const ini = initials(m && m.name);
    if (ini) { const s = document.createElement("span"); s.textContent = ini; d.appendChild(s); }
    else d.insertAdjacentHTML("beforeend", SILHOUETTE);
    const sm = document.createElement("small"); sm.textContent = "Photo to come"; d.appendChild(sm);
  }
  function photoBox(m, srcOverride) {
    const d = document.createElement("div"); d.className = "ph";
    const src = srcOverride || safeUrl(m && m.photo_url);
    if (src) {
      const im = new Image(); im.src = src; im.loading = "lazy";
      im.alt = m && m.name ? "Portrait of " + m.name : "Team member portrait";
      im.onerror = () => { d.classList.add("empty"); d.textContent = ""; fillEmpty(d, m); };
      d.appendChild(im);
    } else { d.classList.add("empty"); fillEmpty(d, m); }
    return d;
  }
  function txt(tag, cls, val, fallback) {
    const e = document.createElement(tag); if (cls) e.className = cls;
    if (val) e.textContent = val; else { e.textContent = fallback; e.classList.add("pending"); }
    return e;
  }

  /* Profile dialog */
  let last = null;
  function openProfile(m, from) {
    const ov = document.getElementById("overlay"); if (!ov) return;
    last = from;
    const ph = document.getElementById("p-ph"), box = photoBox(m);
    ph.className = box.className; ph.replaceChildren(...box.childNodes);
    const set = (id, v, f) => { const e = document.getElementById(id); e.textContent = v || f; e.classList.toggle("pending", !v); };
    set("p-role", m.role, "Role to be added"); set("p-name", m.name, "Name to be added"); set("p-bio", m.bio, "Profile to be added.");
    ov.hidden = false; document.getElementById("p-close").focus();
  }
  function closeProfile() { const ov = document.getElementById("overlay"); ov.hidden = true; if (last) last.focus(); }
  document.addEventListener("DOMContentLoaded", () => {
    const ov = document.getElementById("overlay"); if (!ov) return;
    document.getElementById("p-close").addEventListener("click", closeProfile);
    ov.addEventListener("click", e => { if (e.target === ov) closeProfile(); });
    document.addEventListener("keydown", e => { if (e.key === "Escape" && !ov.hidden) closeProfile(); });
  });

  return { client, SUPABASE_URL, photoBox, txt, initials, safeUrl, openProfile };
})();
