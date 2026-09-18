begin;

create extension if not exists pgcrypto;
create extension if not exists citext;

create type public.location_sharing as enum ('private','friends');
create type public.find_visibility as enum ('private','friends','community');
create type public.find_outcome as enum ('found','nothing','unspecified');
create type public.quantity_unit as enum ('pieces','g','kg');
create type public.friendship_status as enum ('pending','accepted');
create type public.weather_status as enum ('pending','complete','missing','error');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username citext not null unique check (char_length(username::text) between 3 and 32 and username::text ~ '^[A-Za-z0-9_.-]+$'),
  display_name text check (display_name is null or char_length(display_name) <= 80),
  avatar_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.mushroom_species (
  id text primary key,
  name_sl text not null,
  scientific_name text,
  aliases text[] not null default '{}',
  kind text not null check (kind in ('species','group','unknown','custom'))
);

insert into public.mushroom_species(id,name_sl,scientific_name,aliases,kind) values
('unknown','Neznana goba',null,array['neznana'],'unknown'),
('other','Drugo',null,array['druga','ostalo'],'custom'),
('boletus-group','Jurčki (skupina)',null,array['jurček','gobani'],'group'),
('boletus-edulis','Jesenski goban','Boletus edulis',array['jurček','pravi goban'],'species'),
('boletus-aereus','Poletni goban','Boletus aereus',array['črni goban'],'species'),
('cantharellus-cibarius','Navadna lisička','Cantharellus cibarius',array['lisička'],'species'),
('macrolepiota-procera','Orjaški dežnik','Macrolepiota procera',array['marela','dežnik'],'species'),
('craterellus-cornucopioides','Črna trobenta','Craterellus cornucopioides',array['mrtvaška trobenta'],'species'),
('lactarius-deliciosus','Užitna sirovka','Lactarius deliciosus',array['sirovka'],'species'),
('armillaria-group','Štorovke (skupina)',null,array['štorovka'],'group'),
('russula-group','Golobice (skupina)',null,array['golobica'],'group'),
('hydnum-repandum','Rumeni ježek','Hydnum repandum',array['ježek'],'species'),
('amanita-muscaria','Rdeča mušnica','Amanita muscaria',array['mušnica'],'species');

create table public.hotspots (
  id uuid primary key,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  title text check (title is null or char_length(title) <= 120),
  notes text check (notes is null or char_length(notes) <= 4000),
  location_source text not null check (location_source in ('gps','manual','imported')),
  accuracy_m double precision check (accuracy_m is null or accuracy_m >= 0),
  location_sharing public.location_sharing not null default 'private',
  client_updated_at timestamptz not null,
  server_updated_at timestamptz not null default now(),
  server_revision bigint not null default 1,
  deleted_at timestamptz,
  unique(id, owner_id)
);
create index hotspots_owner_active_idx on public.hotspots(owner_id, server_updated_at desc) where deleted_at is null;

create table public.finds (
  id uuid primary key,
  hotspot_id uuid not null,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  observed_at timestamptz not null,
  observation_latitude double precision not null check (observation_latitude between -90 and 90),
  observation_longitude double precision not null check (observation_longitude between -180 and 180),
  observation_accuracy_m double precision check (observation_accuracy_m is null or observation_accuracy_m >= 0),
  outcome public.find_outcome not null default 'unspecified',
  notes text check (notes is null or char_length(notes) <= 4000),
  visibility public.find_visibility not null default 'private',
  share_exact_community_location boolean not null default false,
  weather_status public.weather_status not null default 'pending',
  weather_provider text,
  weather_time timestamptz,
  weather_retrieved_at timestamptz,
  weather_dataset text,
  temperature_c double precision,
  precipitation_mm double precision check (precipitation_mm is null or precipitation_mm >= 0),
  client_updated_at timestamptz not null,
  server_updated_at timestamptz not null default now(),
  server_revision bigint not null default 1,
  deleted_at timestamptz,
  unique(id, owner_id),
  constraint finds_owned_hotspot_fk foreign key(hotspot_id, owner_id) references public.hotspots(id, owner_id)
);
create index finds_owner_active_idx on public.finds(owner_id, server_updated_at desc) where deleted_at is null;
create index finds_feed_idx on public.finds(visibility, observed_at desc) where deleted_at is null;
create index finds_hotspot_idx on public.finds(hotspot_id, observed_at desc) where deleted_at is null;

