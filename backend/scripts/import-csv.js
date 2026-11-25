#!/usr/bin/env node
// Converts a scholarships CSV into a SQL file for the Supabase SQL Editor.
// Usage:
//   node scripts\import-csv.js path\to\file.csv [--out path\to\out.sql] [--programs programs.txt] [--verified]
//
// - Arrays (allowed_programs, required_documents) are separated by ";" inside one cell.
// - Rows are inserted as NOT verified unless --verified is given (use it only after a human
//   has checked every row against its official page).
// - Re-running is safe: a row with the same campus_id + name + source_url is skipped.
// - No database connection and no keys are used here. It only writes a SQL file.

const fs = require('fs');
const path = require('path');

const PILOT_CAMPUS_ID = 1; // ITB
const REQUIRED = ['name', 'deadline', 'source_url', 'accessed_on'];
const OPTIONAL = [
  'campus_id', 'provider', 'level', 'allowed_programs', 'semester_min', 'semester_max',
  'min_gpa', 'other_requirements', 'required_documents', 'apply_method',
];
const KNOWN = [...REQUIRED, ...OPTIONAL];

function todayWIB() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date());
}

// Small RFC 4180 parser: quoted cells, "" escapes, commas/newlines inside quotes, CRLF, BOM.
function parseCsv(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field); field = '';
    } else if (ch === '\r') {
      // skip
    } else if (ch === '\n') {
      row.push(field); rows.push(row); row = []; field = '';
    } else {
      field += ch;
    }
  }
  if (inQuotes) throw new Error('CSV has an unclosed double quote');
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

function isValidDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

