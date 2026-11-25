# SiapDaftar: Backend

SiapDaftar is a prototype for **eligibility-based scholarship matching and application readiness** for first- and second-year university students. Many students cannot tell which scholarships they qualify for and miss deadlines because the information is scattered.

This folder contains the backend (REST API). It was built for the STACK 2026 hackathon (semifinal).

**Pilot scope:** scholarships of **one campus (ITB) only**.

## 1. What works and what does not

| Feature | Status |
|---|---|
| Sign up / log in with email + password (Supabase Auth) | Working, tested |
| Profile (campus, study program, semester, optional GPA, interests): create/update/read | Working, tested |
| Matching with the labels "fully eligible", "partially eligible", "not yet eligible", reasons and days left | Working, tested with dummy data |
| Save / unsave a scholarship and list saved scholarships | Working, tested |
| Dummy data seed and one-command removal | Working |
| CSV-to-SQL importer for real scholarship data | Working (generation tested offline); not yet verified on real data |
| Real ITB scholarship data | none yet |
| Deployment | vercel |
| Deadline reminders, application checklist, document upload, more campuses, password reset | **Planned, not built** (section 11) |

"Working, tested" means the scripts in section 7 passed against our development Supabase project on 25 Nov 2026.

## 2. Tech stack

- Node.js (developed and tested on v26; the scripts use built-in `fetch`, so a recent Node.js is required) and Express
- Supabase: PostgreSQL, Auth and Row Level Security (RLS)
- Packages: `express`, `@supabase/supabase-js`, `dotenv`, `cors`

## 3. Architecture and security design

```
Frontend  ->  Express API (this folder)  ->  Supabase (Auth + Postgres with RLS)
```

- The API only uses the Supabase **publishable (anon) key**. The secret / service_role key is never used. At startup the server refuses to run if `SUPABASE_ANON_KEY` looks like a secret or `service_role` key.
- For every authenticated request the middleware reads `Authorization: Bearer <token>`, validates it with Supabase Auth and creates a **per-request Supabase client that forwards the user's token**. Because of this, `auth.uid()` and the RLS policies apply to every query.
- **GPA privacy:** the GPA is optional. RLS only lets a user read their own profile row, and the matching and saved responses never include the GPA. The GPA is only used inside the SQL function `match_scholarships` to evaluate the minimum-GPA rule.
- Students can only read scholarships with `is_verified = true`. Writing to `scholarships` is not possible with the publishable key, so data is loaded with SQL files in the Supabase SQL Editor.
- Errors are logged without user data (no profile content, GPA, tokens or passwords).

## 4. Project layout

```
backend/
  index.js                   Express app, route mounting, env checks, static frontend
  lib/supabase.js            anon client and per-request user client
  middleware/auth.js         bearer token validation (requireAuth)
  routes/                    auth.js, profile.js, matches.js, saved.js
  scripts/                   test scripts, import-csv.js, fixtures/
  test-connection.js         quick check of the Supabase connection
  .env.example               template of environment variables
  API.md                     API reference
database/
  schema_siapdaftar.sql      tables, RLS policies, grants, match_scholarships()
  seed_dummy.sql             7 clearly labeled DUMMY scholarships for testing
  delete_dummy.sql           removes all dummy scholarships
  scholarships_template.csv  header of the import CSV
```

## 5. Setup (Windows CMD)

1. Create a Supabase project, open the **SQL Editor** and run `database/schema_siapdaftar.sql`. The script enables RLS, creates the policies, the `match_scholarships` function and the table grants. Then make sure the campus row exists:
   ```sql
   insert into campuses (name) values ('ITB') on conflict (name) do nothing;
   ```
   The pilot expects ITB to have `id = 1`.
2. Development only: in Supabase go to Authentication > Sign In / Providers > Email and turn **Confirm email** off. The default Supabase email sender is rate limited, so confirmation emails are unreliable. For production, turn it on again with a custom SMTP provider.
3. Install and configure the backend:
   ```cmd
   cd backend
   npm install
   copy .env.example .env
   ```
   Open `.env` and fill in the values (section 6). Never commit `.env`.
4. Start the server and check it:
   ```cmd
   npm start
   curl http://localhost:3000/health
   ```
   Expected: `{"status":"ok","service":"siapdaftar-backend",...}`. For auto-restart while coding use `npm run dev`.
