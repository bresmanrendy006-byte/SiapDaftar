const { createUserClient } = require('../lib/supabase');

// Membaca "Authorization: Bearer <token>", memvalidasi token ke Supabase Auth,
// lalu menempelkan req.user, req.accessToken, dan req.supabase (client per-request).
async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return res.status(401).json({ error: 'Missing bearer token' });
  }
  const token = match[1].trim();

  try {
    const supabase = createUserClient(token);
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data || !data.user) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
    req.user = data.user;
    req.accessToken = token;
    req.supabase = supabase;
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = { requireAuth };