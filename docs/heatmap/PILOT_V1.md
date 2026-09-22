# MushroomApp Heatmap Pilot V1

## Namen in območje

Pilot prikazuje eksperimentalno primernost vremenskih razmer in potencialnega habitata v približno 25-kilometrskem radiju okoli Črne na Koroškem. Ne predstavlja verjetnosti najdbe, ne potrjuje prisotnosti vrste, dostopa ali dovoljenja za nabiranje.

- Center: 46.470450 N, 14.850090 E (Open-Meteo Geocoding API)
- Radij: 25.000 m
- BBox: 14.518519, 46.241057, 15.181549, 46.699809
- Habitatna kartografska celica: približno 1.000 m
- Število habitatnih poligonov: 1.961
- Razmik vremenskih vzorčnih točk: približno 10.000 m
- Število vremenskih točk: 25

To sta inženirski ločljivosti pilota, ne biološka ali meteorološka natančnost.

## Habitatni vir

Uporabljen je ESA WorldCover 2021 v200, 10 m, EPSG:4326. Pilot iz uradnih Cloud-Optimized GeoTIFF datotek bere le izrez območja in agregira razreda 10 (Tree cover) ter 30 (Grassland). Izvorni rasterji se ne shranjujejo v repozitorij.

- Licenca: CC BY 4.0
- Attribution: © ESA WorldCover project 2021 / Contains modified Copernicus Sentinel data (2021) processed by ESA WorldCover consortium
- Uradna dokumentacija: https://esa-worldcover.org/en/data-access
- Vir razredov: https://esa-worldcover.org/en/data-access

ZGS WFS na `https://prostor.zgs.gov.si/geoserver/wfs`, sloj `pregledovalnik:sestoji`, je bil 22. 9. 2026 ponovno preverjen in uporabljen za ločeno offline obogatitev. WorldCover sam še vedno ne potrjuje bora. Podrobnosti validacije in omejitve so spodaj.

## Habitatna pravila

Centralizirana pragova sta kartografski hevristiki:

- `PILOT_MIN_TREE_COVER_FRACTION = 0.30`
- `PILOT_MIN_VEGETATION_FRACTION = 0.20`

Pravila:

- Splošno: `candidate`, če je vsota drevesnega pokrova in travinja vsaj 0,20.
- Jesenski goban: `candidate`, če je drevesni pokrov vsaj 0,30.
- Navadna lisička: `candidate`, če je drevesni pokrov vsaj 0,30.
- Užitna sirovka: brez zadostnih preverjenih ZGS dokazov pri drevesnem pokrovu ostane `unknown`; zadostni dokazi po spodnji politiki omogočijo `candidate`. Negozdna celica ostane `outside-model`.

## Vremenska mreža in zahtevki

Open-Meteo se kliče paketno za vseh 25 koordinat. En hladen refresh pomeni dva omrežna zahtevka:

1. Archive API za zaključene dni D−60 do D−8.
2. Forecast API z `past_days=7`, sedemdnevno napovedjo in hourly vlago tal.

Isti vremenski posnetek se uporabi za vse štiri profile in oba datuma. Preklop vrste ali Danes/Jutri po prvem nalaganju zato ne povzroči novega zahtevka. Rezultati so predpomnjeni 30 minut; ključ vključuje policy version, datum, razpon in koordinatno mrežo.

## Danes in Jutri

- Danes: 60-dnevna zgodovina se konča pred današnjim lokalnim datumom. Današnji napovedani dež ne vpliva na današnjo oceno.
- Jutri: okna se premaknejo za en dan. Današnji dnevni podatek postane en modeliran/napovedan dan zgodovine. Vlaga tal se vzame iz napovedi okoli 09:00 Europe/Ljubljana.
- Če jutrišnja vlaga tal manjka, se ne izmisli; optional komponenta se izloči po obstoječi renormalizaciji, kakovost pa postane `limited`.

Legacy ConditionsScreen in njegove formule se zaradi pilota ne spreminjajo.

## Kakovost podatkov

- `complete`: prisotne so vse pričakovane komponente profila.
- `limited`: ključni vremenski vhodi obstajajo, manjka pa opcijska komponenta, na primer vlaga tal ali ET₀.
- `insufficient`: manjka ključni vhod, zato se score ne pokaže kot 0, temveč kot manjkajoč.

Napaka ene vremenske točke ne spremeni manjkajočih podatkov v ničle. Celice brez zadostnih podatkov imajo nevtralni prikaz.

## Regeneracija habitatnega artefakta

Iz korena projekta:

```powershell
python -m pip install -r scripts/heatmap/requirements.txt
$env:CPL_VSIL_CURL_ALLOWED_EXTENSIONS='.tif'
python scripts/heatmap/prepare_pilot.py --output-dir src/data/heatmapPilot
```

Skript potrebuje omrežni dostop do dveh uradnih WorldCover COG ploščic. Generira le mali izpeljani GeoJSON in metadata JSON.

## Znane omejitve

- 1 km celica lahko vsebuje več habitatnih tipov; deleži so agregirani.
- 10 km vremenska mreža je pilotna interpolacijska bližina, ne lokalna mikroklimatska meritev.
- Nadmorska višina znotraj iste vremenske celice lahko povzroča pomembne razlike.
- WorldCover ne določa drevesnih vrst; ZGS podatek se nanaša na sestojno lesno zalogo, ne na točno mesto posameznih borov.
- Ni nacionalnega tile strežnika, PostGIS backenda ali samodejnega osveževanja.
- Danes/Jutri sta vremenski presoji, ne napovedi pojava trosnjakov.

## ZGS drevesna sestava – preverjeno 22. 9. 2026

Live `GetCapabilities` WFS 2.0.0 potrjuje `pregledovalnik:sestoji`, privzeti CRS `urn:ogc:def:crs:EPSG::3794`, JSON format, straničenje in sortiranje. `DescribeFeatureType` potrjuje `geom` kot MultiSurface ter osnovne `lzskdvXX` kot nullable decimal. Uradni opis je ob preverjanju **2.8** (ne več 2.7); tabela 14 ohranja zahtevano semantiko. Primerjava istega feature ID v EPSG:3794 in EPSG:4326 v pipeline preveri axis order in toleranco 2 m.

Uradna vira:

- [Opis podatkov, 3.3.2, tabela 14](https://prostor.zgs.gov.si/pregledovalnik/viewer/GetHelp?info=true)
- [ZGS – informacije javnega značaja, oddelka 3.c in 5](https://www.zgs.si/informacije/informacije-javnega-znacaja/)

Osnovni deleži pomenijo sestojno **lesno zalogo**: 11 smreka, 21 jelka, 30 bor, 34 macesen, 39 ostali iglavci, 41 bukev, 50 hrasti, 60 plemeniti listavci, 70 trdi listavci in 80 mehki listavci. `*_m` (mladje) se nikjer ne uporablja za analizo. `povrsina` je v ha, vendar agregacija uporablja dejanske geometrijske preseke.

Objavljeni pogoji ponovne uporabe zahtevajo navedbo vira; pri pogoju samo navedbe vira pisna odločba ni potrebna. To je podlaga za shranjevanje in distribucijo majhne izpeljanke z navedbo »Zavod za gozdove Slovenije – podatki o sestojih; prostorska agregacija MushroomApp«. Ne pripisujemo licence CC ali druge poimenske odprte licence. Izvorni WFS dump ostaja lokalno v ignoriranem cacheu. Pred širšo/komercialno izdajo ponovno preverite veljavne pogoje; ta pregled ni pridobljeno individualno dovoljenje ZGS.

### Postopek in reprodukcija

```powershell
python -m venv scripts/heatmap/.cache/zgs-venv
scripts/heatmap/.cache/zgs-venv/Scripts/python.exe -m pip install -r scripts/heatmap/requirements-zgs.txt
scripts/heatmap/.cache/zgs-venv/Scripts/python.exe scripts/heatmap/enrich_zgs.py
scripts/heatmap/.cache/zgs-venv/Scripts/python.exe scripts/heatmap/test_zgs.py
```

`--refresh` začne novo zajemno sejo; brez njega se nadaljuje ista lokalna seja. Pipeline vedno preveri live shemo in število zadetkov. Vsaka stran ima največ 1.000 sestojev, timeout 45 s in največ tri poskuse. Omejitev 100.000 zadetkov prepreči nenameren nacionalni import. BBox se izračuna iz nespremenjenih habitatnih geometrij; nato se sestoji filtrirajo na unijo dejanskih celic (robne celice lahko malo segajo izven idealnega kroga, tako kot izvorni pilot).

Obdelava in preseki potekajo v EPSG:3794; mobile geometrije ostanejo EPSG:4326. Duplikati feature ID, manjkajoče strani, spremenjeno število zadetkov, neveljavne geometrije ali spremenjena shema ustavijo objavo artefakta. WFS straničenje ni transakcijsko; število in ID kontrole zmanjšajo tveganje, ne zagotavljajo zamrznjenega strežniškega snapshota. Izhod se zamenja šele po celotnem uspehu. Ob neuspelem osveževanju ostane prejšnji preverjeni statični snapshot; celice brez podatka ostajajo WorldCover fallback `unknown`. Mobile ne kliče WFS.

`null` ostane `null`; nenumerične/nefinite vrednosti in vrednosti zunaj 0–100 so zabeležene kot invalidne in izločene. Vsota znanih deležev se preveri: >100,5 izloči sestavo sestoja, druge oddaljenosti od 100 se zabeležijo brez popravljanja. Ničelna vsota ni nadomeščena z domnevno sestavo. Artefakt vsebuje datum zajema, hash sheme/habitatnega vira, rezultate CRS primerjave in statistiko.

### Agregacija in coverage

- `zgsForestCoveredAreaFraction`: površina **unije** vseh sestojnih presekov / površina celice.
- `zgsDataCoverageFraction`: površina unije presekov z veljavnim osnovnim deležem bora / površina celice.
- `pineEvidenceAreaFraction`: površina unije presekov s pozitivnim deležem bora / površina celice. To je površina sestojev z dokazom bora, ne površina borovih krošenj.
- `pineShareAreaWeightedPct`: vsota (površina preseka × delež bora v lesni zalogi) / vsota površin presekov z veljavnim deležem. Enaka metoda za ostale skupine.
- `zgsStandCount`, `zgsPinePositiveStandCount`: število dejanskih presekov s pozitivno površino.

Unije preprečujejo dvojno štetje coverage; prekrivanje >0,001 celice blokira `candidate`, ker uteženo povprečje prekrivajočih sestojev ni nedvoumno. V trenutnem zajemu takega prekrivanja ni. Geometrij se ne popravlja tiho.

### Lactarius politika

Centralno v `src/domain/heatmap/zgs.ts`; vse so inženirske kartografske hevristike:

- WorldCover tree fraction ≥0,30;
- veljavna ZGS coverage ≥0,30;
- delež bora v uteženi lesni zalogi ≥10 **ali** površina sestojev z dokazom bora ≥0,20;
- brez invalidnega pine deleža v celici in brez pomembnega prekrivanja sestojev.

Samo takrat `candidate`. Vsi drugi gozdni primeri ostanejo `unknown`, tudi 0 % bora ob dobri pokritosti: to ne dokazuje odsotnosti bora v preostanku celice. Negozdne celice so `outside-model`. Weather score, dataQuality, Today/Tomorrow in habitat ostalih treh profilov ostanejo nespremenjeni.

### Rezultat zajema

29.902 sestoja v bboxu, 24.244 se jih seka z dejanskim pilotom; vseh 24.244 ima veljaven `lzskdv30`, 8.869 pozitiven. Porazdelitev: 0: 15.375; (0,10): 5.644; [10,25): 1.988; [25,50): 806; [50,100]: 431. 3.511 vsot odstopa od 100 za več kot 0,5, od tega je 3.507 vsot ničelnih; opozorila so ohranjena, podatki niso normalizirani. Veljaven numerični zapis ni zagotovilo popolnosti terenskega popisa, zato ničle ne povzročijo sklepa o odsotnosti bora. Primerjava istega sestoja med obema CRS je pokazala odmik 0,00509 m.

Povprečna coverage celice je 0,469943, razpon 0–1. Lactarius pred: candidate 0, unknown 1.826, outside-model 135. Po: candidate 808, unknown 1.018, outside-model 135.

| Realna celica | WorldCover tree | ZGS coverage | Uteženi bor % | Evidence area | Habitat |
|---|---:|---:|---:|---:|---|
| area-27-29 (visok bor) | 0,9877 | 0,962914 | 77,9556 | 0,962914 | candidate |
| area-01-29 (nizek bor) | 0,9183 | 0,861340 | 0,0171 | 0,006242 | unknown |
| area-00-25 (brez evidentiranega bora) | 0,7328 | 0,597316 | 0 | 0 | unknown |
| area-05-10 (slaba coverage) | 0,3388 | 0,074326 | 0 | 0 | unknown |
| area-11-12 (brez ZGS) | 0,6435 | 0 | null | 0 | unknown |

### Omejitve ZGS

Datum zajema ni datum terenskega popisa; schema ne podaja vintage za posamezni sestoj. Pozitivni bor velja za sestoj, ne za vsak njegov del. Pilot sega tudi v Avstrijo, ki je ZGS ne pokriva. Podatek ne potrjuje vrst bora, mikrolokacije, prisotnosti sirovk ali dostopa. Mobile bere le agregacije brez izvornih sestojnih geometrij. Za širitev so potrebni regionalna preverjanja pokritosti, časovnosti in pravil straničenja ter testiranje na telefonu.