5. Optional: load the dummy data by running `database/seed_dummy.sql` in the SQL Editor.

**Serving the frontend:** the server serves `frontend/dist` when a build exists (for example from `npm run build` in `frontend/`). If `frontend/` is plain static files without a `package.json`, it serves that folder. If `frontend/` is a build project without a build, it serves nothing and prints a hint; use the frontend dev server instead.

## 6. Environment variables (`backend/.env`)

| Variable | Required | Description |
|---|---|---|
| `SUPABASE_URL` | yes | Project URL, for example `https://<project-ref>.supabase.co` |
| `SUPABASE_ANON_KEY` | yes | The **publishable** key only (starts with `sb_publishable_`). Never use the secret key. |
| `PORT` | no | Server port, default `3000` |

## 7. Running the tests

The tests are integration scripts that call the running API and a real (development) Supabase project. Start the server first (`npm start`) and use dedicated **synthetic** test accounts. Some scripts overwrite the profile of the test user, so never use a real account.

```cmd
cd backend
set "TEST_EMAIL=<synthetic test email>"
set "TEST_PASSWORD=<test password>"
set "TEST_EMAIL2=<second synthetic test email>"
set "TEST_PASSWORD2=<second test password>"
node scripts\test-auth.js
node scripts\test-profile.js
node scripts\test-matches.js
node scripts\test-matches-dummy.js
node scripts\test-saved.js
node scripts\test-csv-import.js
```

Run `test-auth.js` first, because it creates the test user. The second account is optional but needed for the RLS checks; it should not have a profile if you want the "user without profile" checks to run.

| Script | What it checks | Needs |
|---|---|---|
| `test-auth.js` | token required, bad token rejected, signup/login validation, `/me` | running server |
| `test-profile.js` | validation, optional GPA, upsert/read, **RLS between two users** | server |
| `test-matches.js` | 401/409 handling, response shape, exact labels, no `gpa` field | server |
| `test-matches-dummy.js` | expected label counts for GPA 3.5, 2.5 and no GPA; expired and unverified rows hidden; sort order | server + `seed_dummy.sql` |
| `test-saved.js` | save, idempotent save, unsave, list, invalid ids, **RLS between two users** | server + `seed_dummy.sql` |
| `test-csv-import.js` | 28 checks of the CSV importer (validation, escaping, warnings) | nothing (offline) |

These scripts print PASS/FAIL lines and never print tokens or passwords.

## 8. API overview

All bodies are JSON. Authenticated routes need `Authorization: Bearer <access_token>`. Errors look like `{ "error": "..." }`. Full details are in [API.md](./API.md).

| Method and path | Purpose |
|---|---|
| `GET /health` | liveness check |
| `POST /api/auth/signup` | create an account (password min 8 characters) |
| `POST /api/auth/login` | log in, returns the session tokens |
| `GET /api/auth/me` | current user, validates the token |
| `GET /api/profile` | own profile or `{ "profile": null }` |
| `PUT /api/profile` | create or replace own profile (GPA optional) |
| `GET /api/matches` | matched scholarships with label, reasons, `days_left` (409 if there is no profile yet) |
| `GET /api/saved` | saved scholarships (expired ones are flagged, not hidden) |
| `POST /api/saved` | save a scholarship `{ "scholarship_id": 1 }` |
| `DELETE /api/saved/:scholarship_id` | unsave |

## 9. How matching works

Matching is **rule-based (no AI)** and runs in the SQL function `match_scholarships(p_user)`. The function runs with the caller's permissions (`security invoker`), so RLS still applies.

- Only scholarships that are verified, not past their deadline and that belong to the user's campus are considered.
- The rules checked are: **study program** (exact text match), **semester range** and **minimum GPA**.
- Labels:
  - `fully eligible`: every checked rule is satisfied.
  - `partially eligible`: nothing failed, but the GPA is missing, so the minimum-GPA rule cannot be checked yet.
  - `not yet eligible`: the program or semester does not match, or the GPA is below the minimum. The `reasons` array explains why.
- `days_left` is calculated by the API with the Asia/Jakarta (WIB) date, and scholarships past their deadline by that date are dropped.
- Results are sorted: fully, partially, not yet eligible; inside each group by nearest deadline.
- Other requirements (the `other_requirements` text) are returned to the student but are **not checked automatically**.

