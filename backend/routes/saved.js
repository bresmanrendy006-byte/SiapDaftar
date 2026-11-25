const express = require('express');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

const LABEL_RANK = { 'fully eligible': 0, 'partially eligible': 1, 'not yet eligible': 2 };

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

// Terima angka bulat positif (number atau string angka). Selain itu -> null.
function parseId(v) {
  if (typeof v === 'number' && Number.isSafeInteger(v) && v > 0) return v;
  if (typeof v === 'string' && /^\d{1,15}$/.test(v) && Number(v) > 0) return Number(v);
  return null;
}

// GET /api/saved
router.get('/', async (req, res, next) => {
  try {
    const saved = await req.supabase
      .from('saved_scholarships')
      .select(
        'scholarship_id, status, saved_at, scholarships(id, name, provider, level, deadline, required_documents, apply_method, other_requirements, source_url, accessed_on)'
      )
      .eq('user_id', req.user.id);
    if (saved.error) return dbFail(res, saved.error);

    // Label kecocokan (hanya ada untuk beasiswa yang belum lewat deadline)
    const rpc = await req.supabase.rpc('match_scholarships', { p_user: req.user.id });
    if (rpc.error) return dbFail(res, rpc.error);
    const labels = Object.fromEntries((rpc.data || []).map((r) => [r.scholarship_id, r]));

    const today = todayWIB();
    const items = (saved.data || [])
      .filter((row) => row.scholarships) // beasiswa yang tidak lagi terverifikasi disembunyikan oleh RLS
      .map((row) => {
        const s = row.scholarships;
        const m = labels[row.scholarship_id];
        const daysLeft = daysBetween(today, s.deadline);
        return {
          scholarship_id: row.scholarship_id,
          name: s.name,
          provider: s.provider || null,
          level: s.level || null,
          label: m ? m.label : null, // null kalau sudah expired
          reasons: m ? m.reasons || [] : [],
          deadline: s.deadline,
          days_left: daysLeft,
          expired: daysLeft < 0,
          required_documents: s.required_documents || [],
          apply_method: s.apply_method || null,
          other_requirements: s.other_requirements || null, // ditampilkan apa adanya, TIDAK dicek otomatis
          source_url: s.source_url || null,
          accessed_on: s.accessed_on || null,
          status: row.status,
          saved_at: row.saved_at,
        };
      })
      .sort((a, b) => {
        if (a.expired !== b.expired) return a.expired ? 1 : -1; // yang expired di bawah
        return (
          (LABEL_RANK[a.label] ?? 9) - (LABEL_RANK[b.label] ?? 9) || a.days_left - b.days_left
        );
      });

    res.json({
      today_wib: today,
      summary: { total: items.length, expired: items.filter((i) => i.expired).length },
      saved: items,
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/saved  { scholarship_id }
router.post('/', async (req, res, next) => {
  try {
    const id = parseId((req.body || {}).scholarship_id);
    if (id === null) {
      return res.status(400).json({ error: 'scholarship_id must be a positive whole number' });
    }

    // saved_scholarships.user_id mereferensi profiles, jadi profil harus ada dulu.
    const prof = await req.supabase
      .from('profiles')
      .select('user_id')
      .eq('user_id', req.user.id)
      .maybeSingle();
    if (prof.error) return dbFail(res, prof.error);
    if (!prof.data) {
      return res.status(409).json({ error: 'Complete your profile first', code: 'PROFILE_REQUIRED' });
    }

    // Beasiswa harus ada dan terlihat oleh user (RLS: hanya yang is_verified).
    const sch = await req.supabase.from('scholarships').select('id').eq('id', id).maybeSingle();
    if (sch.error) return dbFail(res, sch.error);
    if (!sch.data) return res.status(404).json({ error: 'Scholarship not found' });

    // Idempotent: menyimpan dua kali tidak error.
    const ins = await req.supabase
      .from('saved_scholarships')
      .upsert(
        { user_id: req.user.id, scholarship_id: id },
        { onConflict: 'user_id,scholarship_id', ignoreDuplicates: true }
      );
    if (ins.error) return dbFail(res, ins.error);

    res.json({ saved: true, scholarship_id: id });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/saved/:scholarship_id
router.delete('/:scholarship_id', async (req, res, next) => {
  try {
    const id = parseId(req.params.scholarship_id);
    if (id === null) {
      return res.status(400).json({ error: 'scholarship_id must be a positive whole number' });
    }

    const del = await req.supabase
      .from('saved_scholarships')
      .delete()
      .eq('user_id', req.user.id)
      .eq('scholarship_id', id);
    if (del.error) return dbFail(res, del.error);

    res.json({ saved: false, scholarship_id: id });
  } catch (err) {
    next(err);
  }
});

module.exports = router;