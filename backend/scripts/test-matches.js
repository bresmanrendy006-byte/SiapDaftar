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

const LABELS = ['fully eligible', 'partially eligible', 'not yet eligible'];

(async () => {
  const token = await loginToken(TEST_EMAIL, TEST_PASSWORD);
  if (!token) {
    console.error('Login failed. Run scripts\\test-auth.js first.');
    process.exit(1);
  }

  let r = await call('GET', '/api/matches');
  check('1. GET /api/matches without token -> 401', r.status === 401, `(got ${r.status})`);

  if (TEST_EMAIL2 && TEST_PASSWORD2) {
    const token2 = await loginToken(TEST_EMAIL2, TEST_PASSWORD2);
    if (token2) {
      const p2 = await call('GET', '/api/profile', null, token2);
      if (p2.json.profile === null) {
        r = await call('GET', '/api/matches', null, token2);
        check(
          '2. user WITHOUT profile -> 409 PROFILE_REQUIRED',
          r.status === 409 && r.json.code === 'PROFILE_REQUIRED',
          `(got ${r.status})`
        );
      } else {
        console.log('SKIP  2. second user already has a profile');
      }
    }
  } else {
    console.log('SKIP  2. set TEST_EMAIL2 / TEST_PASSWORD2 to enable');
  }

  // Profil tanpa IPK
  r = await call(
    'PUT',
    '/api/profile',
    { campus_id: 1, program: 'Informatics', semester: 3, interests: ['AI'] },
    token
  );
  check('3. prepare profile (no GPA) -> 200', r.status === 200, `(got ${r.status})`);

  r = await call('GET', '/api/matches', null, token);
  const ok200 = r.status === 200 && Array.isArray(r.json.matches) && r.json.summary;
  check('4. GET /api/matches with profile -> 200 + matches + summary', ok200, `(got ${r.status})`);

  if (ok200) {
    const m = r.json.matches;
    console.log(`INFO  ${m.length} match(es): ${JSON.stringify(r.json.summary)}`);
    if (m.length === 0) {
      console.log('INFO  no scholarships visible yet (table empty or none verified). Seed dummy data, then re-run.');
    }
    check('5. every label is one of the 3 exact labels', m.every((x) => LABELS.includes(x.label)));
    check('6. every item has reasons[] and numeric days_left >= 0',
      m.every((x) => Array.isArray(x.reasons) && Number.isInteger(x.days_left) && x.days_left >= 0));
    check('7. response never contains a "gpa" field', !JSON.stringify(r.json).includes('"gpa"'));
    check('8. every item has a source_url',
      m.every((x) => typeof x.source_url === 'string' && x.source_url.length > 0));
  }

  console.log(failed === 0 ? '\nAll checks passed.' : `\n${failed} check(s) FAILED.`);
})();