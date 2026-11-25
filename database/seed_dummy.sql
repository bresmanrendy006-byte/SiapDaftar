-- SiapDaftar: DUMMY scholarships for testing only (NOT real ITB data).
-- Run in Supabase SQL Editor. Remove everything with database/delete_dummy.sql.
-- Safe to re-run: it deletes old dummy rows first.

delete from scholarships where source_url = 'dummy';

insert into scholarships
  (campus_id, name, provider, level, allowed_programs, semester_min, semester_max,
   min_gpa, other_requirements, required_documents, deadline, apply_method,
   source_url, accessed_on, is_verified, verified_at)
values
  -- A: no restriction at all -> always "fully eligible"
  (1, '[DUMMY] Open Scholarship A', 'Dummy Foundation', 'S1',
   null, 1, 8, null,
   'Active in a student organization (shown only, not checked automatically)',
   array['Transcript','Motivation letter'],
   current_date + 30, 'Online form (dummy)', 'dummy', current_date, true, now()),

  -- B: GPA >= 3.00, any program
  (1, '[DUMMY] Merit Scholarship B', 'Dummy Foundation', 'S1',
   null, 1, 8, 3.00, null,
   array['Transcript','Recommendation letter'],
   current_date + 10, 'Online form (dummy)', 'dummy', current_date, true, now()),

  -- C: Informatics / Electrical Engineering, semester 3-6, GPA >= 3.50
  (1, '[DUMMY] Informatics Excellence C', 'Dummy Company', 'S1',
   array['Informatics','Electrical Engineering'], 3, 6, 3.50, null,
   array['Transcript','Portfolio'],
   current_date + 5, 'Email (dummy)', 'dummy', current_date, true, now()),

  -- D: other program -> "not yet eligible" for an Informatics student
  (1, '[DUMMY] Chemistry Research Grant D', 'Dummy Institute', 'S1',
   array['Chemistry'], 1, 8, null, null,
   array['Research proposal'],
   current_date + 20, 'Online form (dummy)', 'dummy', current_date, true, now()),

  -- E: semester >= 7 -> "not yet eligible" for semester 3
  (1, '[DUMMY] Senior Student Award E', 'Dummy Foundation', 'S1',
   null, 7, 8, null, null,
   array['Transcript'],
   current_date + 45, 'Online form (dummy)', 'dummy', current_date, true, now()),

  -- F: already expired -> must NOT appear
  (1, '[DUMMY] Expired Scholarship F', 'Dummy Foundation', 'S1',
   null, 1, 8, null, null,
   array['Transcript'],
   current_date - 3, 'Online form (dummy)', 'dummy', current_date, true, now()),

  -- G: not verified -> must NOT appear (RLS)
  (1, '[DUMMY] Unverified Scholarship G', 'Dummy Foundation', 'S1',
   null, 1, 8, null, null,
   array['Transcript'],
   current_date + 15, 'Online form (dummy)', 'dummy', current_date, false, null);

select id, name, deadline, is_verified from scholarships where source_url = 'dummy' order by id;