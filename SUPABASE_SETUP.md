# Supabase setup za MushroomApp

MushroomApp deluje lokalno tudi brez teh korakov. Cloud, računi, prijatelji in skupnost se vključijo šele, ko sta v aplikaciji nastavljena javna URL in ključ ter sta izvedeni obe migraciji.

## 1. Ustvari projekt

1. V Supabase Dashboard izberi **New project** in ustvari razvojni projekt v primerni EU regiji.
2. Počakaj, da je baza pripravljena. Ne ustvarjaj tabel ročno v Table Editorju.
3. V **Project Settings → API** kopiraj **Project URL**.
4. Kopiraj **Publishable key** (`sb_publishable_…`). Pri starejšem projektu lahko uporabiš legacy `anon` ključ. `service_role` ali secret key nikoli ne sodi v `.env`, React Native kodo ali APK.

## 2. Nastavi `.env`

V korenu projekta kopiraj `.env.example` v `.env` in vnesi:

```text
EXPO_PUBLIC_SUPABASE_URL=https://TVOJ_PROJECT_REF.supabase.co
EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_TVOJ_JAVNI_KLJUC
```

Če projekt še nima publishable ključa, namesto druge vrstice uporabi:

```text
EXPO_PUBLIC_SUPABASE_ANON_KEY=eyJ_TVOJ_LEGACY_ANON_KLJUC
```

Po spremembi `.env` popolnoma ponovno zaženi Metro. Ker sta vrednosti vgrajeni v standalone bundle, za APK naredi nov build. `.env` je izključen iz Git-a; `.env.example` vsebuje samo placeholderje.

## 3. Izvedi migraciji

Najvarneje je uporabiti Supabase CLI in povezavo na svoj projekt:

```powershell
npx supabase login
npx supabase link --project-ref TVOJ_PROJECT_REF
npx supabase db push
```

Alternativa brez lokalnega CLI: v Dashboardu odpri **SQL Editor** in v novem queryju izvedi najprej celotno vsebino:

1. `supabase/migrations/202609160001_mushroomapp_v1.sql`
2. `supabase/migrations/202609160002_secure_cloud_foundation.sql`

Druge migracije je treba izvesti šele po prvi. Druga migracija namenoma odstrani možnost javnih GPS koordinat in utrdi prijateljstva.

## 4. Auth nastavitve

1. V **Authentication → Providers → Email** omogoči Email/Password.
2. Za resno uporabo pusti **Confirm email** vključeno. Po registraciji app pokaže »Preverite e-pošto in potrdite račun.«
3. V **Authentication → URL Configuration** med dodatne Redirect URLs dodaj:

```text
mushroomapp-preview://auth/callback
```

4. Google, Apple, magic-link in passwordless za ta MVP niso potrebni.

Profil ustvari database trigger `handle_new_user`. `citext` unique omejitev zagotavlja, da sta na primer `Marko` in `marko` isto uporabniško ime. Aplikacija pred registracijo pokliče `is_username_available`, baza pa ostane zadnja avtoriteta tudi ob sočasni registraciji.

## 5. Storage

Prva migracija sama ustvari zasebni bucket `find-photos`; ne spreminjaj ga v public. Pot je:

```text
<user_id>/<find_id>/<photo_id>.jpg
```

Storage policies dovolijo lastniku upload/update/delete. Branje je dovoljeno lastniku, sprejetim prijateljem za `friends` obisk in prijavljenim uporabnikom za fotografijo community objave. App za prikaz ustvari kratkotrajni signed URL. Trenutni photo UX pripada obiskom/najdbam; nov ločen hotspot-photo UX ni dodan.

## 6. Edge Function za izbris računa (neobvezno za prvi test)

Funkcija v `supabase/functions/delete-account` je strežniška in uporablja service-role samo v Supabase Edge runtime-u:

```powershell
npx supabase functions deploy delete-account
```

Service-role ključa ne kopiraj v mobilno konfiguracijo. Gostovani Supabase ga funkciji zagotovi strežniško. Brez deployane funkcije prijava/sync delujeta, gumb »Trajno izbriši račun« pa ne.

## 7. Preveri RLS

V Table Editorju preveri, da je RLS vključen na `profiles`, `hotspots`, `finds`, `find_items`, `find_photos`, `friendships` in `mutation_receipts`.

Pomembne lastnosti:

- `hotspots`: lastnik ima CRUD; sprejet prijatelj lahko bere samo rastišča z `location_sharing='friends'`;
- `finds`: lastnik ima CRUD; sprejet prijatelj lahko bere samo `friends`; drugi ne morejo brati raw `community` vrstic;
- `get_shared_find_cards`: community projection ne vrne `latitude`, `longitude`, `observation_latitude` ali `observation_longitude`;
- `friendships`: client ne dobi neposrednega UPDATE; accept/reject gre skozi `respond_to_friend_request` in preveri dejanskega prejemnika;
- owner/requester/recipient ID-jev ni mogoče zamenjati z neposrednim API requestom.

V SQL Editorju lahko preveriš podpis varne funkcije:

```sql
select pg_get_function_result('public.get_shared_find_cards(text,integer,integer)'::regprocedure);
```

Rezultat ne sme vsebovati koordinatnih stolpcev.

## 8. Test z dvema oziroma tremi uporabniki

1. Ustvari A, B in C z različnimi e-poštami ter potrdi vse tri račune.
2. Kot A pošlji prošnjo B; kot B jo sprejmi. C naj ostane brez povezave z A.
3. Kot A ustvari zasebni obisk, obisk za prijatelje in community obisk.
4. Kot B preveri, da je friends zapis viden, private ni, community kartica pa nima GPS.
5. Kot C preveri, da ne vidi private/friends vrstic, community kartico pa vidi brez GPS.
6. Izvedi še korake v `supabase/tests/SECURITY_SMOKE_TEST.md`.

Za resno preverjanje uporabi tri ločene prijavljene odjemalce ali REST/JS odjemalce z access tokenom vsakega uporabnika. Nikoli ne testiraj z `service_role`, ker obide RLS.

## 9. Zagon aplikacije

```powershell
npm install
npm run typecheck
npm start
```

Brez env vrednosti se Supabase client ne ustvari. Lokalni SQLite dnevnik, zemljevid, GPS, razmere in lokalno beleženje ostanejo na voljo; Profile/Community prikažeta razumljivo stanje »Oblak ni nastavljen«.
