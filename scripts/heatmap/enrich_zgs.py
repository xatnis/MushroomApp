"""Bounded, resumable ZGS WFS enrichment; no mobile requests or weather changes."""
from __future__ import annotations

import argparse
from collections import Counter
from datetime import datetime, timezone
import hashlib
import json
import math
from pathlib import Path
import time
from urllib.parse import urlencode
from urllib.request import urlopen
import xml.etree.ElementTree as ET

from pyproj import Transformer
from shapely.geometry import shape, box
from shapely.ops import transform, unary_union
from shapely.strtree import STRtree

ENDPOINT = 'https://prostor.zgs.gov.si/geoserver/wfs'
LAYER = 'pregledovalnik:sestoji'
FIELDS = dict(zip(['lzskdv11', 'lzskdv21', 'lzskdv30', 'lzskdv34', 'lzskdv39',
                   'lzskdv41', 'lzskdv50', 'lzskdv60', 'lzskdv70', 'lzskdv80'],
                  ['spruce', 'fir', 'pine', 'larch', 'otherConifers', 'beech', 'oak',
                   'nobleBroadleaves', 'hardBroadleaves', 'softBroadleaves']))
BASE = {'service': 'WFS', 'version': '2.0.0'}


def request(params):
    url = ENDPOINT + '?' + urlencode({**BASE, **params})
    for attempt in range(3):
        try:
            with urlopen(url, timeout=45) as response:
                return response.read()
        except Exception:
            if attempt == 2:
                raise
            time.sleep(2 ** attempt)


def parse_share(value):
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, (float, int)) or not math.isfinite(value) or not 0 <= value <= 100:
        raise ValueError(f'Invalid growing-stock share: {value!r}')
    return float(value)


def validate_schema():
    capabilities = request({'request': 'GetCapabilities'})
    root = ET.fromstring(capabilities)
    ns = {'w': 'http://www.opengis.net/wfs/2.0', 'o': 'http://www.opengis.net/ows/1.1'}
    layer = next((f for f in root.findall('.//w:FeatureType', ns) if f.findtext('w:Name', namespaces=ns) == LAYER), None)
    if layer is None or layer.findtext('w:DefaultCRS', namespaces=ns) != 'urn:ogc:def:crs:EPSG::3794':
        raise ValueError('Layer/default CRS differs from verified contract')
    if not any(c.attrib.get('name') == 'ImplementsResultPaging' and 'TRUE' in ''.join(c.itertext())
               for c in root.iter()):
        raise ValueError('WFS pagination is not advertised')
    if 'application/json' not in ''.join(root.itertext()):
        raise ValueError('JSON output not advertised')
    schema = request({'request': 'DescribeFeatureType', 'typeNames': LAYER})
    elements = {e.attrib['name']: e.attrib.get('type') for e in ET.fromstring(schema).iter()
                if e.tag.endswith('element') and 'name' in e.attrib}
    for field in ['ggo', 'odsek', 'sestoj', 'povrsina', 'rfaza', 'rfaza_naziv', *FIELDS]:
        if field not in elements:
            raise ValueError(f'Missing required schema field {field}')
    if elements.get('geom') != 'gml:MultiSurfacePropertyType' or any(elements[f] != 'xsd:decimal' for f in FIELDS):
        raise ValueError('Geometry/share field types changed')
    return capabilities, schema, elements


def aggregate(cell, intersections):
    """intersections are (clipped geometry, validated shares); coverage uses unions."""
    covered = [g for g, _ in intersections]
    valid = [(g, p) for g, p in intersections if p.get('pine') is not None]
    pine = [g for g, p in valid if p['pine'] > 0]
    union_area = unary_union(covered).area if covered else 0
    valid_area = unary_union([g for g, _ in valid]).area if valid else 0
    overlap = max(0, sum(g.area for g in covered) - union_area)
    result = {
        'zgsAvailable': bool(covered),
        'zgsForestCoveredAreaFraction': round(union_area / cell.area, 6),
        'zgsDataCoverageFraction': round(valid_area / cell.area, 6),
        'pineEvidenceAreaFraction': round(unary_union(pine).area / cell.area, 6) if pine else 0,
        'zgsStandCount': len(covered),
        'zgsPinePositiveStandCount': len(pine),
        'overlapAreaFraction': round(overlap / cell.area, 6),
        'invalidPineStandCount': sum(p.get('_invalidPine', False) for _, p in intersections),
    }
    for name in FIELDS.values():
        values = [(g.area, p[name]) for g, p in intersections if p.get(name) is not None]
        result[name + 'ShareAreaWeightedPct'] = round(sum(a * v for a, v in values) / sum(a for a, _ in values), 4) if values else None
    return result


