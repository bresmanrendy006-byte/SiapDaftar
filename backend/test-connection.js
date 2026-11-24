require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

(async () => {
  const { data, error } = await supabase.from('campuses').select('*');
  if (error) return console.error('Gagal:', error.message);
  console.log('Terhubung. Kampus:', data);
})();