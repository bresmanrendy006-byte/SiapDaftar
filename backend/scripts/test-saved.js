require('dotenv').config();

const BASE = `http://localhost:${process.env.PORT || 3000}`;
const { TEST_EMAIL, TEST_PASSWORD, TEST_EMAIL2, TEST_PASSWORD2 } = process.env;

if (!TEST_EMAIL || !TEST_PASSWORD) {
  console.error('Set TEST_EMAIL and TEST_PASSWORD in this CMD session first.');
  process.exit(1);
}

async function call(method, path, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = {};
  try { json = await res.json(); } catch (_) {}
  return { status: res.status, json };
}

let failed = 0;
function check(label, ok, extra) {
  if (!ok) failed++;
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + label + (extra ? '  ' + extra : ''));
}

async function loginToken(email, password) {
  const r = await call('POST', '/api/auth/login', { email, password });
  return r.json.session && r.json.session.access_token;
}

(async () => {
  const token = await loginToken(TEST_EMAIL, TEST_PASSWORD);
  if (!token) {
    console.error('Login failed. Run scripts\\test-auth.js first.');
    process.exit(1);
  }

  let r = await call('GET', '/api/saved');
  check('1. GET /api/saved without token -> 401', r.status === 401, `(got ${r.status})`);

  // Profil deterministik: Informatics, semester 3, IPK 3.5
  r = await call(
    'PUT',
    '/api/profile',
    { campus_id: 1, program: 'Informatics', semester: 3, gpa: 3.5, interests: ['AI'] },
    token
  );
  check('2. prepare profile -> 200', r.status === 200, `(got ${r.status})`);

  // Ambil id beasiswa dummy dari /api/matches
  r = await call('GET', '/api/matches', null, token);
  const list = (r.json.matches || []).filter((m) => m.name.startsWith('[DUMMY]'));
  const A = list.find((m) => m.name.includes('Open Scholarship A'));
  const C = list.find((m) => m.name.includes('Informatics Excellence C'));
  if (!A || !C) {
    console.error('Dummy scholarships not found. Run database/seed_dummy.sql first.');
    process.exit(1);
  }

  // Bersihkan sisa data dari run sebelumnya
  await call('DELETE', `/api/saved/${A.scholarship_id}`, null, token);
  await call('DELETE', `/api/saved/${C.scholarship_id}`, null, token);

  r = await call('GET', '/api/saved', null, token);
  check('3. saved list starts empty', r.status === 200 && Array.isArray(r.json.saved) && r.json.saved.length === 0, `(got ${r.status})`);

  r = await call('POST', '/api/saved', { scholarship_id: A.scholarship_id }, token);
  check('4. save A -> 200 saved:true', r.status === 200 && r.json.saved === true, `(got ${r.status})`);

  r = await call('POST', '/api/saved', { scholarship_id: A.scholarship_id }, token);
  check('5. save A again -> 200 (idempotent)', r.status === 200 && r.json.saved === true, `(got ${r.status})`);

  r = await call('POST', '/api/saved', { scholarship_id: String(C.scholarship_id) }, token);
  check('6. save C (id as string) -> 200', r.status === 200, `(got ${r.status})`);

  r = await call('GET', '/api/saved', null, token);
  const items = r.json.saved || [];
  check('7. list has exactly A and C', r.status === 200 && items.length === 2 &&
    items.some((i) => i.scholarship_id === A.scholarship_id) &&
    items.some((i) => i.scholarship_id === C.scholarship_id), `(got ${items.length} items)`);
  check('8. items have label, numeric days_left, expired=false, source_url',
    items.every((i) => i.label === 'fully eligible' && Number.isInteger(i.days_left) &&
      i.expired === false && typeof i.source_url === 'string' && i.source_url.length > 0));
  check('9. list sorted by days_left (C before A)', items.length === 2 && items[0].days_left <= items[1].days_left);
  check('10. response never contains a "gpa" field', !JSON.stringify(r.json).includes('"gpa"'));

  r = await call('POST', '/api/saved', { scholarship_id: 'abc' }, token);
  check('11. save invalid id "abc" -> 400', r.status === 400, `(got ${r.status})`);

  r = await call('POST', '/api/saved', {}, token);
  check('12. save without scholarship_id -> 400', r.status === 400, `(got ${r.status})`);

  r = await call('POST', '/api/saved', { scholarship_id: 999999999 }, token);
  check('13. save non-existent scholarship -> 404', r.status === 404, `(got ${r.status})`);

  r = await call('DELETE', '/api/saved/abc', null, token);
  check('14. unsave invalid id -> 400', r.status === 400, `(got ${r.status})`);

  // RLS dengan user kedua
  if (TEST_EMAIL2 && TEST_PASSWORD2) {
    const token2 = await loginToken(TEST_EMAIL2, TEST_PASSWORD2);
    if (token2) {
      r = await call('GET', '/api/saved', null, token2);
      check('15. RLS: second user sees an empty saved list', r.status === 200 && r.json.saved.length === 0, `(got ${r.status})`);

      const p2 = await call('GET', '/api/profile', null, token2);
      if (p2.json.profile === null) {
        r = await call('POST', '/api/saved', { scholarship_id: A.scholarship_id }, token2);
        check('16. user without profile cannot save -> 409', r.status === 409 && r.json.code === 'PROFILE_REQUIRED', `(got ${r.status})`);
      } else {
        console.log('SKIP  16. second user already has a profile');
      }

      await call('DELETE', `/api/saved/${C.scholarship_id}`, null, token2);
      r = await call('GET', '/api/saved', null, token);
      check('17. RLS: second user\'s DELETE does not remove first user\'s save',
        r.status === 200 && r.json.saved.some((i) => i.scholarship_id === C.scholarship_id));
    }
  } else {
    console.log('SKIP  15-17. set TEST_EMAIL2 / TEST_PASSWORD2 to enable RLS checks');
  }

  r = await call('DELETE', `/api/saved/${A.scholarship_id}`, null, token);
  check('18. unsave A -> 200 saved:false', r.status === 200 && r.json.saved === false, `(got ${r.status})`);

  r = await call('GET', '/api/saved', null, token);
  check('19. list now has only C', r.status === 200 && r.json.saved.length === 1 &&
    r.json.saved[0].scholarship_id === C.scholarship_id, `(got ${(r.json.saved || []).length} items)`);

  // Bersih-bersih
  await call('DELETE', `/api/saved/${C.scholarship_id}`, null, token);
  r = await call('GET', '/api/saved', null, token);
  check('20. cleanup: list empty again', r.status === 200 && r.json.saved.length === 0);

  console.log(failed === 0 ? '\nAll checks passed.' : `\n${failed} check(s) FAILED.`);
})();