create table public.find_items (
  id uuid primary key,
  find_id uuid not null references public.finds(id) on delete cascade,
  species_id text references public.mushroom_species(id),
  custom_name text check (custom_name is null or char_length(custom_name) <= 120),
  quantity numeric check (quantity is null or quantity >= 0),
  unit public.quantity_unit,
  searched_for boolean not null default false,
  created_at timestamptz not null default now(),
  client_updated_at timestamptz not null,
  server_updated_at timestamptz not null default now(),
  server_revision bigint not null default 1,
  deleted_at timestamptz,
  check (species_id is not null or nullif(trim(custom_name),'') is not null),
  check ((quantity is null and unit is null) or (quantity is not null and unit is not null))
);
create index find_items_find_idx on public.find_items(find_id) where deleted_at is null;

create table public.find_photos (
  id uuid primary key,
  find_id uuid not null,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  storage_path text not null unique,
  width integer check (width is null or width > 0),
  height integer check (height is null or height > 0),
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint photos_owned_find_fk foreign key(find_id, owner_id) references public.finds(id, owner_id)
);
create index find_photos_find_idx on public.find_photos(find_id) where deleted_at is null;

create table public.friendships (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.profiles(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  status public.friendship_status not null default 'pending',
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  user_low uuid generated always as (least(requester_id, recipient_id)) stored,
  user_high uuid generated always as (greatest(requester_id, recipient_id)) stored,
  check (requester_id <> recipient_id),
  unique(user_low, user_high)
);
create index friendships_recipient_idx on public.friendships(recipient_id, status);
create index friendships_requester_idx on public.friendships(requester_id, status);

create table public.mutation_receipts (
  mutation_id uuid primary key,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  accepted_at timestamptz not null default now()
);

create or replace function public.is_friend(a uuid, b uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.friendships where status='accepted' and ((requester_id=a and recipient_id=b) or (requester_id=b and recipient_id=a)));
$$;
revoke all on function public.is_friend(uuid,uuid) from public;

create or replace function public.protect_owner_and_revision() returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op='UPDATE' and new.owner_id is distinct from old.owner_id then raise exception 'owner cannot be changed'; end if;
  new.server_updated_at=now();
  if tg_op='UPDATE' then new.server_revision=old.server_revision+1; end if;
  return new;
end; $$;
create trigger hotspots_revision before update on public.hotspots for each row execute function public.protect_owner_and_revision();
create trigger finds_revision before update on public.finds for each row execute function public.protect_owner_and_revision();

create or replace function public.bump_child_revision() returns trigger language plpgsql set search_path = '' as $$ begin new.server_updated_at=now(); if tg_op='UPDATE' then new.server_revision=old.server_revision+1; end if; return new; end; $$;
create trigger items_revision before update on public.find_items for each row execute function public.bump_child_revision();

alter table public.profiles enable row level security;
alter table public.mushroom_species enable row level security;
alter table public.hotspots enable row level security;
alter table public.finds enable row level security;
alter table public.find_items enable row level security;
alter table public.find_photos enable row level security;
alter table public.friendships enable row level security;
alter table public.mutation_receipts enable row level security;

create policy profiles_self_select on public.profiles for select to authenticated using (id=(select auth.uid()));
create policy profiles_self_update on public.profiles for update to authenticated using (id=(select auth.uid())) with check (id=(select auth.uid()));
create policy species_authenticated_read on public.mushroom_species for select to authenticated using (true);
create policy hotspots_owner_all on public.hotspots for all to authenticated using (owner_id=(select auth.uid())) with check (owner_id=(select auth.uid()));
create policy hotspots_friend_read on public.hotspots for select to authenticated using (deleted_at is null and location_sharing='friends' and public.is_friend(owner_id,(select auth.uid())));
create policy finds_owner_all on public.finds for all to authenticated using (owner_id=(select auth.uid())) with check (owner_id=(select auth.uid()));
create policy finds_friend_read on public.finds for select to authenticated using (deleted_at is null and visibility='friends' and public.is_friend(owner_id,(select auth.uid())));
create policy items_owner_write on public.find_items for all to authenticated
  using (exists(select 1 from public.finds f where f.id=find_id and f.owner_id=(select auth.uid())))
  with check (exists(select 1 from public.finds f where f.id=find_id and f.owner_id=(select auth.uid())));
create policy items_visible_read on public.find_items for select to authenticated using (exists(select 1 from public.finds f where f.id=find_id and f.deleted_at is null and (f.owner_id=(select auth.uid()) or (f.visibility='friends' and public.is_friend(f.owner_id,(select auth.uid()))))));
create policy photos_owner_write on public.find_photos for all to authenticated using (owner_id=(select auth.uid())) with check (owner_id=(select auth.uid()) and exists(select 1 from public.finds f where f.id=find_id and f.owner_id=(select auth.uid())));
create policy photos_visible_read on public.find_photos for select to authenticated using (deleted_at is null and exists(select 1 from public.finds f where f.id=find_id and f.deleted_at is null and (f.owner_id=(select auth.uid()) or f.visibility='community' or (f.visibility='friends' and public.is_friend(f.owner_id,(select auth.uid()))))));
create policy friendships_participant_read on public.friendships for select to authenticated using ((select auth.uid()) in (requester_id,recipient_id));
create policy friendships_send on public.friendships for insert to authenticated with check (requester_id=(select auth.uid()) and status='pending');
create policy friendships_recipient_accept on public.friendships for update to authenticated using (recipient_id=(select auth.uid()) and status='pending') with check (recipient_id=(select auth.uid()) and status='accepted');
create policy friendships_remove on public.friendships for delete to authenticated using ((select auth.uid()) in (requester_id,recipient_id));
create policy receipts_owner on public.mutation_receipts for all to authenticated using (owner_id=(select auth.uid())) with check (owner_id=(select auth.uid()));

create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path = '' as $$
declare desired text; final_name text;
begin
  desired := coalesce(nullif(new.raw_user_meta_data->>'username',''), 'gobar_' || left(new.id::text,8));
  final_name := desired;
  if exists(select 1 from public.profiles where username=final_name) then final_name := left(desired,23) || '_' || left(new.id::text,8); end if;
  insert into public.profiles(id,username,display_name) values(new.id,final_name,coalesce(nullif(new.raw_user_meta_data->>'display_name',''),final_name));
  return new;
end; $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

create or replace function public.search_profiles(search_query text, result_limit integer default 20)
returns table("profileId" uuid, username text, "displayName" text)
language sql stable security definer set search_path = '' as $$
  select p.id,p.username::text,p.display_name from public.profiles p
  where auth.uid() is not null and p.id<>auth.uid() and p.username::text ilike '%' || replace(search_query,'%','') || '%'
  order by p.username limit least(greatest(result_limit,1),20);
$$;
grant execute on function public.search_profiles(text,integer) to authenticated;

create or replace function public.get_my_friendships()
returns table("friendshipId" uuid,"profileId" uuid,username text,"displayName" text,status text,direction text)
language sql stable security definer set search_path = '' as $$
  select f.id,p.id,p.username::text,p.display_name,f.status::text,case when f.recipient_id=auth.uid() then 'incoming' else 'outgoing' end
  from public.friendships f join public.profiles p on p.id=case when f.requester_id=auth.uid() then f.recipient_id else f.requester_id end
  where auth.uid() in (f.requester_id,f.recipient_id) order by f.created_at desc;
$$;
grant execute on function public.get_my_friendships() to authenticated;

create or replace function public.get_friend_hotspots()
returns table(id uuid,owner_username text,latitude double precision,longitude double precision,title text)
language sql stable security definer set search_path = '' as $$
  select h.id,p.username::text,h.latitude,h.longitude,h.title from public.hotspots h join public.profiles p on p.id=h.owner_id
  where auth.uid() is not null and h.deleted_at is null and h.location_sharing='friends' and public.is_friend(h.owner_id,auth.uid())
  order by h.server_updated_at desc limit 200;
$$;
grant execute on function public.get_friend_hotspots() to authenticated;

create or replace function public.get_shared_find_cards(p_scope text,p_offset integer default 0,p_limit integer default 20)
returns table("findId" uuid,username text,"avatarUrl" text,species text[],quantities text[],"observedAt" timestamptz,"temperatureC" double precision,notes text,"locationMode" text,latitude double precision,longitude double precision,"photoPaths" text[])
language sql stable security definer set search_path = '' as $$
  select f.id,p.username::text,p.avatar_path,
    coalesce((select array_agg(coalesce(s.name_sl,i.custom_name) order by i.created_at) from public.find_items i left join public.mushroom_species s on s.id=i.species_id where i.find_id=f.id and i.deleted_at is null),'{}'),
    coalesce((select array_agg(case when i.quantity is null then '' else i.quantity::text || ' ' || i.unit::text end) filter (where i.quantity is not null) from public.find_items i where i.find_id=f.id and i.deleted_at is null),'{}'),
    f.observed_at,f.temperature_c,f.notes,
    case when f.visibility='community' and f.share_exact_community_location then 'exact' else 'approximate' end,
    case when f.visibility='community' and f.share_exact_community_location then f.observation_latitude else floor(f.observation_latitude/0.05)*0.05+0.025 end,
    case when f.visibility='community' and f.share_exact_community_location then f.observation_longitude else floor(f.observation_longitude/0.05)*0.05+0.025 end,
    coalesce((select array_agg(ph.storage_path order by ph.created_at) from public.find_photos ph where ph.find_id=f.id and ph.deleted_at is null),'{}')
  from public.finds f join public.profiles p on p.id=f.owner_id
  where auth.uid() is not null and f.deleted_at is null and (
    (p_scope='community' and f.visibility='community') or
    (p_scope='friends' and f.visibility='friends' and public.is_friend(f.owner_id,auth.uid()))
  )
  order by f.observed_at desc offset greatest(p_offset,0) limit least(greatest(p_limit,1),50);
$$;
grant execute on function public.get_shared_find_cards(text,integer,integer) to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('find-photos','find-photos',false,8388608,array['image/jpeg']) on conflict(id) do update set public=false;
create policy storage_photo_insert on storage.objects for insert to authenticated with check (bucket_id='find-photos' and (storage.foldername(name))[1]=auth.uid()::text);
create policy storage_photo_owner_update on storage.objects for update to authenticated using (bucket_id='find-photos' and owner_id=auth.uid()::text) with check (bucket_id='find-photos' and owner_id=auth.uid()::text);
create policy storage_photo_owner_delete on storage.objects for delete to authenticated using (bucket_id='find-photos' and owner_id=auth.uid()::text);
create policy storage_photo_authorized_select on storage.objects for select to authenticated using (
  bucket_id='find-photos' and exists(select 1 from public.find_photos ph join public.finds f on f.id=ph.find_id where ph.storage_path=name and ph.deleted_at is null and f.deleted_at is null and (f.owner_id=auth.uid() or f.visibility='community' or (f.visibility='friends' and public.is_friend(f.owner_id,auth.uid()))))
);

commit;
