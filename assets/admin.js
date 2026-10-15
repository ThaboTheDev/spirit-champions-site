/* Team sign-in and management for the Spirit Champions HQ team site. */
(function () {
  const $ = id => document.getElementById(id);
  const { client, photoBox, SUPABASE_URL } = SC;
  const BUCKET = "sc-member-photos";
  let session = null, me = null, members = [], access = [], editing = null, pending = null, saving = false, delArm = null, accArm = null, codeFor = null;

  const show = (id, on) => { $(id).hidden = !on; };
  function msg(id, t, kind) { const e = $(id); e.textContent = t || ""; e.className = "msg" + (kind ? " " + kind : ""); }
  function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }

  /* ---------- auth views ---------- */
  function setAuthTab(which) {
    const login = which === "login";
    $("tab-login").setAttribute("aria-selected", String(login));
    $("tab-join").setAttribute("aria-selected", String(!login));
    show("form-login", login); show("form-join", !login);
  }
  $("tab-login").addEventListener("click", () => setAuthTab("login"));
  $("tab-join").addEventListener("click", () => setAuthTab("join"));

  $("form-login").addEventListener("submit", async e => {
    e.preventDefault();
    const email = $("l-email").value.trim().toLowerCase(), password = $("l-pass").value;
    if (!email || !password) { msg("l-msg", "Enter your email and password.", "err"); return; }
    $("l-go").disabled = true; msg("l-msg", "Signing in…");
    const { error } = await client.auth.signInWithPassword({ email, password });
    $("l-go").disabled = false;
    if (error) msg("l-msg", "That email and password don't match. If this is your first time, use \"First time or new code\".", "err");
    else msg("l-msg", "");
  });

  $("form-join").addEventListener("submit", async e => {
    e.preventDefault();
    const email = $("j-email").value.trim().toLowerCase(), code = $("j-code").value.replace(/\s+/g, ""), password = $("j-pass").value;
    if (!email) { msg("j-msg", "Enter your email.", "err"); return; }
    if (!/^\d{6}$/.test(code)) { msg("j-msg", "The join code has 6 digits.", "err"); return; }
    if (password.length < 8) { msg("j-msg", "Choose a password of at least 8 characters.", "err"); return; }
    if (password !== $("j-pass2").value) { msg("j-msg", "The two passwords don't match.", "err"); return; }
    $("j-go").disabled = true; msg("j-msg", "Setting your password…");
    try {
      const r = await fetch(SUPABASE_URL + "/functions/v1/sc-join", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, code, password }),
      });
      const out = await r.json().catch(() => ({}));
      if (!r.ok || !out.ok) { msg("j-msg", out.error || "That didn't work. Try again.", "err"); return; }
      if (out.kept) {
        msg("j-msg", "");
        setAuthTab("login"); $("l-email").value = email;
        msg("l-msg", "Your email already has an account from another MSRI or AHV system. Sign in with that password.", "ok");
        return;
      }
      const { error } = await client.auth.signInWithPassword({ email, password });
      if (error) { setAuthTab("login"); $("l-email").value = email; msg("l-msg", "Your password is set. Please sign in.", "ok"); }
    } catch (_) {
      msg("j-msg", "Couldn't reach the server. Check your connection and try again.", "err");
    } finally { $("j-go").disabled = false; }
  });

  async function signOut() { await client.auth.signOut(); }
  $("signout").addEventListener("click", signOut);
  $("denied-out").addEventListener("click", signOut);

  /* ---------- session routing ---------- */
  async function route() {
    ["view-auth", "view-denied", "view-members", "view-register", "view-access", "bar"].forEach(id => show(id, false));
    if (!session) { show("view-auth", true); return; }
    const email = session.user.email || "";
    const { data, error } = await client.from("sc_team_access").select("email,is_admin,user_id").eq("user_id", session.user.id).maybeSingle();
    if (error || !data) { $("denied-email").textContent = email; show("view-denied", true); return; }
    me = { id: session.user.id, email, admin: !!data.is_admin };
    $("who").textContent = "Signed in as " + email;
    $("tab-access").hidden = !me.admin;
    show("bar", true);
    await loadMembers();
    if (me.admin) await loadAccess();
    showTab("members");
    startNew();
  }
  client.auth.onAuthStateChange((evt, s) => {
    const changed = (s && s.user && s.user.id) !== (session && session.user && session.user.id);
    session = s;
    if (evt === "INITIAL_SESSION" || evt === "SIGNED_IN" || evt === "SIGNED_OUT" || changed) setTimeout(route, 0);
  });

  function showTab(t) {
    if (t === "access" && !(me && me.admin)) t = "members";
    ["members", "register", "access"].forEach(k => {
      show("view-" + k, k === t);
      $("tab-" + k).setAttribute("aria-selected", String(k === t));
    });
  }
  $("tab-members").addEventListener("click", () => showTab("members"));
  $("tab-access").addEventListener("click", () => { showTab("access"); loadAccess(); });
  $("tab-register").addEventListener("click", () => { showTab("register"); loadRegister(); });

  /* ---------- register ---------- */
  let regRows = [], takeRows = [];
  const todaySA = () => new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Johannesburg" });
  async function loadRegister() {
    msg("g-msg", "Loading…");
    const [a, t] = await Promise.all([
      client.from("sc_attendance").select("*").order("created_at"),
      client.from("sc_takeaways").select("*").order("created_at"),
    ]);
    if (a.error || t.error) { msg("g-msg", "The register couldn't load. Try Refresh.", "err"); return; }
    regRows = a.data; takeRows = t.data; msg("g-msg", "");
    const sel = $("g-date"), keep = sel.value;
    const dates = [...new Set([todaySA(), ...regRows.map(r => r.session_date), ...takeRows.map(r => r.session_date)])].sort().reverse();
    sel.replaceChildren(...dates.map(d => { const o = el("option", "", new Date(d + "T12:00:00").toLocaleDateString("en-ZA", { day: "numeric", month: "long", year: "numeric" })); o.value = d; return o; }));
    sel.value = dates.includes(keep) ? keep : dates[0];
    renderRegister();
  }
  function renderRegister() {
    const d = $("g-date").value;
    const rows = regRows.filter(r => r.session_date === d), takes = takeRows.filter(r => r.session_date === d);
    const T = $("g-table"); T.textContent = "";
    const cell = (tag, text, st) => { const c = el(tag, "", text); c.style.cssText = "text-align:left;padding:10px 12px;border-top:1px solid var(--line);vertical-align:top" + (st || ""); return c; };
    const hr = el("tr");
    ["#", "Name", "Phone", "Email", "Spiritual centre", "University or SCSS chapter", "First time", "Filming consent", "Signed at"].forEach(h => hr.appendChild(cell("th", h, ";background:var(--sand);font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--gold-dk);border-top:0")));
    T.appendChild(hr);
    rows.forEach((r, i) => {
      const tr = el("tr");
      [String(i + 1), r.full_name, r.phone || "", r.email || "", r.spiritual_centre || "", r.institution || "", r.first_time == null ? "" : (r.first_time ? "Yes" : "No"), r.consent_media ? "Yes" : "No",
        new Date(r.created_at).toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Johannesburg" })]
        .forEach((v, j) => { const c = cell("td", v); if (j === 7 && !r.consent_media) { c.style.color = "var(--err)"; c.style.fontWeight = "700"; } T.appendChild(tr).appendChild(c); });
    });
    if (!rows.length) { const tr = el("tr"); const c = cell("td", "Nobody has signed the register for this session yet."); c.colSpan = 9; c.style.color = "var(--muted)"; tr.appendChild(c); T.appendChild(tr); }
    const noConsent = rows.filter(r => !r.consent_media).length;
    msg("g-msg", rows.length + (rows.length === 1 ? " reader" : " readers") + " signed in" + (noConsent ? " · " + noConsent + " did not agree to filming, seat them out of the camera's view" : ""), noConsent ? "err" : "ok");
    const K = $("k-list"); K.textContent = "";
    $("k-n").textContent = takes.length + (takes.length === 1 ? " response" : " responses");
    if (!takes.length) K.appendChild(el("div", "state", "No takeaways yet. Readers add them at 11:15 under \"Before you leave\"."));
    takes.forEach(t => { const r = el("div", "item noimg"); const b = el("div"); b.append(el("div", "nm", t.full_name), el("div", "bio", t.takeaway)); r.appendChild(b); K.appendChild(r); });
  }
  $("g-date").addEventListener("change", renderRegister);
  $("g-refresh").addEventListener("click", loadRegister);
  $("g-csv").addEventListener("click", () => {
    const d = $("g-date").value;
    const q = v => '"' + String(v == null ? "" : v).replace(/"/g, '""') + '"';
    const takeBy = {}; takeRows.filter(t => t.session_date === d).forEach(t => { const k = (t.phone || t.full_name).toLowerCase().replace(/\s+/g, ""); takeBy[k] = t.takeaway; });
    const lines = [["Session date", "Full name", "Phone", "Email", "Spiritual centre", "University or SCSS chapter", "First time", "Filming consent", "Signed at", "Takeaway"].map(q).join(",")];
    regRows.filter(r => r.session_date === d).forEach(r => {
      const k = (r.phone || r.full_name).toLowerCase().replace(/\s+/g, "");
      lines.push([d, r.full_name, r.phone, r.email, r.spiritual_centre, r.institution, r.first_time == null ? "" : (r.first_time ? "Yes" : "No"), r.consent_media ? "Yes" : "No",
        new Date(r.created_at).toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Johannesburg" }), takeBy[k] || ""].map(q).join(","));
    });
    const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "spirit-champions-register-" + d + ".csv";
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  });

  /* ---------- members ---------- */
  async function loadMembers() {
    const { data, error } = await client.from("sc_members").select("*").order("position").order("name");
    if (error) { msg("f-msg", "The team list couldn't load. Refresh the page.", "err"); return; }
    members = data; renderList();
  }
  function nextOrder() { return members.reduce((a, m) => Math.max(a, m.position < 999 ? m.position : 0), 0) + 1; }

  function renderList() {
    const L = $("list"); L.textContent = "";
    $("list-n").textContent = members.length + " in total";
    if (!members.length) { L.appendChild(el("div", "state", "No members yet. Add the first one with the form.")); return; }
    members.forEach(m => {
      const r = el("div", "item" + (editing === m.id ? " editing" : ""));
      r.appendChild(photoBox(m));
      const t = el("div");
      const nm = el("div", "nm" + (m.name ? "" : " pending"), m.name || "Name to be added");
      if (m.grp === "lead") nm.appendChild(el("span", "chip", "Lead"));
      if (!m.photo_url) nm.appendChild(el("span", "chip miss", "No photo"));
      t.append(nm, el("div", "rl", (m.role || "Role to be added") + " · position " + m.position));
      r.appendChild(t);
      const ops = el("div", "ops");
      const e = el("button", "lnk", "Edit"); e.type = "button"; e.addEventListener("click", () => startEdit(m));
      const d = el("button", "lnk del", delArm === m.id ? "Confirm remove" : "Remove"); d.type = "button";
      d.addEventListener("click", () => { if (delArm === m.id) removeMember(m); else { delArm = m.id; renderList(); } });
      ops.append(e, d);
      if (delArm === m.id) { const k = el("button", "lnk", "Keep"); k.type = "button"; k.addEventListener("click", () => { delArm = null; renderList(); }); ops.appendChild(k); }
      r.appendChild(ops); L.appendChild(r);
    });
  }

  function setPreview(m, src) {
    const box = photoBox(m, src), p = $("f-prev"); p.className = box.className; p.replaceChildren(...box.childNodes);
    $("f-photo-clear").hidden = !(src || (m && m.photo_url));
  }
  function bioCount() { $("f-bio-n").textContent = $("f-bio").value.length + " of 700 characters"; }
  $("f-bio").addEventListener("input", bioCount);

  function startNew() {
    editing = null; pending = null; delArm = null;
    $("form-h").textContent = "Add a member"; $("f-save").textContent = "Add member"; $("f-cancel").hidden = true;
    $("f-name").value = ""; $("f-role").value = ""; $("f-bio").value = ""; $("f-group").value = "team"; $("f-order").value = nextOrder();
    $("f-photo").value = ""; setPreview(null, null); bioCount();
    renderList();
  }
  function startEdit(m) {
    editing = m.id; pending = null; delArm = null;
    $("form-h").textContent = "Edit " + (m.name || "member"); $("f-save").textContent = "Save changes"; $("f-cancel").hidden = false;
    $("f-name").value = m.name; $("f-role").value = m.role; $("f-bio").value = m.bio; $("f-group").value = m.grp; $("f-order").value = m.position;
    $("f-photo").value = ""; setPreview(m, null); bioCount(); msg("f-msg", "");
    renderList(); $("f-name").focus();
    if (window.matchMedia("(max-width: 980px)").matches) $("form").scrollIntoView({ behavior: "smooth" });
  }
  $("f-cancel").addEventListener("click", () => { startNew(); msg("f-msg", ""); });

  function loadImg(file) {
    return new Promise((res, rej) => { const u = URL.createObjectURL(file); const im = new Image(); im.onload = () => res({ im, u }); im.onerror = () => { URL.revokeObjectURL(u); rej(new Error("decode")); }; im.src = u; });
  }
  async function shrink(file) {
    const { im, u } = await loadImg(file); URL.revokeObjectURL(u);
    const max = 1000, s = Math.min(1, max / Math.max(im.naturalWidth, im.naturalHeight));
    const c = document.createElement("canvas"); c.width = Math.round(im.naturalWidth * s); c.height = Math.round(im.naturalHeight * s);
    c.getContext("2d").drawImage(im, 0, 0, c.width, c.height);
    return await new Promise((res, rej) => c.toBlob(b => b ? res(b) : rej(new Error("encode")), "image/jpeg", 0.86));
  }
  $("f-photo").addEventListener("change", async e => {
    const f = e.target.files && e.target.files[0]; if (!f) return;
    try { const blob = await shrink(f); pending = { blob, url: URL.createObjectURL(blob) }; setPreview({ name: $("f-name").value }, pending.url); msg("f-msg", ""); }
    catch (_) { pending = null; msg("f-msg", "That picture could not be opened. Please choose a JPG, PNG or WebP file.", "err"); }
  });
  $("f-photo-clear").addEventListener("click", () => {
    pending = { clear: true }; $("f-photo").value = ""; setPreview({ name: $("f-name").value }, null); $("f-photo-clear").hidden = true;
  });

  function storagePath(url) {
    const pre = SUPABASE_URL + "/storage/v1/object/public/" + BUCKET + "/";
    return typeof url === "string" && url.startsWith(pre) ? url.slice(pre.length) : null;
  }

  $("form").addEventListener("submit", async e => {
    e.preventDefault(); if (saving) return;
    const name = $("f-name").value.trim();
    if (!name) { msg("f-msg", "Please enter the member's full name.", "err"); $("f-name").focus(); return; }
    let position = parseInt($("f-order").value, 10); if (!Number.isFinite(position) || position < 1 || position > 999) position = nextOrder();
    const prev = editing ? members.find(m => m.id === editing) : null;
    const row = { name, role: $("f-role").value.trim(), bio: $("f-bio").value.trim(), grp: $("f-group").value === "lead" ? "lead" : "team", position, photo_url: prev ? prev.photo_url : null };
    saving = true; $("f-save").disabled = true; msg("f-msg", pending && pending.blob ? "Uploading photo…" : "Saving…");
    let oldPhoto = null;
    try {
      if (pending && pending.blob) {
        const path = crypto.randomUUID() + ".jpg";
        const up = await client.storage.from(BUCKET).upload(path, pending.blob, { contentType: "image/jpeg", upsert: false });
        if (up.error) throw up.error;
        oldPhoto = row.photo_url;
        row.photo_url = client.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
      } else if (pending && pending.clear) { oldPhoto = row.photo_url; row.photo_url = null; }
      const q = editing ? client.from("sc_members").update(row).eq("id", editing) : client.from("sc_members").insert(row);
      const { error } = await q;
      if (error) throw error;
      const old = storagePath(oldPhoto); if (old) client.storage.from(BUCKET).remove([old]);
      const done = editing ? "Saved." : name + " was added.";
      await loadMembers();
      if (!editing) startNew(); else { pending = null; $("f-photo").value = ""; const m = members.find(x => x.id === editing); if (m) setPreview(m, null); }
      msg("f-msg", done, "ok");
    } catch (err) {
      msg("f-msg", "That didn't save. " + (err && err.message ? err.message : "Check your connection and try again."), "err");
    } finally { saving = false; $("f-save").disabled = false; }
  });

  async function removeMember(m) {
    delArm = null;
    const { error } = await client.from("sc_members").delete().eq("id", m.id);
    if (error) { msg("f-msg", "That member couldn't be removed. Try again.", "err"); renderList(); return; }
    const p = storagePath(m.photo_url); if (p) client.storage.from(BUCKET).remove([p]);
    if (editing === m.id) startNew();
    await loadMembers();
    msg("f-msg", (m.name || "Member") + " was removed.", "ok");
  }

  /* ---------- team access ---------- */
  async function loadAccess() {
    if (!me || !me.admin) return;
    const { data, error } = await client.from("sc_team_access").select("email,is_admin,user_id,code_expires,failed_attempts,joined_at").order("added_at");
    if (error) { msg("a-msg", "The access list couldn't load.", "err"); return; }
    access = data; renderAccess();
  }
  function statusOf(a) {
    if (a.code_expires && new Date(a.code_expires) > new Date()) {
      if (a.failed_attempts >= 5) return ["chip miss", "Code locked"];
      return ["chip", "Code sent · until " + new Date(a.code_expires).toLocaleDateString("en-ZA", { day: "numeric", month: "short" })];
    }
    if (a.user_id) return ["chip good", "Joined"];
    return ["chip miss", "No code yet"];
  }
  function whatsappText(email, code) {
    return "Hello, you have been added to the Spirit Champions HQ team page.\n\n" +
      "1. Open " + location.origin + "/admin\n" +
      "2. Tap \"First time or new code\"\n" +
      "3. Enter your email: " + email + "\n" +
      "4. Enter this join code: " + code + "\n" +
      "5. Choose your own password\n\n" +
      "The code works for 7 days. After that you sign in with your email and password.\n\nSam Langa, Programme Lead";
  }
  function renderAccess() {
    const L = $("acc-list"); L.textContent = "";
    $("acc-n").textContent = access.length + (access.length === 1 ? " person" : " people");
    access.forEach(a => {
      const self = me && a.user_id === me.id;
      const r = el("div", "item noimg");
      const t = el("div");
      const nm = el("div", "nm", a.email);
      if (a.is_admin) nm.appendChild(el("span", "chip", "Admin"));
      const [cc, ct] = statusOf(a); nm.appendChild(el("span", cc, ct));
      t.append(nm, el("div", "rl", self ? "This is you" : (a.joined_at ? "Joined " + new Date(a.joined_at).toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" }) : "Not signed in yet")));
      r.appendChild(t);
      const ops = el("div", "ops");
      if (!self) {
        const g = el("button", "lnk", a.user_id ? "New code (reset password)" : "Create join code"); g.type = "button";
        g.addEventListener("click", () => issueCode(a.email));
        const ad = el("button", "lnk", a.is_admin ? "Remove admin" : "Make admin"); ad.type = "button";
        ad.addEventListener("click", () => setAdmin(a.email, !a.is_admin));
        const rm = el("button", "lnk del", accArm === a.email ? "Confirm remove" : "Remove access"); rm.type = "button";
        rm.addEventListener("click", () => { if (accArm === a.email) removeAccess(a.email); else { accArm = a.email; renderAccess(); } });
        ops.append(g, ad, rm);
        if (accArm === a.email) { const k = el("button", "lnk", "Keep"); k.type = "button"; k.addEventListener("click", () => { accArm = null; renderAccess(); }); ops.appendChild(k); }
      }
      r.appendChild(ops);
      if (codeFor && codeFor.email === a.email) {
        const box = el("div", "codebox");
        box.appendChild(el("div", "hint", "Join code for " + a.email + ". It is shown only once, so send it now."));
        box.appendChild(el("div", "code", codeFor.code));
        const ta = el("textarea"); ta.readOnly = true; ta.value = whatsappText(a.email, codeFor.code); ta.setAttribute("aria-label", "Message to send");
        box.appendChild(ta);
        const acts = el("div", "actions");
        const cp = el("button", "btn ghost", "Copy message"); cp.type = "button";
        cp.addEventListener("click", async () => {
          try { await navigator.clipboard.writeText(ta.value); cp.textContent = "Copied"; } catch (_) { ta.select(); cp.textContent = "Press Ctrl+C to copy"; }
        });
        const wa = el("a", "btn", "Open in WhatsApp"); wa.href = "https://wa.me/?text=" + encodeURIComponent(ta.value); wa.target = "_blank"; wa.rel = "noopener";
        const dn = el("button", "lnk", "Done"); dn.type = "button"; dn.addEventListener("click", () => { codeFor = null; renderAccess(); });
        acts.append(cp, wa, dn); box.appendChild(acts);
        r.appendChild(box);
      }
      L.appendChild(r);
    });
  }
  async function issueCode(email) {
    const { data, error } = await client.rpc("sc_issue_code", { p_email: email });
    if (error) { msg("a-msg", "Couldn't create a code: " + error.message, "err"); return; }
    codeFor = { email, code: data }; msg("a-msg", "");
    await loadAccess();
  }
  async function setAdmin(email, on) {
    const { error } = await client.from("sc_team_access").update({ is_admin: on }).eq("email", email);
    if (error) msg("a-msg", "That change didn't save.", "err"); else msg("a-msg", email + (on ? " is now an admin." : " is no longer an admin."), "ok");
    await loadAccess();
  }
  async function removeAccess(email) {
    accArm = null;
    const { error } = await client.from("sc_team_access").delete().eq("email", email);
    if (error) msg("a-msg", "Couldn't remove access.", "err"); else msg("a-msg", email + " can no longer sign in to edit.", "ok");
    if (codeFor && codeFor.email === email) codeFor = null;
    await loadAccess();
  }
  $("form-access").addEventListener("submit", async e => {
    e.preventDefault();
    const email = $("a-email").value.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { msg("a-msg", "Enter a valid email address.", "err"); return; }
    $("a-go").disabled = true;
    const { error } = await client.from("sc_team_access").insert({ email, is_admin: $("a-admin").checked });
    $("a-go").disabled = false;
    if (error) { msg("a-msg", error.code === "23505" ? "That email is already on the list." : "Couldn't add that email.", "err"); return; }
    $("a-email").value = ""; $("a-admin").checked = false;
    await issueCode(email);
    msg("a-msg", email + " was added. Send them the code below.", "ok");
  });
})();
