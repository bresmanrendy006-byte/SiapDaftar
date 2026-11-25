require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

// ---------- Env check (hanya nama variabel yang dicetak, tidak pernah nilainya) ----------
const REQUIRED_ENV = ['SUPABASE_URL', 'SUPABASE_ANON_KEY'];
const missing = REQUIRED_ENV.filter((k) => !process.env[k]);
if (missing.length) {
  console.error('Missing env vars: ' + missing.join(', ') + '. See backend/.env.example');
  process.exit(1);
}

// ---------- Safety: tolak secret/service_role key ----------
function failSecretKey() {
  console.error(
    'SUPABASE_ANON_KEY looks like a secret/service_role key. Use the PUBLISHABLE key only.'
  );
  process.exit(1);
}
(function assertPublishableKey(key) {
  if (key.startsWith('sb_secret_')) failSecretKey();
  const parts = key.split('.');
  if (parts.length === 3) {
    try {
      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
      if (payload.role === 'service_role') failSecretKey();
    } catch (_) {
      /* bukan JWT yang bisa dibaca, lanjut */
    }
  }
})(process.env.SUPABASE_ANON_KEY);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '100kb' }));

// ---------- Routes ----------
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'siapdaftar-backend',
    time: new Date().toISOString(),
  });
});

app.use('/api/auth', require('./routes/auth'));
app.use('/api/profile', require('./routes/profile'));
// Task 4-5 akan menambah router di sini (matching, saved)

// ---------- Static frontend (opsional, kalau folder frontend/ ada) ----------
const frontendDir = path.join(__dirname, '..', 'frontend');
if (fs.existsSync(frontendDir)) {
  app.use(express.static(frontendDir));
}

// ---------- 404 & error handler ----------
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`SiapDaftar backend running on http://localhost:${PORT}`);
});