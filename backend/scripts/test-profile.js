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
    console.error('Login failed. Run scripts\\test-auth.js first to create the test user.');
    process.exit(1);
  }

  let r = await call('GET', '/api/profile');
  check('1. GET without token -> 401', r.status === 401, `(got ${r.status})`);

  r = await call('GET', '/api/profile', null, token);
  check('2. GET with token -> 200', r.status === 200, `(got ${r.status})`);

  const valid = { campus_id: 1, program: 'Informatics', semester: 3, interests: ['AI', 'Data Science'] };

  r = await call('PUT', '/api/profile', { ...valid, semester: 0 }, token);
  check('3. PUT semester 0 -> 400', r.status === 400, `(got ${r.status})`);

  r = await call('PUT', '/api/profile', { ...valid, gpa: 4.5 }, token);
  check('4. PUT gpa 4.5 -> 400', r.status === 400, `(got ${r.status})`);

  r = await call('PUT', '/api/profile', { ...valid, campus_id: 2 }, token);
  check('5. PUT campus_id 2 -> 400', r.status === 400, `(got ${r.status})`);

  r = await call('PUT', '/api/profile', valid, token);
  check(
    '6. PUT valid WITHOUT gpa -> 200, gpa null, campus 1',
    r.status === 200 && r.json.profile && r.json.profile.gpa === null && r.json.profile.campus_id === 1,
    `(got ${r.status}${r.json.error ? ', ' + r.json.error : ''})`
  );

  r = await call('PUT', '/api/profile', { ...valid, gpa: 3.5 }, token);
  check(
    '7. PUT valid WITH gpa 3.5 -> 200',
    r.status === 200 && r.json.profile && Number(r.json.profile.gpa) === 3.5,
    `(got ${r.status})`
  );

  r = await call('GET', '/api/profile', null, token);
  check(
    '8. GET returns saved profile',
    r.status === 200 && r.json.profile && r.json.profile.program === 'Informatics' &&
      r.json.profile.semester === 3 && r.json.profile.interests.length === 2,
    `(got ${r.status})`
  );

  if (TEST_EMAIL2 && TEST_PASSWORD2) {
    await call('POST', '/api/auth/signup', { email: TEST_EMAIL2, password: TEST_PASSWORD2 });
    const token2 = await loginToken(TEST_EMAIL2, TEST_PASSWORD2);
    if (!token2) {
      check('9. RLS check (second user)', false, '(second user login failed)');
    } else {
      r = await call('GET', '/api/profile', null, token2);
      check(
        '9. RLS: second user does NOT see first user\'s profile',
        r.status === 200 && r.json.profile === null,
        `(got ${r.status})`
      );
    }
  } else {
    console.log('SKIP  9. RLS check (set TEST_EMAIL2 / TEST_PASSWORD2 to enable)');
  }

  r = await call('PUT', '/api/profile', { ...valid, gpa: null }, token);
  check(
    '10. PUT with gpa null clears GPA -> 200, gpa null',
    r.status === 200 && r.json.profile && r.json.profile.gpa === null,
    `(got ${r.status})`
  );

  console.log(failed === 0 ? '\nAll checks passed.' : `\n${failed} check(s) FAILED.`);
})();