## 10. Loading data

### Dummy data
`database/seed_dummy.sql` inserts 7 rows named `[DUMMY] ...` with `source_url = 'dummy'` (including one expired and one unverified row to test the filters). Remove all of them with one run of `database/delete_dummy.sql`.

### Real data (CSV importer)
Real rows must come from official ITB pages and carry `source_url` and `accessed_on`. The importer only writes a SQL file; it never connects to the database and uses no keys.

1. Fill a CSV that uses the header from `database/scholarships_template.csv` (comma-separated; in list cells such as `allowed_programs` and `required_documents` items are separated by `;`; dates as `YYYY-MM-DD`; GPA with a dot). Export from Google Sheets (File > Download > CSV). Excel with Indonesian regional settings often writes `;` delimiters and `dd/mm/yyyy` dates, which the importer rejects with a clear message.
2. Generate the SQL (optionally validate program names against a text file with one program per line):
   ```cmd
   cd backend
   node scripts\import-csv.js path\to\scholarships.csv --programs path\to\programs.txt
   ```
   This writes `database/import_scholarships.sql` (use `--out` to choose another path). Nothing is written if any row has a problem. Rows are generated as **not verified** (hidden from students).
3. Open the generated file, paste it into the Supabase SQL Editor and run it. Running it again is safe: rows with the same campus, name and `source_url` are skipped.
4. A teammate checks each row against its official page. Then publish the checked rows with the `update ... set is_verified = true, verified_at = now() where id in (...)` statement printed at the bottom of the generated file. (`--verified` inserts rows as verified directly; use it only after the check.)
5. Remove the dummy data with `database/delete_dummy.sql`.

## 11. Planned (not built)

- Deadline reminders (email or notification)
- Application readiness checklist per scholarship
- Document upload and checking
- More campuses (the schema has a `campuses` table, but the pilot is fixed to ITB)
- Password reset and token refresh endpoints
- Updating existing scholarships through the importer (it only inserts new rows)
- Automatic checking of `other_requirements`
- Rate limiting, restricted CORS origins and a production deployment setup

## 12. Known limitations

- Matching only checks study program, semester and minimum GPA. Other requirements are shown but not evaluated, so a "fully eligible" label does not guarantee eligibility. Students must confirm on the official source page.
- The study program is compared as exact, case-sensitive text. The frontend must offer a fixed dropdown whose names are identical to the names in the scholarship data.
- The access token lasts about an hour and there is no refresh endpoint; users must log in again.
- No rate limiting, and CORS is open to all origins (acceptable for local development only).
- Email confirmation is turned off in development (see section 5).
- The SQL function filters deadlines with the database date (UTC) while the API recalculates `days_left` with the WIB date and drops anything already past in WIB.
- The tests are integration tests against a shared development project; they are not part of a CI pipeline, and the profile tests overwrite the test user's profile.
- Scholarship verification is manual. Rows imported by the CSV tool are hidden until a person marks them verified.

## 13. Troubleshooting

- `permission denied for table X`: a GRANT is missing for the `authenticated` role. Run the `grant ...` statements at the end of `database/schema_siapdaftar.sql`.
- Empty result and no error: RLS is filtering rows. Check that the scholarships are `is_verified = true`, and that the user's profile has `campus_id` set (matching filters by the user's campus).
- `Email not confirmed` on login: Confirm email is on. Turn it off for development or confirm the user in the Supabase dashboard.
- Signup says the email is invalid: Supabase rejects some domains (for example `example.com`). Use another synthetic address.
- `Missing env vars` at startup: `backend/.env` is missing or does not have `SUPABASE_URL` and `SUPABASE_ANON_KEY`.

## 14. AI assistance disclosure

We used an AI assistant (Claude, by Anthropic) while building this backend. In the chat sessions where the backend was built, the AI generated the Express server, authentication middleware, the profile, matches and saved routes, the integration test scripts, the SQL seed and delete scripts, the CSV importer and its tests, the English wording of the reasons returned by `match_scholarships`, this README, `API.md`, and a brief for the frontend developer. written by the team

The team decided the product scope and rules, created and configured the Supabase project, applied the schema, ran every test script and every database step on our own machines, reviewed the code and made the commits. All test results quoted in this document come from those runs. The matching logic is rule-based; no AI model is used at runtime.