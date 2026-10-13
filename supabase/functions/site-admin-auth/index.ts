// =============================================================================
// site-admin-auth — Supabase Edge Function
//
// Sets or resets a site admin's sign-in password. Only a signed-in site admin
// may call it (their session token is checked here, server-side), and only a
// site admin's password can be set — everyone else still signs in with their
// Employee ID alone.
//
// Each site admin has one Supabase Auth account whose address is
// "<employees.id>@sqdc.local" — a placeholder nobody receives mail at, so
// there is no "forgot password" email: another site admin resets it here.
// The account is linked to the employee through employees.auth_user_id,
// which only this function (service role) or the SQL Editor can write.
//
// Deploy with "Verify JWT" ON. No extra secrets needed (SUPABASE_URL and
// SUPABASE_SERVICE_ROLE_KEY are provided automatically).
//
// Request:  POST { action: 'set_password', employeeId, password }
// Response: { ok: true, created: boolean } | { error, message }
// =============================================================================

import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

/** Must match SITE_ADMIN_EMAIL_DOMAIN in src/lib/siteAdminAuth.ts. */
const EMAIL_DOMAIN = 'sqdc.local';
const MIN_PASSWORD = 8;
const MAX_PASSWORD = 72;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  let body: { action?: string; employeeId?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'bad_request', message: 'Body must be JSON.' }, 400);
  }
  if (body.action !== 'set_password') return json({ error: 'bad_request', message: 'Unknown action.' }, 400);

  const employeeId = String(body.employeeId ?? '');
  const password = String(body.password ?? '');
  if (!employeeId) return json({ error: 'bad_request', message: 'employeeId is required.' }, 400);
  if (password.length < MIN_PASSWORD || password.length > MAX_PASSWORD) {
    return json({ error: 'weak_password', message: `Password must be ${MIN_PASSWORD}–${MAX_PASSWORD} characters.` }, 400);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

  // ---- Caller: a signed-in, active site admin.
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const { data: userData } = await admin.auth.getUser(token);
  const callerUserId = userData?.user?.id;
  if (!callerUserId) return json({ error: 'unauthorized', message: 'Sign in as a site admin first.' }, 401);

  const { data: caller, error: callerErr } = await admin
    .from('employees')
    .select('id')
    .eq('auth_user_id', callerUserId)
    .eq('is_site_admin', true)
    .eq('active', true)
    .maybeSingle();
  if (callerErr) return json({ error: 'server_error', message: callerErr.message }, 500);
  if (!caller) return json({ error: 'forbidden', message: 'Only a signed-in site admin can set passwords.' }, 403);

  // ---- Target: an active site admin.
  const { data: target, error: targetErr } = await admin
    .from('employees')
    .select('id, name, active, is_site_admin, auth_user_id')
    .eq('id', employeeId)
    .maybeSingle();
  if (targetErr) return json({ error: 'server_error', message: targetErr.message }, 500);
  if (!target || !target.active) return json({ error: 'not_found', message: 'Unknown or inactive employee.' }, 404);
  if (!target.is_site_admin) {
    return json({ error: 'not_site_admin', message: `${target.name} isn't a site admin — only site admins sign in with a password.` }, 400);
  }

  // ---- Existing account: change its password.
  if (target.auth_user_id) {
    const { error } = await admin.auth.admin.updateUserById(target.auth_user_id, { password });
    if (error) return json({ error: 'auth_error', message: error.message }, 400);
    return json({ ok: true, created: false });
  }

  // ---- First password: create the account and link it.
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email: `${target.id}@${EMAIL_DOMAIN}`,
    password,
    email_confirm: true,
    app_metadata: { employee_id: target.id },
  });
  if (createErr || !created?.user) {
    const exists = /already|exists|registered/i.test(createErr?.message ?? '');
    return json(
      {
        error: exists ? 'account_exists' : 'auth_error',
        message: exists
          ? `A sign-in account for ${target.name} already exists but isn't linked to them — someone may have created it themselves. Delete it under Authentication → Users, then set the password again.`
          : (createErr?.message ?? 'Could not create the sign-in account.'),
      },
      400,
    );
  }

  const { data: linked, error: linkErr } = await admin
    .from('employees')
    .update({ auth_user_id: created.user.id })
    .eq('id', target.id)
    .is('auth_user_id', null)
    .select('id');
  if (linkErr || !linked?.length) {
    // Don't leave an orphan account behind.
    await admin.auth.admin.deleteUser(created.user.id);
    return json({ error: 'server_error', message: linkErr?.message ?? 'Someone else set this password at the same moment — try again.' }, 500);
  }
  return json({ ok: true, created: true });
});
