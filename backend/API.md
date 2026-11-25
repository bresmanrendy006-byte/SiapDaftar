# SiapDaftar API reference

Base URL: same origin as the server (default `http://localhost:3000`). All request and response bodies are JSON (`Content-Type: application/json`). Authenticated routes need the header `Authorization: Bearer <access_token>`. Errors look like `{ "error": "message" }`.

This contract is frozen for the prototype. The backend has no logout endpoint, no token refresh, no password reset, no endpoint that lists all scholarships (only matches), no editing of saved items and no reminders.

## Health
`GET /health` -> `200 { "status": "ok", "service": "siapdaftar-backend", "time": "<ISO timestamp>" }`

## Auth

### `POST /api/auth/signup`
Body: `{ "email": "...", "password": "..." }` (password at least 8 characters)
- `201`: `{ "user": { "id", "email" }, "session": { "access_token", "refresh_token", "expires_at", "token_type" } | null, "requires_email_confirmation": boolean }`. `session` is `null` when email confirmation is turned on in Supabase.
- `400`: `{ "error": "..." }` (invalid email, short password, already registered, ...).

### `POST /api/auth/login`
Body: `{ "email": "...", "password": "..." }`
- `200`: `{ "user": { "id", "email" }, "session": { "access_token", "refresh_token", "expires_at", "token_type" } }`
- `400` invalid input, `401` wrong credentials or unconfirmed email, `429` too many attempts, `502` auth service unavailable.

### `GET /api/auth/me` (auth)
- `200`: `{ "user": { "id", "email" } }`
- `401`: missing, invalid or expired token.

The access token lasts about one hour. There is no refresh endpoint: after a `401` the client must log in again.

## Profile (auth)

### `GET /api/profile`
- `200`: `{ "profile": null }` when none exists, otherwise
  `{ "profile": { "user_id", "campus_id": 1, "program": "Informatics", "semester": 3, "gpa": 3.5 | null, "interests": ["AI"] } }`
  (`gpa` can be a number, a numeric string or `null`; wrap it with `Number()`.)

### `PUT /api/profile`
Creates or replaces the user's own profile. Body:
```json
{ "campus_id": 1, "program": "Informatics", "semester": 3, "gpa": 3.5, "interests": ["AI", "Data Science"] }
```
- `campus_id`: optional, must be `1` (ITB is the only campus in the pilot).
- `program`: required, max 100 characters. It is compared with scholarship programs as exact, case-sensitive text.
- `semester`: required, whole number 1 to 14.
- `gpa`: optional. Omit or send `null` to clear. If given: 0.00 to 4.00 with at most 2 decimals.
- `interests`: optional array of strings (max 10 items, each max 50 characters); a comma-separated string is also accepted.
- `200`: `{ "profile": { ... } }`
- `400`: `{ "error": "Invalid profile", "details": ["...", "..."] }`

## Matches (auth)

### `GET /api/matches`
```json
{
  "today_wib": "2026-11-25",
  "summary": { "total": 5, "fully_eligible": 1, "partially_eligible": 2, "not_yet_eligible": 2 },
  "matches": [
    {
      "scholarship_id": 1,
      "name": "[DUMMY] Open Scholarship A",
      "provider": "Dummy Foundation",
      "level": "S1",
      "label": "fully eligible",
      "reasons": [],
      "deadline": "2026-12-25",
      "days_left": 30,
      "required_documents": ["Transcript", "Motivation letter"],
      "apply_method": "Online form (dummy)",
      "other_requirements": "Shown to the student, NOT checked automatically",
      "source_url": "dummy",
      "accessed_on": "2026-11-25"
    }
  ]
}
```
- `label` is exactly one of `fully eligible`, `partially eligible`, `not yet eligible`.
- `reasons` is an array of English sentences (empty for `fully eligible`).
- Sorted: fully, partially, not yet eligible; inside each group by nearest deadline.
- `provider`, `level`, `apply_method`, `other_requirements`, `source_url`, `accessed_on` can be `null`; `required_documents` can be empty.
- `days_left` is based on the Asia/Jakarta (WIB) date. Scholarships past their deadline are not returned.
- `409`: `{ "error": "Complete your profile first", "code": "PROFILE_REQUIRED" }` when the user has no profile yet.
- The response never contains the GPA.

## Saved (auth)

### `GET /api/saved`
```json
{
  "today_wib": "2026-11-25",
  "summary": { "total": 2, "expired": 0 },
  "saved": [
    {
      "scholarship_id": 1,
      "name": "...", "provider": "...", "level": "S1",
      "label": "fully eligible", "reasons": [],
      "deadline": "2026-12-25", "days_left": 30, "expired": false,
      "required_documents": [], "apply_method": null, "other_requirements": null,
      "source_url": "...", "accessed_on": "2026-11-25",
      "status": "saved", "saved_at": "2026-11-25T10:00:00+00:00"
    }
  ]
}
```
- Items past their deadline stay in the list with `expired: true`, `label: null` and a negative `days_left`; they are listed last.

### `POST /api/saved`
Body: `{ "scholarship_id": 1 }` (positive whole number, number or numeric string)
- `200`: `{ "saved": true, "scholarship_id": 1 }` (saving twice is fine)
- `400` invalid id, `404` scholarship not found (or not visible), `409` `PROFILE_REQUIRED`.

### `DELETE /api/saved/:scholarship_id`
- `200`: `{ "saved": false, "scholarship_id": 1 }` (also when it was not saved)
- `400` invalid id.

## Common errors
- `401 { "error": "Missing bearer token" }` or `{ "error": "Invalid or expired token" }` on any authenticated route.
- `404 { "error": "Not found" }` for unknown `/api/...` paths.
- `500 { "error": "Internal server error" }` or `{ "error": "Database error" }` for unexpected failures.