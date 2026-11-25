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
app.use('/api/matches', require('./routes/matches'));
app.use('/api/saved', require('./routes/saved'));

// ---------- Static frontend ----------
// 1) Kalau ada hasil build (frontend/dist, mis. dari Vite), sajikan itu.
// 2) Kalau frontend/ adalah file static biasa (tanpa package.json), sajikan folder itu.
// 3) Kalau frontend/ adalah project Vite yang belum di-build, jangan sajikan file sumbernya.
const frontendRoot = path.join(__dirname, '..', 'frontend');
const frontendDist = path.join(frontendRoot, 'dist');
const hasBuild = fs.existsSync(path.join(frontendDist, 'index.html'));
const isBuildProject = fs.existsSync(path.join(frontendRoot, 'package.json'));

if (hasBuild) {
  app.use(express.static(frontendDist));
} else if (!isBuildProject && fs.existsSync(frontendRoot)) {
  app.use(express.static(frontendRoot));
} else if (isBuildProject) {
  console.log(
    'Frontend is a build project and has no build yet. Run "npm run dev" in frontend/ (port 5173) or "npm run build" there to serve it from this server.'
  );
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