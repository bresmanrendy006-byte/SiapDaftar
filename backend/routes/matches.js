const express = require('express');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

const LABEL_RANK = { 'fully eligible': 0, 'partially eligible': 1, 'not yet eligible': 2 };

// Tanggal "hari ini" di WIB (YYYY-MM-DD), supaya countdown sesuai waktu Indonesia.
function todayWIB() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date());
}

function daysBetween(fromYmd, toYmd) {
  const [fy, fm, fd] = fromYmd.split('-').map(Number);
  const [ty, tm, td] = toYmd.split('-').map(Number);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86400000);
}

function dbFail(res, error) {
  console.error('DB error:', error.code, error.message); // tanpa isi data user
  if (error.code === '42501') {
    return res.status(500).json({
      error: 'Database permission error (check the GRANT statements at the end of schema_siapdaftar.sql)',
    });
  }
  return res.status(500).json({ error: 'Database error' });
}

// GET /api/matches
router.get('/', async (req, res, next) => {
  try {
    // 1) User harus punya profil dulu (match_scholarships mengembalikan 0 baris kalau tidak ada).
    const prof = await req.supabase
      .from('profiles')
      .select('user_id')
      .eq('user_id', req.user.id)
      .maybeSingle();
    if (prof.error) return dbFail(res, prof.error);
    if (!prof.data) {
      return res.status(409).json({
        error: 'Complete your profile first',
        code: 'PROFILE_REQUIRED',
      });
    }

    // 2) Panggil fungsi SQL. p_user selalu dari token, bukan dari client.
    const rpc = await req.supabase.rpc('match_scholarships', { p_user: req.user.id });
    if (rpc.error) return dbFail(res, rpc.error);
    const rows = rpc.data || [];

    // 3) Ambil detail tambahan beasiswa (RLS: hanya yang is_verified).
    let details = {};
    if (rows.length) {
      const ids = rows.map((r) => r.scholarship_id);
      const det = await req.supabase
        .from('scholarships')
        .select('id, provider, level, required_documents, apply_method, other_requirements, source_url, accessed_on')
        .in('id', ids);
      if (det.error) return dbFail(res, det.error);
      details = Object.fromEntries(det.data.map((d) => [d.id, d]));
    }

    // 4) Susun response + countdown
    const today = todayWIB();
    const matches = rows
      .map((r) => {
        const d = details[r.scholarship_id] || {};
        return {
          scholarship_id: r.scholarship_id,
          name: r.name,
          provider: d.provider || null,
          level: d.level || null,
          label: r.label,
          reasons: r.reasons || [],
          deadline: r.deadline,
          days_left: daysBetween(today, r.deadline),
          required_documents: d.required_documents || [],
          apply_method: d.apply_method || null,
          other_requirements: d.other_requirements || null, // ditampilkan apa adanya, TIDAK dicek otomatis
          source_url: d.source_url || null,
          accessed_on: d.accessed_on || null,
        };
      })
      .filter((m) => m.days_left >= 0) // buang yang sudah lewat menurut WIB
      .sort(
        (a, b) =>
          (LABEL_RANK[a.label] ?? 9) - (LABEL_RANK[b.label] ?? 9) ||
          a.days_left - b.days_left
      );

    const count = (label) => matches.filter((m) => m.label === label).length;
    res.json({
      today_wib: today,
      summary: {
        total: matches.length,
        fully_eligible: count('fully eligible'),
        partially_eligible: count('partially eligible'),
        not_yet_eligible: count('not yet eligible'),
      },
      matches,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;