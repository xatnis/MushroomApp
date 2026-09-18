# MushroomApp V1

Android-first, local-first gobarski dnevnik v Expo/React Native/TypeScript. Aplikacija deluje brez računa: SQLite je primarni vir za zemljevid, rastišča, obiske, vrste, fotografije, osnutke in vremenske posnetke. Ob nastavljeni povezavi s Supabase se istemu repozitoriju doda sinhronizacija, račun, prijatelji in skupnost.

## Zagon

Zahteve: Node.js, npm in za samostojno Android gradnjo Android Studio/SDK ter JDK, ki ga podpira izbrana različica React Native.

```powershell
npm install
Copy-Item .env.example .env
npm start
```

Za razvojni Android odjemalec uporabite `npm run android`. Expo Go lahko uporabi večino lokalnih funkcij, vendar končno preverjanje Google Maps ključa in native nastavitev zahteva nov Android build.

Uporabni skripti:

- `npm run typecheck` — TypeScript brez izhoda;
- `npm run export:android` — ustvari Android JS/asset export v `dist/android`;
- `npm run prebuild:android` — regenerira native Android projekt;
- `npx expo run:android --variant release` — lokalna release gradnja, ko sta JDK in Android SDK nastavljena;
- `npx eas build --platform android --profile preview` — samostojni preview APK (zahteva vaš EAS projekt/prijavo; ne zaženite brez pooblastila);
- `npx eas build --platform android --profile production` — prihodnji AAB.

`eas.json` vsebuje ločena profila za preview APK in production AAB. Pred EAS gradnjo nastavite `EXPO_PUBLIC_EAS_PROJECT_ID` ali zamenjajte označeno vrednost v Expo konfiguraciji.

## Okolje

Kopirajte `.env.example` v `.env` in po potrebi nastavite:

```text
EXPO_PUBLIC_GOOGLE_MAPS_API_KEY=
EXPO_PUBLIC_SUPABASE_URL=
EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
EXPO_PUBLIC_EAS_PROJECT_ID=
```

Vrednosti z `EXPO_PUBLIC_` so vključene v aplikacijo in niso skrivnosti. V mobilno aplikacijo nikoli ne dodajte Supabase service-role ključa.

### Google Maps za Android

1. V Google Cloud projektu omogočite **Maps SDK for Android**.
2. Ustvarite Android API ključ in ga nastavite kot `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY`.
3. Ključ omejite na Android aplikacijo `si.mushroomapp.preview` in SHA-1 podpisnega certifikata, ki dejansko podpisuje preview/release build. Za debug in EAS poverilnice so lahko potrebni različni SHA-1 odtisi.
4. Po vsaki spremembi native konfiguracije naredite nov build; sam Metro restart ne zadostuje.

Brez ključa se konfiguracijsko odvisen Google zemljevid na Androidu ne namesti. Aplikacija prikaže uporaben setup zaslon, seznam lokacij in snemalni tok pa ostaneta na voljo.

### Supabase

1. Ustvarite svoj razvojni Supabase projekt; aplikacija ne ustvarja ali spreminja zunanjega projekta sama.
2. Z lokalnim Supabase CLI ali SQL urejevalnikom po vrstnem redu uporabite obe datoteki v `supabase/migrations/`.
3. Namestite Edge Function `delete-account` iz `supabase/functions/delete-account`. V gostovanem Supabase okolju so `SUPABASE_URL`, `SUPABASE_ANON_KEY` in `SUPABASE_SERVICE_ROLE_KEY` na voljo funkciji na strežniku; service-role ključa ne posredujte odjemalcu.
4. V Auth URL Configuration dodajte `mushroomapp-preview://auth/callback` med dovoljene redirect URL-je. Nastavite e-poštnega ponudnika ter po želji zahtevajte potrditev e-pošte.
5. V `.env` dodajte Project URL in anon/publishable ključ ter znova zaženite razvojni strežnik oziroma naredite nov build.