const esc = (s) => String(s).replace(/'/g, "''");
const sqlText = (s) => (s ? `'${esc(s)}'` : 'null::text');
const sqlInt = (n) => (n === null ? 'null::int' : String(n));
const sqlNum = (n) => (n === null ? 'null::numeric' : String(n));
const sqlArr = (a) =>
  a.length ? `array[${a.map((x) => `'${esc(x)}'`).join(',')}]::text[]` : 'null::text[]';
const splitList = (s) => [...new Set(s.split(';').map((x) => x.trim()).filter(Boolean))];

function fail(errors, warnings) {
  return { sql: null, count: 0, errors, warnings };
}

function buildSql(csvText, opts = {}) {
  const today = opts.today || todayWIB();
  const verified = !!opts.verified;
  const programSet = opts.programs ? new Set(opts.programs) : null;
  const errors = [];
  const warnings = [];

  let rows;
  try {
    rows = parseCsv(csvText);
  } catch (e) {
    return fail([e.message], warnings);
  }
  if (rows.length === 0) return fail(['CSV is empty'], warnings);

  const header = rows[0].map((h) => h.trim().toLowerCase());
  if (header.length === 1 && header[0].includes(';')) {
    return fail(
      ['The header looks semicolon-delimited. Export as CSV with COMMA delimiters (e.g. Google Sheets: File > Download > CSV). Semicolons are only used inside a cell to separate list items.'],
      warnings
    );
  }
  const dupHeader = header.filter((h, i) => header.indexOf(h) !== i);
  if (dupHeader.length) errors.push(`Duplicate column(s): ${[...new Set(dupHeader)].join(', ')}`);
  const missing = REQUIRED.filter((c) => !header.includes(c));
  if (missing.length) errors.push(`Missing required column(s): ${missing.join(', ')}`);
  const unknown = header.filter((h) => !KNOWN.includes(h));
  if (unknown.length) errors.push(`Unknown column(s): ${unknown.join(', ')} (check spelling)`);
  if (errors.length) return fail(errors, warnings);

  const idx = Object.fromEntries(header.map((h, i) => [h, i]));
  const seen = new Set();
  const statements = [];
  let sawPrograms = false;
  let nonItb = 0;
  let past = 0;

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const rowErrors = [];
    const get = (col) => (idx[col] === undefined ? '' : (row[idx[col]] || '').trim());
    const label = `Row ${r + 1}`;

    if (row.length > header.length) {
      rowErrors.push('has more cells than the header (an unquoted comma inside a text cell?)');
    }

    // campus
    const campusRaw = get('campus_id');
    const campus = campusRaw === '' ? PILOT_CAMPUS_ID : /^\d{1,3}$/.test(campusRaw) ? Number(campusRaw) : NaN;
    if (campus !== PILOT_CAMPUS_ID) {
      rowErrors.push('campus_id must be empty or 1 (ITB is the only campus in this pilot)');
    }

    // text columns
    const name = get('name');
    if (!name) rowErrors.push('name is required');
    const limits = { name: 200, provider: 100, level: 20, apply_method: 200, other_requirements: 1000 };
    for (const [col, max] of Object.entries(limits)) {
      if (get(col).length > max) rowErrors.push(`${col} is longer than ${max} characters`);
    }
    const provider = get('provider');
    const level = get('level');
    const applyMethod = get('apply_method');
    const otherReq = get('other_requirements');

    // lists
    const programs = splitList(get('allowed_programs'));
    if (programs.length) sawPrograms = true;
    if (programs.some((p) => p.length > 100)) rowErrors.push('a program name is longer than 100 characters');
    if (programSet) {
      const bad = programs.filter((p) => !programSet.has(p));
      if (bad.length) rowErrors.push(`unknown program name(s): ${bad.join(', ')} (must match the programs list exactly)`);
    }
    const docs = splitList(get('required_documents'));
    if (docs.some((d) => d.length > 100)) rowErrors.push('a required document name is longer than 100 characters');

    // semester range
    const parseSem = (col) => {
      const v = get(col);
      if (v === '') return null;
      const n = /^\d{1,2}$/.test(v) ? Number(v) : NaN;
      if (!Number.isInteger(n) || n < 1 || n > 14) {
        rowErrors.push(`${col} must be a whole number from 1 to 14`);
        return null;
      }
      return n;
    };
    const semMin = parseSem('semester_min');
    const semMax = parseSem('semester_max');
    if (semMin !== null && semMax !== null && semMin > semMax) {
      rowErrors.push('semester_min is greater than semester_max');
    }

    // GPA
    let gpa = null;
    const gpaRaw = get('min_gpa');
    if (gpaRaw !== '') {
      const n = /^\d(\.\d{1,2})?$/.test(gpaRaw) ? Number(gpaRaw) : NaN;
      if (!Number.isFinite(n) || n < 0 || n > 4) {
        rowErrors.push('min_gpa must be between 0 and 4 with a dot as decimal separator (e.g. 3.50)');
      } else {
        gpa = n;
      }
    }

    // deadline
    const deadline = get('deadline');
    if (!isValidDate(deadline)) {
      rowErrors.push('deadline is required and must be a real date in YYYY-MM-DD format');
    } else if (deadline < today) {
      past++;
    }

    // source_url
    const url = get('source_url');
    let host = '';
    try {
      const u = new URL(url);
      host = u.hostname.toLowerCase();
      if (u.protocol !== 'https:') rowErrors.push('source_url must start with https://');
    } catch (_) {
      rowErrors.push('source_url is required and must be a full https:// URL (the word "dummy" is reserved for test rows)');
    }
    if (host && host !== 'itb.ac.id' && !host.endsWith('.itb.ac.id')) nonItb++;

    // accessed_on
    const accessed = get('accessed_on');
    if (!isValidDate(accessed)) {
      rowErrors.push('accessed_on is required and must be a real date in YYYY-MM-DD format');
    } else if (accessed > today) {
      rowErrors.push('accessed_on is in the future');
    }

    // duplicates inside the CSV
    const key = `${campus}|${name}|${url}`;
    if (name && url) {
      if (seen.has(key)) rowErrors.push('duplicate of an earlier row (same name and source_url)');
      seen.add(key);
    }

    if (rowErrors.length) {
      for (const m of rowErrors) errors.push(`${label}${name ? ` (${name.slice(0, 40)})` : ''}: ${m}`);
      continue;
    }

    statements.push(
`insert into scholarships
  (campus_id, name, provider, level, allowed_programs, semester_min, semester_max, min_gpa,
   other_requirements, required_documents, deadline, apply_method, source_url, accessed_on,
   is_verified, verified_at)
select ${campus}, ${sqlText(name)}, ${sqlText(provider)}, ${sqlText(level)}, ${sqlArr(programs)},
  ${sqlInt(semMin)}, ${sqlInt(semMax)}, ${sqlNum(gpa)},
  ${sqlText(otherReq)}, ${sqlArr(docs)}, date '${deadline}', ${sqlText(applyMethod)},
  ${sqlText(url)}, date '${accessed}', ${verified}, ${verified ? 'now()' : 'null::timestamptz'}
where not exists (
  select 1 from scholarships
  where campus_id = ${campus} and name = ${sqlText(name)} and source_url = ${sqlText(url)}
);`
    );
  }

  if (!errors.length && statements.length === 0) errors.push('The CSV has a header but no data rows');

  if (sawPrograms && !programSet) {
    warnings.push('Program names are compared EXACTLY (case-sensitive) with the study program chosen in the profile form. Use --programs programs.txt to validate them.');
  }
  if (nonItb) warnings.push(`${nonItb} row(s) have a source_url that is not on itb.ac.id. The pilot should use official ITB pages only.`);
  if (past) warnings.push(`${past} row(s) have a deadline in the past. They will never be shown to students.`);

  if (errors.length) return fail(errors, warnings);

  const sql = [
    '-- SiapDaftar: scholarship import generated by backend/scripts/import-csv.js',
    `-- Generated: ${new Date().toISOString()} | rows: ${statements.length} | is_verified: ${verified}`,
    '-- Run in the Supabase SQL Editor. Safe to re-run: rows with the same campus, name and source_url are skipped.',
    verified
      ? '-- WARNING: rows are inserted as VERIFIED (visible to students). Check each row against its official page first.'
      : '-- Rows are inserted as NOT verified (hidden from students). Check each one against its official page, then publish (see the bottom).',
    'begin;',
    '',
    statements.join('\n\n'),
    '',
    'commit;',
    '',
    "select id, name, deadline, is_verified, source_url from scholarships where source_url <> 'dummy' order by id;",
    '',
    '-- To publish rows AFTER someone checked them against the official page:',
    '-- update scholarships set is_verified = true, verified_at = now() where id in (/* ids from the list above */);',
    '',
  ].join('\n');

  return { sql, count: statements.length, errors, warnings };
}

