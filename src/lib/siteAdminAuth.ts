// Site-admin password sign-in.
//
// Everyone else signs in with their Employee ID alone. A site admin also has
// a Supabase Auth account whose address is "<employees.id>@sqdc.local" — a
// placeholder, never shown to anyone and never sent mail — so they type
// Employee ID + password. The database only treats them as a site admin while
// that session is active (see supabase/migrations_site_admin_auth.sql).
//
// Passwords are set and reset by another signed-in site admin through the
// site-admin-auth Edge Function; the very first one is set in the Supabase
// dashboard (README → Site-admin passwords).

import { supabase } from './supabaseClient';
import type { Employee } from '../types';

/** Must match EMAIL_DOMAIN in supabase/functions/site-admin-auth/index.ts. */
const SITE_ADMIN_EMAIL_DOMAIN = 'sqdc.local';
export const MIN_PASSWORD_LENGTH = 8;

export function siteAdminEmail(employee: Pick<Employee, 'id'>): string {
  return `${employee.id}@${SITE_ADMIN_EMAIL_DOMAIN}`;
}

/** Signs a site admin in. Throws a plain-language error on a wrong password,
 * or when the signed-in account isn't the one linked to this employee. */
export async function signInSiteAdmin(employee: Employee, password: string): Promise<void> {
  const { data, error } = await supabase.auth.signInWithPassword({ email: siteAdminEmail(employee), password });
  if (error) {
    if (/invalid login credentials/i.test(error.message)) throw new Error('Wrong password.');
    throw new Error(error.message);
  }
  if (data.user?.id !== employee.auth_user_id) {
    await supabase.auth.signOut();
    throw new Error('This sign-in account is not linked to your Employee ID. Ask another site admin to reset your password.');
  }
}

/** The Auth user id of the session in this browser, if any. */
export async function currentAuthUserId(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.user.id ?? null;
}

export async function signOutSiteAdmin(): Promise<void> {
  // 'local' clears this browser only; the admin's other devices stay signed in.
  await supabase.auth.signOut({ scope: 'local' });
}

/** Sets (first time) or resets a site admin's password. Caller must be a
 * signed-in site admin; the server checks. */
export async function setSiteAdminPassword(employeeId: string, password: string): Promise<{ created: boolean }> {
  const { data, error } = await supabase.functions.invoke('site-admin-auth', {
    body: { action: 'set_password', employeeId, password },
  });
  if (error) {
    // FunctionsHttpError carries the function's own JSON response.
    const ctx = (error as { context?: Response }).context;
    let body: { message?: string } | null = null;
    if (ctx && typeof ctx.json === 'function') {
      try {
        body = await ctx.json();
      } catch {
        body = null;
      }
    }
    throw new Error(body?.message ?? error.message ?? 'Could not set the password.');
  }
  return { created: Boolean((data as { created?: boolean })?.created) };
}
