-- Security hardening and stable MVP API for MushroomApp.
-- Apply after 202609160001_mushroomapp_v1.sql.

drop policy if exists friendships_send on public.friendships;
drop policy if exists friendships_recipient_accept on public.friendships;
alter table public.friendships alter column status drop default;
alter table public.friendships alter column status type text using status::text;
alter table public.friendships alter column status set default 'pending';
alter table public.friendships add column if not exists updated_at timestamptz not null default now();
alter table public.friendships drop constraint if exists friendships_status_check;
alter table public.friendships add constraint friendships_status_check check (status in ('pending','accepted','rejected'));

-- Exact coordinates are never an option for community cards. Existing opt-ins are
-- neutralized before the invariant is installed.
update public.finds set share_exact_community_location = false where share_exact_community_location;
alter table public.finds drop constraint if exists finds_community_coordinates_private;
alter table public.finds add constraint finds_community_coordinates_private check (share_exact_community_location = false);

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create or replace function private.is_friend(a uuid, b uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select auth.uid() is not null and exists (
    select 1 from public.friendships f
    where f.status = 'accepted'
      and ((f.requester_id = a and f.recipient_id = b) or (f.requester_id = b and f.recipient_id = a))
  );
$$;
revoke all on function private.is_friend(uuid,uuid) from public, anon;
grant execute on function private.is_friend(uuid,uuid) to authenticated;

create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_updated_at on public.profiles;
create trigger profiles_updated_at before update on public.profiles
for each row execute function public.set_updated_at();

create or replace function public.protect_friendship()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.requester_id is distinct from old.requester_id
     or new.recipient_id is distinct from old.recipient_id
     or new.id is distinct from old.id then
    raise exception 'friendship participants cannot be changed';
  end if;
  if old.status <> 'pending' or new.status not in ('accepted','rejected') then
    raise exception 'invalid friendship status transition';
  end if;
  new.responded_at = now();
  new.updated_at = now();
  return new;
end;
$$;
drop trigger if exists friendships_protect on public.friendships;
create trigger friendships_protect before update on public.friendships
for each row execute function public.protect_friendship();

-- Rebuild policies so friendship checks live outside the API-exposed schema.
drop policy if exists profiles_self_select on public.profiles;
drop policy if exists profiles_authenticated_select on public.profiles;
create policy profiles_authenticated_select on public.profiles for select to authenticated using (true);

drop policy if exists hotspots_friend_read on public.hotspots;
create policy hotspots_friend_read on public.hotspots for select to authenticated
using (deleted_at is null and location_sharing = 'friends' and private.is_friend(owner_id, (select auth.uid())));

drop policy if exists finds_friend_read on public.finds;
create policy finds_friend_read on public.finds for select to authenticated
using (deleted_at is null and visibility = 'friends' and private.is_friend(owner_id, (select auth.uid())));

drop policy if exists items_visible_read on public.find_items;
create policy items_visible_read on public.find_items for select to authenticated using (
  exists (select 1 from public.finds f where f.id = find_id and f.deleted_at is null
    and (f.owner_id = (select auth.uid()) or (f.visibility = 'friends' and private.is_friend(f.owner_id, (select auth.uid())))))
);

drop policy if exists photos_visible_read on public.find_photos;
create policy photos_visible_read on public.find_photos for select to authenticated using (
  deleted_at is null and exists (select 1 from public.finds f where f.id = find_id and f.deleted_at is null
    and (f.owner_id = (select auth.uid()) or f.visibility = 'community'
      or (f.visibility = 'friends' and private.is_friend(f.owner_id, (select auth.uid())))))
);

-- No direct UPDATE policy: responses use the narrowly scoped RPC below.
create policy friendships_send on public.friendships for insert to authenticated
with check (requester_id = (select auth.uid()) and requester_id <> recipient_id and status = 'pending');

drop policy if exists storage_photo_authorized_select on storage.objects;
create policy storage_photo_authorized_select on storage.objects for select to authenticated using (
  bucket_id = 'find-photos' and exists (
    select 1 from public.find_photos ph join public.finds f on f.id = ph.find_id
    where ph.storage_path = name and ph.deleted_at is null and f.deleted_at is null
      and (f.owner_id = auth.uid() or f.visibility = 'community'
        or (f.visibility = 'friends' and private.is_friend(f.owner_id, auth.uid())))
  )
);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare desired text;
begin
  desired := trim(coalesce(nullif(new.raw_user_meta_data->>'username',''), 'gobar_' || left(new.id::text,8)));
  insert into public.profiles(id, username, display_name)
  values (new.id, desired, coalesce(nullif(trim(new.raw_user_meta_data->>'display_name'),''), desired));
  return new;
end;
$$;

create or replace function public.is_username_available(candidate text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select trim(candidate) ~ '^[A-Za-z0-9_.-]{3,32}$'
    and not exists (select 1 from public.profiles p where p.username = trim(candidate)::citext);
$$;
revoke all on function public.is_username_available(text) from public;
grant execute on function public.is_username_available(text) to anon, authenticated;

create or replace function public.respond_to_friend_request(friendship_id uuid, response text)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if response not in ('accepted','rejected') then raise exception 'invalid response'; end if;
  update public.friendships f set status = response
  where f.id = friendship_id and f.recipient_id = auth.uid() and f.status = 'pending';
  if not found then raise exception 'friend request not found or not authorized'; end if;
end;
$$;
revoke all on function public.respond_to_friend_request(uuid,text) from public, anon;
grant execute on function public.respond_to_friend_request(uuid,text) to authenticated;

create or replace function public.search_profiles(search_query text, result_limit integer default 20)
returns table("profileId" uuid, username text, "displayName" text)
language sql stable security definer set search_path = '' as $$
  select p.id, p.username::text, p.display_name from public.profiles p
  where auth.uid() is not null and p.id <> auth.uid()
    and p.username::text ilike '%' || replace(replace(trim(search_query),'%',''),'_','') || '%'
  order by p.username limit least(greatest(result_limit,1),20);
$$;

create or replace function public.get_my_friendships()
returns table("friendshipId" uuid,"profileId" uuid,username text,"displayName" text,status text,direction text)
language sql stable security definer set search_path = '' as $$
  select f.id, p.id, p.username::text, p.display_name, f.status,
    case when f.recipient_id = auth.uid() then 'incoming' else 'outgoing' end
  from public.friendships f
  join public.profiles p on p.id = case when f.requester_id = auth.uid() then f.recipient_id else f.requester_id end
  where auth.uid() in (f.requester_id,f.recipient_id) and f.status in ('pending','accepted')
  order by f.created_at desc;
$$;

create or replace function public.get_friend_hotspots()
returns table(id uuid,owner_username text,latitude double precision,longitude double precision,title text)
language sql stable security definer set search_path = '' as $$
  select h.id, p.username::text, h.latitude, h.longitude, h.title
  from public.hotspots h join public.profiles p on p.id = h.owner_id
  where auth.uid() is not null and h.deleted_at is null and h.location_sharing = 'friends'
    and private.is_friend(h.owner_id, auth.uid())
  order by h.server_updated_at desc limit 200;
$$;

drop function if exists public.get_shared_find_cards(text,integer,integer);
create function public.get_shared_find_cards(p_scope text,p_offset integer default 0,p_limit integer default 20)
returns table(
  "findId" uuid, username text, "displayName" text, "avatarPath" text,
  species text[], quantities text[], "observedAt" timestamptz,
  "temperatureC" double precision, notes text, "locationName" text, "photoPaths" text[]
)
language sql stable security definer set search_path = '' as $$
  select f.id, p.username::text, p.display_name, p.avatar_path,
    coalesce((select array_agg(coalesce(s.name_sl,i.custom_name) order by i.created_at)
      from public.find_items i left join public.mushroom_species s on s.id=i.species_id
      where i.find_id=f.id and i.deleted_at is null),'{}'),
    coalesce((select array_agg(i.quantity::text || ' ' || i.unit::text order by i.created_at)
      from public.find_items i where i.find_id=f.id and i.deleted_at is null and i.quantity is not null),'{}'),
    f.observed_at, f.temperature_c, f.notes,
    null::text,
    coalesce((select array_agg(ph.storage_path order by ph.created_at)
      from public.find_photos ph where ph.find_id=f.id and ph.deleted_at is null),'{}')
  from public.finds f join public.profiles p on p.id=f.owner_id
  where auth.uid() is not null and f.deleted_at is null and (
    (p_scope='community' and f.visibility='community') or
    (p_scope='friends' and f.visibility='friends' and private.is_friend(f.owner_id,auth.uid()))
  )
  order by f.observed_at desc offset greatest(p_offset,0) limit least(greatest(p_limit,1),50);
$$;

revoke all on function public.search_profiles(text,integer) from public, anon;
revoke all on function public.get_my_friendships() from public, anon;
revoke all on function public.get_friend_hotspots() from public, anon;
revoke all on function public.get_shared_find_cards(text,integer,integer) from public, anon;
grant execute on function public.search_profiles(text,integer) to authenticated;
grant execute on function public.get_my_friendships() to authenticated;
grant execute on function public.get_friend_hotspots() to authenticated;
grant execute on function public.get_shared_find_cards(text,integer,integer) to authenticated;

drop function if exists public.is_friend(uuid,uuid);
revoke all on function public.set_updated_at() from public, anon, authenticated;
revoke all on function public.protect_friendship() from public, anon, authenticated;
revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.protect_owner_and_revision() from public, anon, authenticated;
revoke all on function public.bump_child_revision() from public, anon, authenticated;

-- Supabase commonly grants table privileges broadly and relies on RLS. Remove the
-- particularly sensitive direct friendship UPDATE path; all other access remains RLS-bound.
revoke update on public.friendships from authenticated;
