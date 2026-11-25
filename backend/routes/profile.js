const express = require('express');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

const PILOT_CAMPUS_ID = 1; // ITB, satu-satunya kampus di pilot ini
const COLUMNS = 'user_id, campus_id, program, semester, gpa, interests';

// Number() tapi hanya untuk number/string (boolean dll. dianggap tidak valid)
function toNumber(v) {
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && v.trim() !== '') return Number(v);
  return NaN;
}

function isBlank(v) {
  return v === undefined || v === null || v === '';
}

// Validasi + normalisasi body. Mengembalikan { errors, row }.
function parseProfile(body, userId) {
  const b = body || {};
  const errors = [];

  // campus
  let campusId = PILOT_CAMPUS_ID;
  if (!isBlank(b.campus_id)) {
    campusId = toNumber(b.campus_id);
    if (campusId !== PILOT_CAMPUS_ID) {
      errors.push('campus_id must be 1 (ITB is the only campus in this pilot)');
    }
  }

  // program
  const program = typeof b.program === 'string' ? b.program.trim() : '';
  if (!program || program.length > 100) {
    errors.push('program is required (max 100 characters)');
  }

  // semester
  const semester = toNumber(b.semester);
  if (!Number.isInteger(semester) || semester < 1 || semester > 14) {
    errors.push('semester must be a whole number from 1 to 14');
  }

  // gpa (OPSIONAL)
  let gpa = null;
  if (!isBlank(b.gpa)) {
    const g = toNumber(b.gpa);
    const twoDecimals = Math.abs(g * 100 - Math.round(g * 100)) < 1e-9;
    if (!Number.isFinite(g) || g < 0 || g > 4 || !twoDecimals) {
      errors.push('gpa is optional, but if given it must be between 0.00 and 4.00 with at most 2 decimals');
    } else {
      gpa = Math.round(g * 100) / 100;
    }
  }

  // interests (array of strings atau string dipisah koma)
  let interests = [];
  if (!isBlank(b.interests)) {
    const raw = typeof b.interests === 'string' ? b.interests.split(',') : b.interests;
    if (!Array.isArray(raw) || raw.some((i) => typeof i !== 'string')) {
      errors.push('interests must be an array of strings or a comma-separated string');
    } else {
      interests = [...new Set(raw.map((i) => i.trim()).filter(Boolean))];
      if (interests.length > 10 || interests.some((i) => i.length > 50)) {
        errors.push('interests: at most 10 items, each up to 50 characters');
      }
    }
  }

  return {
    errors,
    row: {
      user_id: userId,
      campus_id: campusId,
      program,
      semester,
      gpa,
      interests,
    },
  };
}

function dbFail(res, error) {
  // Log hanya code + message, tidak pernah isi profil (IPK bersifat privat).
  console.error('DB error:', error.code, error.message);
  if (error.code === '42501') {
    return res.status(500).json({
      error: 'Database permission error (check the GRANT statements at the end of schema_siapdaftar.sql)',
    });
  }
  return res.status(500).json({ error: 'Database error' });
}

// GET /api/profile  -> profil milik user yang login (atau { profile: null })
router.get('/', async (req, res, next) => {
  try {
    const { data, error } = await req.supabase
      .from('profiles')
      .select(COLUMNS)
      .eq('user_id', req.user.id)
      .maybeSingle();
    if (error) return dbFail(res, error);
    res.json({ profile: data });
  } catch (err) {
    next(err);
  }
});

// PUT /api/profile  { campus_id?, program, semester, gpa?, interests? }  -> upsert
router.put('/', async (req, res, next) => {
  try {
    const { errors, row } = parseProfile(req.body, req.user.id);
    if (errors.length) return res.status(400).json({ error: 'Invalid profile', details: errors });

    const { data, error } = await req.supabase
      .from('profiles')
      .upsert(row, { onConflict: 'user_id' })
      .select(COLUMNS)
      .single();
    if (error) return dbFail(res, error);
    res.json({ profile: data });
  } catch (err) {
    next(err);
  }
});

module.exports = router;