import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/** False when the build had no Supabase URL/key (e.g. a Vercel Preview
 * deployment whose environment variables are only set for Production).
 * App.tsx shows a setup message instead of crashing to a blank page. */
export const supabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

if (!supabaseConfigured) {
  console.error(
    'Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY. Copy .env.example to .env.local (local) or add them in Vercel → Settings → Environment Variables for every environment (Production AND Preview).'
  );
}

// createClient throws on an empty URL, which would take the whole app down
// before anything renders — use a harmless placeholder when unconfigured.
export const supabase = createClient(supabaseUrl || 'https://not-configured.invalid', supabaseAnonKey || 'not-configured');
