const { createClient } = require('@supabase/supabase-js');

// Hanya publishable key. Tidak ada service_role di project ini.
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

const baseAuthOptions = {
  persistSession: false,
  autoRefreshToken: false,
  detectSessionInUrl: false,
};

// Client tanpa user (untuk signup/login).
function createAnonClient() {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: baseAuthOptions });
}

// Client per-request yang meneruskan access token user,
// jadi RLS dan auth.uid() berlaku untuk semua query.
function createUserClient(accessToken) {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: baseAuthOptions,
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}

module.exports = { createAnonClient, createUserClient };