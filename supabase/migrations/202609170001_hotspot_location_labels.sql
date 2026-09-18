alter table public.hotspots
  add column if not exists location_name text check (location_name is null or char_length(location_name) <= 160),
  add column if not exists location_admin1 text check (location_admin1 is null or char_length(location_admin1) <= 160),
  add column if not exists location_admin2 text check (location_admin2 is null or char_length(location_admin2) <= 160),
  add column if not exists location_country text check (location_country is null or char_length(location_country) <= 160);

comment on column public.hotspots.title is 'User-defined hotspot name, separate from the geographic place label.';
comment on column public.hotspots.location_name is 'Geographic place selected through geocoding; never substitutes exact coordinates.';