def validate_axis_order(feature):
    sample = json.loads(request({'request': 'GetFeature', 'typeNames': LAYER,
                                 'resourceID': feature['id'], 'count': 1,
                                 'srsName': 'EPSG:4326', 'outputFormat': 'application/json'}))
    if len(sample['features']) != 1 or sample['features'][0]['id'] != feature['id']:
        raise ValueError('Cross-CRS sample identity mismatch')
    wgs = shape(sample['features'][0]['geometry'])
    to_metric = Transformer.from_crs(4326, 3794, always_xy=True)
    distance = transform(to_metric.transform, wgs).hausdorff_distance(shape(feature['geometry']))
    if not math.isfinite(distance) or distance > 2:
        raise ValueError('EPSG:4326 lon/lat vs EPSG:3794 easting/northing mismatch')
    return {'featureId': feature['id'], 'hausdorffDistanceM': round(distance, 6),
            'geojson4326AxisOrder': 'longitude,latitude', 'geojson3794AxisOrder': 'easting,northing'}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--data-dir', default='src/data/heatmapPilot')
    parser.add_argument('--cache-dir', default='scripts/heatmap/.cache/zgs')
    parser.add_argument('--refresh', action='store_true')
    args = parser.parse_args()
    directory = Path(args.data_dir)
    metadata = json.loads((directory / 'metadata.json').read_text(encoding='utf-8'))
    habitat_bytes = (directory / 'habitat.geojson.json').read_bytes()
    habitat = json.loads(habitat_bytes)
    if metadata['radiusM'] > 25000 or metadata['habitatPolygonCount'] != len(habitat['features']):
        raise ValueError('This importer is limited to the existing 25 km pilot')
    capabilities, schema, elements = validate_schema()
    project = Transformer.from_crs(4326, 3794, always_xy=True)
    inverse = Transformer.from_crs(3794, 4326, always_xy=True)
    cells = [transform(project.transform, shape(f['geometry'])) for f in habitat['features']]
    aoi = unary_union(cells)
    bounds = aoi.bounds
    bbox = ','.join(str(v) for v in bounds) + ',EPSG:3794'
    params = {'request': 'GetFeature', 'typeNames': LAYER, 'bbox': bbox,
              'srsName': 'EPSG:3794', 'outputFormat': 'application/json', 'sortBy': 'ggo,odsek,sestoj'}
    hits = ET.fromstring(request({**params, 'resultType': 'hits'}))
    total = int(hits.attrib['numberMatched'])
    if total > 100000:
        raise ValueError('Bounded pilot safety limit exceeded')
    # Cache is pinned to one acquisition session and AOI/schema, never mixed across refreshes.
    signature = hashlib.sha256((bbox + hashlib.sha256(schema).hexdigest()).encode()).hexdigest()[:16]
    cache = Path(args.cache_dir) / signature
    cache.mkdir(parents=True, exist_ok=True)
    session_path = cache / 'session.json'
    session = json.loads(session_path.read_text()) if session_path.exists() and not args.refresh else None
    if session and session['numberMatched'] != total:
        raise ValueError('WFS changed since cached session: rerun with --refresh')
    if session is None:
        session = {'numberMatched': total, 'fetchedAt': datetime.now(timezone.utc).isoformat(), 'run': str(time.time_ns())}
        session_path.write_text(json.dumps(session), encoding='utf-8')
    cache = cache / session['run']
    cache.mkdir(exist_ok=True)
    (cache / 'capabilities.xml').write_bytes(capabilities)
    (cache / 'schema.xml').write_bytes(schema)
    geometries, properties, ids = [], [], set()
    warnings = Counter()
    pine_values = []
    downloaded = 0
    axis_validation = None
    for start in range(0, total, 1000):
        page_path = cache / f'{start}.json'
        if page_path.exists():
            data = json.loads(page_path.read_bytes())
        else:
            payload = request({**params, 'count': 1000, 'startIndex': start})
            data = json.loads(payload)
            page_path.write_bytes(payload)
        if data.get('numberMatched') != total or len(data['features']) != min(1000, total-start):
            raise ValueError('Incomplete/inconsistent WFS page; no artifact published')
        if not data.get('crs', {}).get('properties', {}).get('name', '').endswith('3794'):
            raise ValueError('Unexpected response CRS')
        if start == 0 and data['features']:
            axis_validation = validate_axis_order(data['features'][0])
        for feature in data['features']:
            if feature['id'] in ids:
                raise ValueError('Duplicate WFS ID across pages; no artifact published')
            ids.add(feature['id'])
            downloaded += 1
            geometry = shape(feature['geometry'])
            if geometry.is_empty or not geometry.is_valid or geometry.geom_type not in ('Polygon', 'MultiPolygon'):
                # Do not silently repair geometries and fabricate reliable coverage.
                raise ValueError(f'Invalid geometry: {feature["id"]}')
            if not geometry.intersects(box(*bounds)):
                raise ValueError('Feature outside requested BBOX / axis-order error')
            if not geometry.intersects(aoi):
                continue
            point = geometry.representative_point()
            lon, lat = inverse.transform(point.x, point.y)
            if not (13 < lon < 17 and 45 < lat < 48):
                raise ValueError('Projected geometry axis-order validation failed')
            shares = {}
            for field, name in FIELDS.items():
                try:
                    shares[name] = parse_share(feature['properties'].get(field))
                except ValueError:
                    warnings['invalid_' + field] += 1
                    shares[name] = None
                    if name == 'pine':
                        shares['_invalidPine'] = True
            known_sum = sum(v for k, v in shares.items() if not k.startswith('_') and v is not None)
            if known_sum > 100.5:
                warnings['impossibleShareSum'] += 1
                shares = {name: None for name in FIELDS.values()} | {'_invalidPine': True}
            elif abs(known_sum - 100) > 0.5:
                warnings['shareSumNotNear100'] += 1
                if known_sum == 0:
                    warnings['zeroShareSum'] += 1
            if shares['pine'] is not None:
                pine_values.append(shares['pine'])
            geometries.append(geometry)
            properties.append(shares)
        print(f'WFS {min(start+1000,total)}/{total}', flush=True)
    end_hits = ET.fromstring(request({**params, 'resultType': 'hits'}))
    if int(end_hits.attrib['numberMatched']) != total:
        raise ValueError('WFS changed while importing')
    tree = STRtree(geometries)
    by_area = {}
    for feature, cell in zip(habitat['features'], cells):
        intersections = []
        for index in tree.query(cell, predicate='intersects'):
            clipped = cell.intersection(geometries[index])
            if clipped.area > 0:
                intersections.append((clipped, properties[index]))
        by_area[feature['properties']['id']] = aggregate(cell, intersections)
    distribution = {label: sum(lo <= v < hi for v in pine_values) for label, lo, hi in
                    [('zero', 0, 0.000001), ('0to10', 0.000001, 10), ('10to25', 10, 25), ('25to50', 25, 50), ('50to100', 50, 101)]}
    artifact = {
        'schemaVersion': 1, 'pilotId': metadata['pilotId'], 'fetchedAt': session['fetchedAt'],
        'source': 'Zavod za gozdove Slovenije – podatki o sestojih', 'sourceSchemaVersion': 'opis podatkov 2.8 / WFS live',
        'endpoint': ENDPOINT, 'layer': LAYER, 'wfsVersion': '2.0.0', 'crs': 'EPSG:3794',
        'habitatSha256': hashlib.sha256(habitat_bytes).hexdigest(),
        'axisValidation': axis_validation,
        'schemaSha256': hashlib.sha256(schema).hexdigest(),
        'fieldTypes': {f: elements[f] for f in ['geom', 'ggo', 'odsek', 'sestoj', 'povrsina', 'rfaza', 'rfaza_naziv', *FIELDS]},
        'reuse': {'status': 'source attribution required; no named open license asserted',
                  'termsUrl': 'https://www.zgs.si/informacije/informacije-javnega-znacaja/',
                  'attribution': 'Zavod za gozdove Slovenije – podatki o sestojih; prostorska agregacija MushroomApp'},
        'stats': {'bboxStandCount': downloaded, 'aoiStandCount': len(geometries), 'validPineStandCount': len(pine_values),
                  'pinePositiveStandCount': sum(v > 0 for v in pine_values), 'pineDistribution': distribution, 'warnings': dict(warnings)},
        'areas': by_area,
    }
    temporary = directory / 'zgs-enrichment.json.tmp'
    temporary.write_text(json.dumps(artifact, ensure_ascii=False, separators=(',', ':'), allow_nan=False), encoding='utf-8')
    temporary.replace(directory / 'zgs-enrichment.json')
    print(json.dumps(artifact['stats'], ensure_ascii=False), flush=True)


if __name__ == '__main__':
    main()