function main() {
  const args = process.argv.slice(2);
  const flags = { verified: false, out: null, programs: null };
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--verified') flags.verified = true;
    else if (args[i] === '--out') flags.out = args[++i];
    else if (args[i] === '--programs') flags.programs = args[++i];
    else positional.push(args[i]);
  }

  if (!positional[0]) {
    console.error('Usage: node scripts\\import-csv.js file.csv [--out out.sql] [--programs programs.txt] [--verified]');
    process.exit(1);
  }

  let csvText;
  try {
    csvText = fs.readFileSync(positional[0], 'utf8');
  } catch (e) {
    console.error(`Cannot read ${positional[0]}: ${e.message}`);
    process.exit(1);
  }

  let programs = null;
  if (flags.programs) {
    try {
      programs = fs.readFileSync(flags.programs, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    } catch (e) {
      console.error(`Cannot read ${flags.programs}: ${e.message}`);
      process.exit(1);
    }
  }

  const result = buildSql(csvText, { verified: flags.verified, programs });
  result.warnings.forEach((w) => console.log('WARN  ' + w));
  if (result.errors.length) {
    result.errors.forEach((e) => console.error('ERROR ' + e));
    console.error(`\n${result.errors.length} problem(s) found. No SQL file was written.`);
    process.exit(1);
  }

  const out = flags.out || path.join(__dirname, '..', '..', 'database', 'import_scholarships.sql');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, result.sql, 'utf8');
  console.log(`\nWrote ${out} (${result.count} row(s), is_verified=${flags.verified}).`);
  console.log('Next: open the file, paste it into the Supabase SQL Editor and Run.');
}

if (require.main === module) main();

module.exports = { parseCsv, buildSql };