-- Removes ALL dummy scholarships (and any saved_scholarships pointing to them, via ON DELETE CASCADE).
delete from scholarships where source_url = 'dummy';

select count(*) as remaining_dummy_rows from scholarships where source_url = 'dummy'; -- expect 0