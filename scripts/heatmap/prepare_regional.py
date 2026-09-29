"""Regional V2: pinned Slovenia boundary, legacy-aligned 1 km grid, 75 km AOI.

Default is a cheap dry run. --build reads bounded WorldCover COG windows.
Pilot artifacts are immutable regression fixtures; clipped cells receive new IDs.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path
from urllib.request import urlopen

from pyproj import Transformer
from shapely.geometry import shape, mapping, Point, box
from shapely.ops import transform, unary_union

BOUNDARY_URL = 'https://media.githubusercontent.com/media/wmgeolab/geoBoundaries/9469f09/releaseData/gbOpen/SVN/ADM0/geoBoundaries-SVN-ADM0.geojson'
BOUNDARY_METADATA = 'https://www.geoboundaries.org/api/current/gbOpen/SVN/ADM0/'
BOUNDARY_SHA256 = '9df0ad9979ff342ea79d11b046e0ed0d0b08763b6e618d54f7b37152768c92fe'
ROOT = Path('src/data/heatmapRegional')
PILOT = Path('src/data/heatmapPilot')
CACHE = Path('scripts/heatmap/.cache/regional')


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + '.tmp')
    temporary.write_text(json.dumps(value, ensure_ascii=False, separators=(',', ':'), allow_nan=False), encoding='utf-8')
    temporary.replace(path)


def layout():
    CACHE.mkdir(parents=True, exist_ok=True)
    boundary_path = CACHE / 'slovenia.geojson'
    if not boundary_path.exists() or boundary_path.read_bytes().startswith(b'version https://git-lfs'):
        with urlopen(BOUNDARY_URL, timeout=60) as response:
            payload = response.read()
        json.loads(payload)  # Reject HTML errors / Git LFS pointers before caching.
        boundary_path.write_bytes(payload)
    if hashlib.sha256(boundary_path.read_bytes()).hexdigest() != BOUNDARY_SHA256:
        raise ValueError('Pinned boundary checksum mismatch')
    data = json.loads(boundary_path.read_bytes())
    boundary = unary_union([shape(f['geometry']) for f in data['features']])
    if not boundary.is_valid or boundary.is_empty:
        raise ValueError('Invalid Slovenia boundary')
    to_metric = Transformer.from_crs(4326, 3035, always_xy=True)
    to_wgs = Transformer.from_crs(3035, 4326, always_xy=True)
    cx, cy = to_metric.transform(14.85009, 46.47045)
    aoi = transform(to_metric.transform, boundary).intersection(Point(cx, cy).buffer(75000, quad_segs=128))
    old = {f['properties']['id']: f for f in json.loads((PILOT/'habitat.geojson.json').read_bytes())['features']}
    cells = []
    for row in range(-76, 77):
        for col in range(-76, 77):
            x, y = cx + col*1000, cy + row*1000
            square = box(x-500, y-500, x+500, y+500)
            clipped = square.intersection(aoi)
            if clipped.is_empty or clipped.area <= 0:
                continue
            legacy_id = f'area-{row+25:02d}-{col+25:02d}'
            legacy = old.get(legacy_id)
            # Preserve the exact rounded legacy geometry only when fully inside AOI.
            if legacy and aoi.covers(transform(to_metric.transform, shape(legacy['geometry']))):
                cells.append((legacy_id, transform(to_metric.transform, shape(legacy['geometry'])), legacy))
            else:
                cells.append((f'regional-{row}-{col}', clipped, None))
    metadata = json.loads((PILOT/'metadata.json').read_bytes())
    weather = {p['id']: p for p in metadata['weatherCells']}
    for _, cell, legacy in cells:
        if legacy:
            continue
        p = cell.representative_point()
        r, c = round((p.y-cy)/10000), round((p.x-cx)/10000)
        wid = f'weather-{r+2}-{c+2}' if -2<=r<=2 and -2<=c<=2 else f'regional-weather-{r}-{c}'
        lon, lat = to_wgs.transform(cx+c*10000, cy+r*10000)
        weather.setdefault(wid, dict(id=wid, latitude=round(lat,6), longitude=round(lon,6), projectedX=round(cx+c*10000,2), projectedY=round(cy+r*10000,2)))
    return aoi, cells, list(weather.values()), to_metric, to_wgs, metadata


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--build', action='store_true')
    args = parser.parse_args()
    aoi, cells, weather, to_metric, to_wgs, metadata = layout()
    baseline_bytes = sum((PILOT/name).stat().st_size for name in ['habitat.geojson.json','zgs-enrichment.json','metadata.json'])
    report = dict(surfaceKm2=aoi.area/1e6, cells=len(cells), factor=len(cells)/1961,
                  unchangedPilotCells=sum(legacy is not None for _,_,legacy in cells), weatherPoints=len(weather),
                  estimatedDerivedBytes=round(baseline_bytes*len(cells)/1961),
                  estimatedZgsStands=round(24244*aoi.area/1961e6),
                  boundarySource=BOUNDARY_URL, boundaryVintage=2009, boundaryLicense='Public Domain (geoBoundaries metadata); geoBoundaries attribution retained')
    write_json(CACHE/'dry-run.json', report)
    print(json.dumps(report, indent=2), flush=True)
    if not args.build:
        return
    import numpy as np
    from shapely import contains_xy
    from prepare_pilot import read_worldcover_subsets, WORLD_COVER_TREE_CODE, WORLD_COVER_GRASSLAND_CODE
    # Only bounded original COG reads, per 10 km row band: avoids a 150 km raster in memory.
    features = []
    bands = {}
    for entry in cells:
        bands.setdefault(math.floor(entry[1].centroid.y/10000), []).append(entry)
    progress = 0
    for band in sorted(bands):
        entries = bands[band]
        new_geometry = unary_union([g for _,g,legacy in entries if not legacy])
        bounds = transform(to_wgs.transform, new_geometry).bounds
        subsets = read_worldcover_subsets(bounds) if not new_geometry.is_empty else []
        for area_id, cell, legacy in entries:
            if legacy:
                features.append(legacy)
                continue
            wgs = transform(to_wgs.transform, cell)
            valid_count = tree_count = grass_count = 0
            for subset in subsets:
                left,bottom,right,top = wgs.bounds
                t = subset.transform
                c0=max(0,int(math.floor((left-t.c)/t.a))); c1=min(subset.data.shape[1],int(math.ceil((right-t.c)/t.a)))
                r0=max(0,int(math.floor((t.f-top)/-t.e))); r1=min(subset.data.shape[0],int(math.ceil((t.f-bottom)/-t.e)))
                if c0>=c1 or r0>=r1: continue
                lon,lat=np.meshgrid(t.c+(np.arange(c0,c1)+.5)*t.a,t.f+(np.arange(r0,r1)+.5)*t.e)
                xs,ys=to_metric.transform(lon,lat)
                values=subset.data[r0:r1,c0:c1]
                valid=contains_xy(cell,xs,ys)&(values!=0)
                valid_count+=int(np.count_nonzero(valid))
                tree_count+=int(np.count_nonzero(valid&(values==WORLD_COVER_TREE_CODE)))
                grass_count+=int(np.count_nonzero(valid&(values==WORLD_COVER_GRASSLAND_CODE)))
            if not valid_count:
                # A very small boundary sliver can contain no 10 m pixel centre.
                # Omit it instead of inventing a zero vegetation measurement.
                continue
            p=cell.representative_point(); lon,lat=to_wgs.transform(p.x,p.y)
            nearest=min(weather,key=lambda w:(w['projectedX']-p.x)**2+(w['projectedY']-p.y)**2)
            features.append(dict(type='Feature',id=area_id,geometry=mapping(wgs),properties=dict(
                id=area_id,weatherCellId=nearest['id'],centerLatitude=round(lat,6),centerLongitude=round(lon,6),
                treeCoverFraction=round(tree_count/valid_count,4),grasslandFraction=round(grass_count/valid_count,4),
                sourcePixelCount=valid_count,sourceVersion='ESA WorldCover 2021 v200',sourceResolutionM=10)))
        progress+=len(entries)
        print(f'WorldCover {progress}/{len(cells)}',flush=True)
        del subsets
    features.sort(key=lambda f:f['properties']['id'])
    extent = transform(to_wgs.transform,aoi)
    metadata.update(pilotId='slovenia-regional-v2',label='Regional Heatmap V2',radiusM=75000,
        bbox=list(extent.bounds),habitatPolygonCount=len(features),weatherCells=weather,weatherCellCount=len(weather),
        generatedBy='scripts/heatmap/prepare_regional.py',surfaceKm2=aoi.area/1e6,
        boundary=dict(url=BOUNDARY_URL,metadataUrl=BOUNDARY_METADATA,sha256=hashlib.sha256((CACHE/'slovenia.geojson').read_bytes()).hexdigest(),
                      vintage=2009,license='Public Domain',attribution='geoBoundaries (William & Mary), source Wikipedia; Slovenia ADM0'))
    write_json(ROOT/'habitat.geojson.json',dict(type='FeatureCollection',features=features))
    write_json(ROOT/'metadata.json',metadata)
    write_json(ROOT/'coverage.geojson.json',dict(type='Feature',properties={},geometry=mapping(extent)))
    print(f'Published {len(features)} cells',flush=True)


if __name__ == '__main__': main()
