require('dotenv').config();

const BASE = `http://localhost:${process.env.PORT || 3000}`;
const email = process.env.TEST_EMAIL;
const password = process.env.TEST_PASSWORD;

if (!email || !password) {
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

(async () => {
  let r = await call('GET', '/api/auth/me');
  console.log('1. /me without token      ->', r.status, '(expect 401)');

  r = await call('GET', '/api/auth/me', null, 'not-a-real-token');
  console.log('2. /me with bad token     ->', r.status, '(expect 401)');

  r = await call('POST', '/api/auth/signup', { email, password: 'short' });
  console.log('3. signup, short password ->', r.status, '(expect 400)');

  r = await call('POST', '/api/auth/signup', { email, password });
  console.log(
    '4. signup                 ->', r.status,
    '| requires_email_confirmation =', r.json.requires_email_confirmation,
    '| has_session =', !!r.json.session,
    r.json.error ? '| error: ' + r.json.error : ''
  );

  r = await call('POST', '/api/auth/login', { email, password: password + 'x' });
  console.log('5. login, wrong password  ->', r.status, '(expect 401)');

  r = await call('POST', '/api/auth/login', { email, password });
  const token = r.json.session && r.json.session.access_token;
  console.log(
    '6. login                  ->', r.status,
    '| has_access_token =', !!token,
    r.json.error ? '| error: ' + r.json.error : ''
  );

  if (token) {
    r = await call('GET', '/api/auth/me', null, token);
    console.log('7. /me with real token    ->', r.status, '| has_user_id =', !!(r.json.user && r.json.user.id), '(expect 200, true)');
  } else {
    console.log('7. /me with real token    -> skipped (no token from login)');
  }
})();