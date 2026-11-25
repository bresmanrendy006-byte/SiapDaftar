-- SiapDaftar: skema awal untuk Supabase (PostgreSQL)
-- Catatan: belum diuji di proyek Supabase; jalankan di SQL Editor dan perbaiki bila ada error.

create table campuses (
  id   serial primary key,
  name text not null unique              -- contoh: 'ITB'
);

create table scholarships (
  id                 bigserial primary key,
  campus_id          int references campuses(id),
  name               text not null,
  provider           text,
  level              text,               -- 'S1', 'S2', dst.
  allowed_programs   text[],             -- null = semua program studi
  semester_min       int,
  semester_max       int,
  min_gpa            numeric(3,2),       -- null = tidak ada batas
  other_requirements text,
  required_documents text[],
  deadline           date not null,
  apply_method       text,
  source_url         text not null,      -- wajib: sumber resmi
  accessed_on        date not null,
  is_verified        boolean not null default false,
  verified_at        timestamptz
);

create table profiles (
  user_id   uuid primary key references auth.users(id) on delete cascade,
  campus_id int references campuses(id),
  program   text not null,
  semester  int  not null,
  gpa       numeric(3,2),                -- opsional; hanya untuk pencocokan
  interests text[]
);

create table saved_scholarships (
  user_id        uuid   references profiles(user_id) on delete cascade,
  scholarship_id bigint references scholarships(id)  on delete cascade,
  status         text not null default 'saved',
  saved_at       timestamptz not null default now(),
  primary key (user_id, scholarship_id)
);

-- Keamanan: tiap pengguna hanya melihat data miliknya; beasiswa terverifikasi boleh dibaca.
alter table campuses           enable row level security;
alter table profiles           enable row level security;
alter table saved_scholarships enable row level security;
alter table scholarships       enable row level security;

create policy "read campuses" on campuses
  for select using (true);
create policy "own profile" on profiles
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own saved" on saved_scholarships
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "read verified scholarships" on scholarships
  for select using (is_verified);

-- Pencocokan berbasis aturan (tanpa AI): fully / partially / not yet eligible + alasan.
create or replace function match_scholarships(p_user uuid)
returns table (scholarship_id bigint, name text, deadline date, label text, reasons text[])
language sql stable security invoker as $$
  with p as (select * from profiles where user_id = p_user),
  c as (
    select s.id, s.name, s.deadline,
      (s.allowed_programs is null or p.program = any(s.allowed_programs)) as program_ok,
      ((s.semester_min is null or p.semester >= s.semester_min)
        and (s.semester_max is null or p.semester <= s.semester_max))     as semester_ok,
      case when s.min_gpa is null then true
           when p.gpa is null     then null      -- GPA not provided: cannot be checked
           else p.gpa >= s.min_gpa end                                     as gpa_ok
    from scholarships s, p
    where s.is_verified
      and s.deadline >= current_date
      and (s.campus_id is null or s.campus_id = p.campus_id)
  )
  select id, name, deadline,
    case when not program_ok or not semester_ok or gpa_ok is false then 'not yet eligible'
         when gpa_ok is null then 'partially eligible'
         else 'fully eligible' end,
    array_remove(array[
      case when not program_ok  then 'Your study program is not on the eligible list' end,
      case when not semester_ok then 'Your semester is outside the allowed range' end,
      case when gpa_ok is false then 'Your GPA is below the minimum' end,
      case when gpa_ok is null  then 'GPA not provided, so this requirement cannot be checked yet' end
    ], null)
  from c
  order by deadline;
$$;

-- Hak akses tabel untuk Data API (RLS tetap membatasi baris yang boleh diakses).
-- Diperlukan bila muncul error "permission denied for table ..." saat memakai kunci publik.
grant usage on schema public to anon, authenticated;
grant select on campuses to anon, authenticated;
grant select on scholarships to authenticated;
grant select, insert, update, delete on profiles to authenticated;
grant select, insert, update, delete on saved_scholarships to authenticated;
grant execute on function match_scholarships(uuid) to authenticated;