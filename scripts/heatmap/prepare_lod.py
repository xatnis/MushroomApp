"""Offline LOD from pinned Regional V2 detail artifacts. No network/raw GIS import.
Default benchmarks 4/5 km habitat and 20/25 km weather; --build writes chosen artifact.
"""
import argparse
import hashlib
import json
import math
import subprocess
from collections import defaultdict
from pathlib import Path
from pyproj import Transformer
from shapely.geometry import shape, mapping
from shapely.ops import transform, unary_union

ROOT = Path('src/data/heatmapRegional')
PROFILES = ['generic', 'boletusEdulis', 'cantharellusCibarius', 'lactariusDeliciosus']


def prepare(size, spacing, features, states, project, inverse, cx, cy):
    groups = defaultdict(list)
    for feature in features:
        p = feature['properties']
        x, y = project.transform(p['centerLongitude'], p['centerLatitude'])
        key = (math.floor((x-cx+500)/size), math.floor((y-cy+500)/size))
        geom = transform(project.transform, shape(feature['geometry']))
        groups[key].append((feature, geom))
    weather = {}
    output = []
    for (col, row), items in sorted(groups.items()):
        geometry = unary_union([g for _, g in items])
        if not geometry.is_valid or geometry.is_empty:
            raise ValueError('Invalid overview union')
        area = sum(g.area for _, g in items)
        point = geometry.representative_point()
        wc, wr = round((point.x-cx)/spacing), round((point.y-cy)/spacing)
        wid = f'overview-{spacing}-weather-{wr}-{wc}'
        wx, wy = cx+wc*spacing, cy+wr*spacing
        lon, lat = inverse.transform(wx, wy)
        weather[wid] = dict(id=wid, latitude=round(lat, 6), longitude=round(lon, 6), projectedX=wx, projectedY=wy)
        lon, lat = inverse.transform(point.x, point.y)
        fractions = {}
        for profile in PROFILES:
            fractions[profile] = {state: round(sum(g.area for f, g in items if states[f['properties']['id']][profile] == state)/area, 8)
                                 for state in ['candidate', 'unknown', 'outside-model']}
        weighted = lambda key: sum(g.area*f['properties'].get(key, 0) for f, g in items)/area
        props = dict(id=f'overview-{size}-{row}-{col}', weatherCellId=wid, centerLatitude=round(lat, 6),
                     centerLongitude=round(lon, 6), treeCoverFraction=weighted('treeCoverFraction'),
                     grasslandFraction=weighted('grasslandFraction'), sourcePixelCount=0,
                     sourceVersion='Regional V2 area-weighted overview', sourceResolutionM=size,
                     detailCellCount=len(items), areaM2=area, habitatFractions=fractions,
                     zgsDataCoverageFraction=sum(g.area*f['properties'].get('zgsCoverage', 0) for f, g in items)/area)
        output.append(dict(type='Feature', geometry=mapping(transform(inverse.transform, geometry)), properties=props))
    return dict(schemaVersion=1, habitatCellSizeM=size, weatherSamplingSpacingM=spacing,
                weatherCells=sorted(weather.values(), key=lambda p: p['id']), type='FeatureCollection', features=output)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--build', action='store_true')
    parser.add_argument('--cell-size', type=int, choices=[4000, 5000], default=4000)
    parser.add_argument('--weather-spacing', type=int, choices=[20000, 25000], default=20000)
    args = parser.parse_args()
    features = json.loads((ROOT/'habitat.geojson.json').read_bytes())['features']
    zgs = json.loads((ROOT/'zgs-enrichment.json').read_bytes())['areas']
    for f in features:
        f['properties']['zgsCoverage'] = zgs.get(f['properties']['id'], {}).get('zgsDataCoverageFraction', 0)
    states = json.loads(subprocess.check_output(['node', 'scripts/runSmoke.cjs', 'scripts/heatmap/exportLodInputs.ts']))
    project = Transformer.from_crs(4326, 3035, always_xy=True)
    inverse = Transformer.from_crs(3035, 4326, always_xy=True)
    cx, cy = project.transform(14.85009, 46.47045)
    for size in ([args.cell_size] if args.build else [4000, 5000]):
        for spacing in ([args.weather_spacing] if args.build else [20000, 25000]):
            result = prepare(size, spacing, features, states, project, inverse, cx, cy)
            result['sources'] = {name: hashlib.sha256((ROOT/name).read_bytes()).hexdigest()
                                 for name in ['habitat.geojson.json', 'zgs-enrichment.json']}
            result['attribution'] = 'ESA WorldCover 2021 v200; Zavod za gozdove Slovenije; geoBoundaries Slovenia. Same reuse terms as Regional V2.'
            # Keep original union boundary; no runtime geometry aggregation or border extrapolation.
            payload = json.dumps(result, separators=(',', ':'), ensure_ascii=False, allow_nan=False)
            print(json.dumps(dict(size=size, spacing=spacing, polygons=len(result['features']),
                                  points=len(result['weatherCells']), bytes=len(payload.encode('utf-8')))))
            if args.build:
                (ROOT/'overview.json').write_text(payload, encoding='utf-8')


if __name__ == '__main__':
    main()
