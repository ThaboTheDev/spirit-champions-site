// Spirit Champions HQ team site: set a password with a one-time join code.
// Public endpoint (deploy with verify_jwt off) protected by the code itself:
// codes are hashed in the database, expire, and lock after 5 wrong tries.
import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const reply = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const MESSAGES: Record<string, string> = {
  no_code: "There is no join code for this email. Ask Sam to add you and send you a code.",
  expired: "This join code has expired. Ask Sam for a new one.",
  locked: "Too many wrong codes. Ask Sam for a new one.",
  wrong: "That code is not right. Check the code Sam sent you and try again.",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return reply(405, { error: "Method not allowed" });

  let body: { email?: unknown; code?: unknown; password?: unknown };
  try { body = await req.json(); } catch { return reply(400, { error: "Invalid request." }); }
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const code = typeof body.code === "string" ? body.code.replace(/\s+/g, "") : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 254) return reply(400, { error: "Enter a valid email address." });
  if (!/^\d{6}$/.test(code)) return reply(400, { error: "The join code has 6 digits." });
  if (password.length < 8 || password.length > 72) return reply(400, { error: "Choose a password of at least 8 characters." });

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: status, error: checkErr } = await admin.rpc("sc_check_code", { p_email: email, p_code: code });
  if (checkErr) return reply(500, { error: "Something went wrong. Try again in a minute." });
  if (status !== "ok") return reply(400, { error: MESSAGES[status as string] ?? MESSAGES.wrong });

  const { data: found, error: findErr } = await admin.rpc("sc_find_user", { p_email: email });
  if (findErr) return reply(500, { error: "Something went wrong. Try again in a minute." });
  const existing = Array.isArray(found) && found.length ? found[0] as { id: string; app: string } : null;

  // An account from another MSRI/AHV system keeps its password, unless the
  // database owner has marked this email allow_reset (set only from the database).
  let allowReset = false;
  if (existing && existing.app !== "spirit-champions") {
    const { data: acc } = await admin.from("sc_team_access").select("allow_reset").eq("email", email).maybeSingle();
    allowReset = !!(acc && acc.allow_reset);
  }

  let userId: string;
  let kept = false;
  if (existing && existing.app !== "spirit-champions" && !allowReset) {
    userId = existing.id;
    kept = true;
  } else if (existing) {
    const { error } = await admin.auth.admin.updateUserById(existing.id, { password });
    if (error) return reply(400, { error: error.message || "That password could not be saved." });
    userId = existing.id;
  } else {
    const { data, error } = await admin.auth.admin.createUser({
      email, password, email_confirm: true, app_metadata: { app: "spirit-champions" },
    });
    if (error || !data.user) return reply(400, { error: error?.message || "The account could not be created." });
    userId = data.user.id;
  }

  const { error: doneErr } = await admin.rpc("sc_complete_join", { p_email: email, p_user: userId });
  if (doneErr) return reply(500, { error: "Something went wrong. Try again in a minute." });
  if (allowReset) await admin.from("sc_team_access").update({ allow_reset: false }).eq("email", email);
  return reply(200, { ok: true, kept });
});
