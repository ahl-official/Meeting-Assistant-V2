import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.warn('[supabase] NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not set');
}

// Fall back to a syntactically valid placeholder (never real) so createClient()
// doesn't throw when env vars are absent at build time — e.g. Next.js's static
// page-data collection during `next build` inside Docker, before the real env
// vars are injected at container runtime.
export const supabase = createClient(url || 'http://localhost:54321', key || 'placeholder-key', {
  auth: { persistSession: false },
});
