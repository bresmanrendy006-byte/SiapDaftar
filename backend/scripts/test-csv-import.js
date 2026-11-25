const { buildSql } = require('./import-csv');

const COLS = [
  'campus_id', 'name', 'provider', 'level', 'allowed_programs', 'semester_min', 'semester_max',
  'min_gpa', 'other_requirements', 'required_documents', 'deadline', 'apply_method',
  'source_url', 'accessed_on',
];
const BASE = {
  campus_id: '1', name: 'Test A', provider: 'Org', level: 'S1', allowed_programs: '',
  semester_min: '', semester_max: '', min_gpa: '', other_requirements: '',
  required_documents: 'Transcript', deadline: '2026-12-15', apply_method: 'Online',
  source_url: 'https://www.itb.ac.id/a', accessed_on: '2026-11-20',
};

const cell = (v) => (/[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v);
const csv = (rows, cols = COLS) =>
  [cols.join(','), ...rows.map((r) => cols.map((c) => cell(r[c] ?? '')).join(','))].join('\n');
const row = (o = {}) => ({ ...BASE, ...o });
const build = (rows, opts = {}) => buildSql(csv(rows), { today: '2026-11-25', ...opts });

let failed = 0;
function check(label, ok) {
  if (!ok) failed++;
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + label);
}
const hasErr = (r, text) => r.errors.some((e) => e.toLowerCase().includes(text.toLowerCase()));

// 1. valid row
let r = build([row()]);
check('1. valid row: no errors, 1 statement, wrapped in begin/commit',
  r.errors.length === 0 && r.count === 1 && r.sql.includes('begin;') && r.sql.includes('commit;'));
check('2. default is_verified = false (hidden from students)', r.sql.includes('false, null::timestamptz'));
check('3. empty allowed_programs becomes null::text[] (all programs)', r.sql.includes('null::text[]'));

r = build([row()], { verified: true });
check('4. --verified option sets is_verified true + now()', r.sql.includes('true, now()'));

// 2. tricky text
r = build([row({
  name: 'Bob\'s "Test" Fund, Pilot',
  allowed_programs: 'Informatics; Electrical Engineering',
  other_requirements: 'Needs, a letter',
  min_gpa: '3.50',
})]);
check('5. quotes, apostrophes and commas are handled', r.errors.length === 0 &&
  r.sql.includes(`'Bob''s "Test" Fund, Pilot'`) && r.sql.includes(`'Needs, a letter'`));
check('6. list cells split on ";" into a text array',
  r.sql.includes(`array['Informatics','Electrical Engineering']::text[]`));
check('7. dates and GPA are emitted correctly', r.sql.includes(`date '2026-12-15'`) && r.sql.includes('3.5'));

// 3. SQL injection attempt stays inside a string literal
r = build([row({ name: `x'); drop table scholarships; --` })]);
check('8. SQL injection text is escaped as plain data',
  r.errors.length === 0 && r.sql.includes(`'x''); drop table scholarships; --'`) &&
  (r.sql.match(/insert into scholarships/g) || []).length === 1);

// 4. header problems
r = buildSql(csv([row()], COLS.filter((c) => c !== 'deadline')), { today: '2026-11-25' });
check('9. missing required column -> error, no SQL', hasErr(r, 'deadline') && r.sql === null);
r = buildSql('name;deadline;source_url;accessed_on\nA;2026-12-15;https://www.itb.ac.id/a;2026-11-20', { today: '2026-11-25' });
check('10. semicolon-delimited file is detected with a helpful message', hasErr(r, 'semicolon'));
r = buildSql(csv([row()]).replace('provider', 'provder'), { today: '2026-11-25' });
check('11. misspelled column name is reported', hasErr(r, 'unknown column'));

// 5. value problems
r = build([row({ deadline: '15/12/2026' })]);
check('12. non-ISO date -> error', hasErr(r, 'deadline') && r.sql === null);
r = build([row({ deadline: '2026-02-30' })]);
check('13. impossible date -> error', hasErr(r, 'deadline'));
r = build([row({ min_gpa: '4.5' })]);
check('14. GPA above 4 -> error', hasErr(r, 'min_gpa'));
r = build([row({ min_gpa: '3,5' })]);
check('15. GPA with comma decimal -> error', hasErr(r, 'min_gpa'));
r = build([row({ semester_min: '7', semester_max: '3' })]);
check('16. semester_min > semester_max -> error', hasErr(r, 'semester_min'));
r = build([row({ campus_id: '2' })]);
check('17. campus other than 1 -> error', hasErr(r, 'campus_id'));
r = build([row({ source_url: 'dummy' })]);
check('18. source_url "dummy" -> error', hasErr(r, 'source_url'));
r = build([row({ source_url: 'http://www.itb.ac.id/a' })]);
check('19. non-https source_url -> error', hasErr(r, 'https'));
r = build([row({ accessed_on: '2026-12-31' })]);
check('20. accessed_on in the future -> error', hasErr(r, 'accessed_on'));
r = build([row(), row()]);
check('21. duplicate rows -> error', hasErr(r, 'duplicate'));
r = buildSql(csv([row()]) + ',extra', { today: '2026-11-25' });
check('22. row with too many cells -> error', hasErr(r, 'more cells'));
check('23. empty file -> error', buildSql('', {}).errors.length === 1);

// 6. programs list
r = build([row({ allowed_programs: 'Informatika' })], { programs: ['Informatics'] });
check('24. unknown program name vs --programs list -> error', hasErr(r, 'unknown program'));
r = build([row({ allowed_programs: 'Informatics' })], { programs: ['Informatics'] });
check('25. known program name passes', r.errors.length === 0);

// 7. formats and warnings
r = buildSql('\uFEFF' + csv([row()]).replace(/\n/g, '\r\n'), { today: '2026-11-25' });
check('26. UTF-8 BOM and CRLF line endings are accepted', r.errors.length === 0 && r.count === 1);
r = build([row({ deadline: '2026-11-01' })]);
check('27. past deadline is a warning, not an error', r.errors.length === 0 && r.warnings.some((w) => w.includes('past')));
r = build([row({ source_url: 'https://example.org/a' })]);
check('28. non-itb.ac.id host is a warning, not an error', r.errors.length === 0 && r.warnings.some((w) => w.includes('itb.ac.id')));

console.log(failed === 0 ? '\nAll checks passed.' : `\n${failed} check(s) FAILED.`);
process.exit(failed === 0 ? 0 : 1);