Migraciji ustvarita profile, katalog vrst, rastišča, obiske, postavke, fotografije, prijateljstva, mutation receipts, indekse, omejitve, RLS, zasebni `find-photos` bucket in ozko določene RPC projekcije za iskanje profilov, prijateljske lokacije ter feed. Skupnost ne bere surovih vrstic z GPS: community RPC sploh nima stolpcev latitude/longitude. Natančna navodila so v `SUPABASE_SETUP.md`.

## Lokalno in brez povezave

- Novi uporabnik lahko izbere »Nadaljuj v tej napravi« in uporablja resnične podatke brez registracije.
- Zapisi, fotografije v app-owned shrambi in osnutki preživijo ponovni zagon.
- Nov hotspot in prvi obisk se zapišeta v eni SQLite transakciji. Oblačni profil v isti transakciji dobi tudi outbox operacije.
- Namerno lokalni zapisi so označeni »Samo v napravi«, ne kot napaka.
- Po prijavi uporabnik izrecno izbere med pripenjanjem lokalnega dnevnika in ločenim oblačnim dnevnikom. Preklop računa ne premeša lokalnih profilov.
- Outbox ima stabilne mutation ID-je, vrstni red starš–otrok–medij, omejen eksponentni odmik, nadaljevanje po zagonu, ročni retry in ne ustavi cele vrste zaradi ene trajne napake.
- Pull ohrani nesinhronizirane lokalne spremembe in ustvari konflikt »Ohrani mojo / Uporabi oblačno«.
- Sinhronizacija teče le med odprto aplikacijo; prisilno zaprta aplikacija nima zagotovljene sinhronizacije v ozadju.

## Zasebnost in deljenje

Lokacija rastišča in vidnost obiska sta ločeni odločitvi. Deljenje rastišča s sprejetimi prijatelji omogoči točno lokacijo in osnovne podatke rastišča, ne pa zasebnih obiskov. Vsak obisk je zaseben, za prijatelje ali za skupnost; nova vrednost je vedno zasebna.

Skupnost dobi samo RPC projekcijo kartice brez koordinat. Zasebni naslov/opombe rastišča, druga zgodovina in surove lokacije iz vremenskih odgovorov niso del rezultata. Fotografije so v zasebnem bucketu in odjemalec pridobi kratkotrajne podpisane URL-je. Že prenesenih vsebin, posnetkov zaslona ali še veljavnih podpisanih URL-jev ni mogoče retroaktivno izbrisati.

Namenski EXIF/GPS čistilni cevovod je odložen v V2. Picker ne zahteva EXIF podatkov, toda V1 ne zagotavlja, da je vsak deljeni medij brez vseh lokacijskih metapodatkov.

## Vreme in ocena

Open-Meteo adapter loči trenutne/predvidene razmere od zgodovinskega posnetka obiska. Zgodovinska poizvedba uporablja koordinate in dejanski čas opazovanja; sprememba časa/lokacije posnetek razveljavi. Rezultati se predpomnijo po lokaciji/času, sočasne poizvedbe se združijo, manjkajoče vrednosti pa niso pretvorjene v nič.

»Mushroom Score« je transparentna splošna, eksperimentalna hevristika (padavine, temperatura, sezona in razpoložljiva osebna zgodovina), ne strojno učenje, verjetnost uspeha ali znanstveno pravilo za posamezno vrsto. »Kam po gobe?« razvrsti samo uporabnikova rastišča; razdalja je jasno označena kot zračna.

Open-Meteo je naveden v uporabniškem vmesniku. Pred komercialno uporabo preverite aktualne pogoje ponudnika in zahteve glede navedbe vira.

## Omejitve V1

Ni AI identifikacije ali informacij o užitnosti, všečkov/komentarjev, community-derived score, zemljevidov brez povezave, background tracking/sync garancij, moderacijskega sistema, plačil, oglasov ali iOS/web poliranja. Pred javnim zagonom so potrebni ločeni varnostni, medijski, zasebnostni, funkcionalni in uporabniški preizkusi.

**Varnost:** MushroomApp je orodje za beleženje in oceno razmer, ne avtoriteta za užitnost gob ter ne jamstvo za varno navigacijo, dovoljeno pot ali vstop na zemljišče.
