import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

Deno.serve(async (request) => {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  const authorization = request.headers.get('Authorization');
  if (!authorization) return new Response(JSON.stringify({ error: 'Missing authorization' }), { status: 401 });
  const url = Deno.env.get('SUPABASE_URL')!;
  const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
  const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const userClient = createClient(url, anon, { global: { headers: { Authorization: authorization } } });
  const { data: { user }, error: authError } = await userClient.auth.getUser();
  if (authError || !user) return new Response(JSON.stringify({ error: 'Invalid session' }), { status: 401 });
  const admin = createClient(url, serviceRole, { auth: { persistSession: false } });
  const { data: objects, error: listError } = await admin.storage.from('find-photos').list(user.id, { limit: 1000 });
  if (listError) return new Response(JSON.stringify({ error: listError.message }), { status: 500 });
  for (const folder of objects ?? []) {
    const { data: files } = await admin.storage.from('find-photos').list(`${user.id}/${folder.name}`, { limit: 1000 });
    const paths = (files ?? []).map((file) => `${user.id}/${folder.name}/${file.name}`);
    if (paths.length) {
      const { error } = await admin.storage.from('find-photos').remove(paths);
      if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    }
  }
  const { error: deleteError } = await admin.auth.admin.deleteUser(user.id);
  if (deleteError && !deleteError.message.toLowerCase().includes('not found')) return new Response(JSON.stringify({ error: deleteError.message }), { status: 500 });
  return new Response(JSON.stringify({ deleted: true }), { headers: { 'Content-Type': 'application/json' } });
});
