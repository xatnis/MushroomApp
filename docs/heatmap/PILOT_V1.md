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

ZGS WFS na `https://prostor.zgs.gov.si/geoserver/wfs` je bil preverjen. Sloj `pregledovalnik:sestoji` obstaja, vendar v tej fazi ni bil uporabljen: pomen šifriranih atributov drevesne sestave in pogoji njihove nadaljnje uporabe niso bili dovolj zanesljivo potrjeni. Pilot zato ne sklepa, da splošni drevesni pokrov pomeni bor.

## Habitatna pravila

Centralizirana pragova sta kartografski hevristiki:

- `PILOT_MIN_TREE_COVER_FRACTION = 0.30`
- `PILOT_MIN_VEGETATION_FRACTION = 0.20`

Pravila:

- Splošno: `candidate`, če je vsota drevesnega pokrova in travinja vsaj 0,20.
- Jesenski goban: `candidate`, če je drevesni pokrov vsaj 0,30.
- Navadna lisička: `candidate`, če je drevesni pokrov vsaj 0,30.
- Užitna sirovka: pri WorldCover drevesnem pokrovu je stanje `unknown`, ker drevesna vrsta ni potrjena; sicer `outside-model`.

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
- WorldCover ne določa drevesnih vrst; Lactarius habitat ostane neznan brez preverjenega podatka o boru.
- Ni nacionalnega tile strežnika, PostGIS backenda ali samodejnega osveževanja.
- Danes/Jutri sta vremenski presoji, ne napovedi pojava trosnjakov.
