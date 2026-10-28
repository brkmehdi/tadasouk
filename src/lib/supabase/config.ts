// Public Supabase settings. Safe in the browser: the publishable key can only do what the row
// level security policies allow (supabase/migrations).
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
export const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";
