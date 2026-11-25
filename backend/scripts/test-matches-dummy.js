require('dotenv').config();

const BASE = `http://localhost:${process.env.PORT || 3000}`;
const { TEST_EMAIL, TEST_PASSWORD } = process.env;

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

function countLabels(list) {
  const c = { fully: 0, partially: 0, not_yet: 0 };
  for (const m of list) {
    if (m.label === 'fully eligible') c.fully++;
    else if (m.label === 'partially eligible') c.partially++;
    else if (m.label === 'not yet eligible') c.not_yet++;
  }
  return c;
}

async function scenario(token, title, gpa, expected) {
  console.log('\n--- ' + title + ' ---');
  const body = { campus_id: 1, program: 'Informatics', semester: 3, interests: ['AI'] };
  if (gpa !== null) body.gpa = gpa;

  let r = await call('PUT', '/api/profile', body, token);
  check('profile saved', r.status === 200, `(got ${r.status})`);

  r = await call('GET', '/api/matches', null, token);
  if (r.status !== 200) {
    check('GET /api/matches -> 200', false, `(got ${r.status})`);
    return;
  }

  const dummy = r.json.matches.filter((m) => m.name.startsWith('[DUMMY]'));
  for (const m of dummy) {
    console.log(`      ${m.label.padEnd(19)} | ${m.name} | ${m.days_left}d left | ${m.reasons.join('; ') || '-'}`);
  }

  if (dummy.length === 0) {
    check('dummy rows visible', false, '(none found: run database/seed_dummy.sql first)');
    return;
  }

  const c = countLabels(dummy);
  check(
    `labels fully/partially/not yet = ${expected.fully}/${expected.partially}/${expected.not_yet}`,
    c.fully === expected.fully && c.partially === expected.partially && c.not_yet === expected.not_yet,
    `(got ${c.fully}/${c.partially}/${c.not_yet})`
  );
  check('expired dummy (F) is NOT listed', !dummy.some((m) => m.name.includes('Expired')));
  check('unverified dummy (G) is NOT listed (RLS)', !dummy.some((m) => m.name.includes('Unverified')));
  check('items sorted: fully, then partially, then not yet', (() => {
    const rank = { 'fully eligible': 0, 'partially eligible': 1, 'not yet eligible': 2 };
    for (let i = 1; i < r.json.matches.length; i++) {
      if (rank[r.json.matches[i - 1].label] > rank[r.json.matches[i].label]) return false;
    }
    return true;
  })());
}

(async () => {
  const login = await call('POST', '/api/auth/login', { email: TEST_EMAIL, password: TEST_PASSWORD });
  const token = login.json.session && login.json.session.access_token;
  if (!token) {
    console.error('Login failed. Run scripts\\test-auth.js first.');
    process.exit(1);
  }

  await scenario(token, 'GPA 3.5 (Informatics, semester 3)', 3.5, { fully: 3, partially: 0, not_yet: 2 });
  await scenario(token, 'GPA 2.5 (Informatics, semester 3)', 2.5, { fully: 1, partially: 0, not_yet: 4 });
  await scenario(token, 'GPA not provided (Informatics, semester 3)', null, { fully: 1, partially: 2, not_yet: 2 });

  console.log(failed === 0 ? '\nAll checks passed.' : `\n${failed} check(s) FAILED.`);
})();