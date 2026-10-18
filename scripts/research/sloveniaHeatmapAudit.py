"""Audit only: existing pinned boundary/grid, no production artifact writes or GIS downloads.
Run from repo root with the existing GIS venv. National habitat is NOT manufactured.
"""
import argparse
import gzip
import hashlib
import json
import math
import platform
import time
from collections import defaultdict
from pathlib import Path

from pyproj import Transformer
from shapely.geometry import Point, box, mapping, shape
from shapely.ops import transform, unary_union

ROOT = Path(__file__).resolve().parents[2]
BOUNDARY = ROOT / 'scripts/heatmap/.cache/regional/slovenia.geojson'
SHA = '9df0ad9979ff342ea79d11b046e0ed0d0b08763b6e618d54f7b37152768c92fe'
REGIONS = [
    ('Koroska', 46.47045, 14.85009), ('Gorenjska-alpine', 46.33, 13.85),
    ('Pohorje', 46.50, 15.50), ('Central-Slovenia', 46.05, 14.50),
    ('Primorska', 45.85, 13.95), ('Kocevje-Dolenjska', 45.65, 14.85),
]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path)
    parser.add_argument('--fixture', type=Path, help='Optional audit-only national geometry, no habitat values')
    args = parser.parse_args()
    started = time.perf_counter()
    raw = BOUNDARY.read_bytes()
    assert hashlib.sha256(raw).hexdigest() == SHA, 'Use the existing checksum-pinned boundary; no silent update'
    project = Transformer.from_crs(4326, 3035, always_xy=True)
    inverse = Transformer.from_crs(3035, 4326, always_xy=True)
    country = transform(project.transform, unary_union([shape(f['geometry']) for f in json.loads(raw)['features']]))
    assert country.is_valid and not country.is_empty
    cx, cy = project.transform(14.85009, 46.47045)
    cells = []
    left, bottom, right, top = country.bounds
    for row in range(math.floor((bottom - cy) / 1000) - 1, math.ceil((top - cy) / 1000) + 2):
        for col in range(math.floor((left - cx) / 1000) - 1, math.ceil((right - cx) / 1000) + 2):
            x, y = cx + col * 1000, cy + row * 1000
            geom = box(x - 500, y - 500, x + 500, y + 500).intersection(country)
            if not geom.is_empty and geom.area > 0:
                p = geom.representative_point()
                cells.append((row, col, geom, p))
    weather10 = {(round((p.x - cx) / 10000), round((p.y - cy) / 10000)) for _, _, _, p in cells}
    # Same rounding/representative-point grouping used by existing prepare_lod.py.
    groups = defaultdict(list)
    for row, col, geom, point in cells:
        groups[(math.floor((point.x - cx + 500) / 4000), math.floor((point.y - cy + 500) / 4000))].append(geom)
    coarse = [unary_union(geoms) for geoms in groups.values()]
    weather20 = {(round((g.representative_point().x - cx) / 20000), round((g.representative_point().y - cy) / 20000)) for g in coarse}
    centre_outside = lambda keys, spacing: sum(not country.covers(Point(cx + c * spacing, cy + r * spacing)) for c, r in keys)
    regional_geom = shape(json.loads((ROOT / 'src/data/heatmapRegional/coverage.geojson.json').read_text())['geometry'])
    regional_area = transform(project.transform, regional_geom).area / 1e6
    habitat = json.loads((ROOT / 'src/data/heatmapRegional/habitat.geojson.json').read_text())['features']
    metadata = json.loads((ROOT / 'src/data/heatmapRegional/metadata.json').read_text())
    overview = json.loads((ROOT / 'src/data/heatmapRegional/overview.json').read_text())
    # Independently count the full existing 75km AOI from the established phase, no area/cell extrapolation.
    regional_aoi = country.intersection(Point(cx, cy).buffer(75000, quad_segs=128))
    regional_count = sum(not (cut := g.intersection(regional_aoi)).is_empty and cut.area > 0 for _, _, g, _ in cells)
    assert regional_count == len(habitat) == 10531
    vertices = lambda geom: sum(len(ring) for polygon in ([geom['coordinates']] if geom['type'] == 'Polygon' else geom['coordinates']) for ring in polygon)
    national_features = []
    for row, col, geom, point in cells:
        lon, lat = inverse.transform(point.x, point.y)
        c, r = round((point.x - cx) / 10000), round((point.y - cy) / 10000)
        national_features.append(dict(type='Feature', id=f'audit-{row}-{col}', geometry=mapping(transform(inverse.transform, geom)),
            properties=dict(id=f'audit-{row}-{col}', weatherCellId=f'audit-weather-{r}-{c}', centerLatitude=round(lat, 6), centerLongitude=round(lon, 6))))
    collection = dict(type='FeatureCollection', features=national_features)
    payload = json.dumps(collection, separators=(',', ':')).encode()
    regions = []
    for name, lat, lon in REGIONS:
        x, y = project.transform(lon, lat)
        visible = box(x - 7500, y - 11000, x + 7500, y + 11000)
        buffered = box(x - 10500, y - 15400, x + 10500, y + 15400)
        vs = [(g, p) for _, _, g, p in cells if g.intersects(visible)]
        bs = [(g, p) for _, _, g, p in cells if g.intersects(buffered)]
        zooms = []
        for zoom in [6, 9.2, 10.5, 12]:
            metres_per_dp = 40075016.7 * math.cos(math.radians(lat)) / (512 * 2**zoom)
            w, h = 360 * metres_per_dp, 480 * metres_per_dp
            viewport = box(x-w/2, y-h/2, x+w/2, y+h/2)
            overscan = box(x-w*.7, y-h*.7, x+w*.7, y+h*.7)
            detail = [(g, p) for _, _, g, p in cells if g.intersects(overscan)]
            zooms.append(dict(zoom=zoom, assumedMapDp=[360, 480], metresPerDp=metres_per_dp,
                visibleDetailCells=sum(g.intersects(viewport) for _, _, g, _ in cells), bufferedDetailCells=len(detail),
                visibleOverviewCells=sum(g.intersects(viewport) for g in coarse),
                bufferedWeather10km=len({(round((p.x-cx)/10000), round((p.y-cy)/10000)) for _, p in detail})))
        regions.append(dict(name=name, publicCoordinate=[lat, lon], metricViewportKm=[15, 22], overscan=.2,
            visibleCells=len(vs), bufferedCells=len(bs), weather10km=len({(round((p.x-cx)/10000), round((p.y-cy)/10000)) for _, p in bs})))
        regions[-1]['zoomScenarios'] = zooms
        wx, wy = cx + round((x-cx)/10000)*10000, cy + round((y-cy)/10000)*10000
        wl, wa = inverse.transform(wx, wy)
        regions[-1]['weatherCentre10km'] = [round(wa, 6), round(wl, 6)]
    result = dict(auditOnly=True, environment=f'{platform.system()} Python {platform.python_version()}, not Android',
        boundarySha256=SHA, boundaryVintage=2009, nationalAreaKm2=country.area/1e6, nationalBbox=list(transform(inverse.transform, country).bounds),
        phase3035=[cx, cy], detailCells=len(cells), detailPartialBorderCells=sum(g.area < 999999.99 for _, _, g, _ in cells),
        detailWeatherLocations=len(weather10), detailWeatherCentresOutsideBoundary=centre_outside(weather10, 10000),
        overviewCells=len(coarse), overviewWeatherLocations=len(weather20), overviewWeatherCentresOutsideBoundary=centre_outside(weather20, 20000),
        combinedWeatherLocationsByExactGrid=len(weather10 | {(c*2, r*2) for c, r in weather20}),
        actualRegional=dict(areaKm2=regional_area, detailCells=len(habitat), weatherLocations=len(metadata['weatherCells']),
            overviewCells=len(overview['features']), overviewWeatherLocations=len(overview['weatherCells']),
            treeCandidateCells=sum(f['properties']['treeCoverFraction'] >= .3 for f in habitat),
            genericCandidateCells=sum(f['properties']['treeCoverFraction'] + f['properties']['grasslandFraction'] >= .2 for f in habitat)),
        nationalHabitatFilteredCount=None, nationalHabitatCountReason='No national WorldCover/ZGS aggregates are committed; not extrapolated as measured counts.',
        geometryOnly=dict(rawBytes=len(payload), gzipBytes=len(gzip.compress(payload, mtime=0)), vertices=sum(vertices(f['geometry']) for f in national_features)),
        combinations=dict(detail=len(cells)*7*4, overview=len(coarse)*7*4, weatherOnlyDetail=len(weather10)*7*4, weatherOnlyOverview=len(weather20)*7*4),
        regions=regions, elapsedSeconds=time.perf_counter()-started)
    text = json.dumps(result, indent=2)
    for path, content in [(args.output, text), (args.fixture, payload.decode())]:
        if path:
            path = path.resolve()
            assert path.is_relative_to((ROOT/'docs/research').resolve()), 'Audit outputs only, never production assets'
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(content, encoding='utf-8')
    print(text)


if __name__ == '__main__':
    main()
