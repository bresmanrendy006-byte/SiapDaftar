const express = require('express');
const { createAnonClient } = require('../lib/supabase');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateCredentials(email, password) {
  if (typeof email !== 'string' || !EMAIL_RE.test(email.trim())) {
    return 'A valid email is required';
  }
  if (typeof password !== 'string' || password.length < 8) {
    return 'Password must be at least 8 characters';
  }
  return null;
}

function sessionPayload(session) {
  if (!session) return null;
  return {
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    expires_at: session.expires_at,
    token_type: 'bearer',
  };
}

function userPayload(user) {
  return user ? { id: user.id, email: user.email } : null;
}

// POST /api/auth/signup  { email, password }
router.post('/signup', async (req, res, next) => {
  try {
    const { email, password } = req.body || {};
    const problem = validateCredentials(email, password);
    if (problem) return res.status(400).json({ error: problem });

    const supabase = createAnonClient();
    const { data, error } = await supabase.auth.signUp({
      email: email.trim().toLowerCase(),
      password,
    });

    if (error) {
      const status = error.status && error.status >= 400 && error.status < 500 ? error.status : 400;
      return res.status(status).json({ error: error.message });
    }

    const session = sessionPayload(data.session);
    res.status(201).json({
      user: userPayload(data.user),
      session,
      requires_email_confirmation: !session,
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/login  { email, password }
router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body || {};
    const problem = validateCredentials(email, password);
    if (problem) return res.status(400).json({ error: problem });

    const supabase = createAnonClient();
    const { data, error } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    });

    if (error) {
      if (error.status === 429) return res.status(429).json({ error: error.message });
      if (!error.status || error.status >= 500) {
        return res.status(502).json({ error: 'Auth service unavailable' });
      }
      return res.status(401).json({ error: error.message });
    }

    res.json({ user: userPayload(data.user), session: sessionPayload(data.session) });
  } catch (err) {
    next(err);
  }
});

// GET /api/auth/me  (butuh Authorization: Bearer <token>)
router.get('/me', requireAuth, (req, res) => {
  res.json({ user: userPayload(req.user) });
});

module.exports = router;