"""Offline geometry and area-fraction checks; no downloads."""
import json
import unittest
from shapely.geometry import shape, mapping, box
from shapely.ops import transform
from pyproj import Transformer
from prepare_lod import prepare, ROOT, PROFILES


class LodTests(unittest.TestCase):
    def test_area_weighting_not_any_candidate(self):
        class Identity:
            @staticmethod
            def transform(x, y, z=None):
                return (x, y) if z is None else (x, y, z)
        features = []
        for id, polygon, coverage in [('small', box(0, 0, 10, 10), 1), ('large', box(10, 0, 100, 10), 0)]:
            features.append(dict(type='Feature', geometry=mapping(polygon), properties=dict(id=id,
                centerLongitude=polygon.centroid.x, centerLatitude=polygon.centroid.y,
                treeCoverFraction=1, grasslandFraction=0, zgsCoverage=coverage)))
        states = {'small': {p: 'candidate' for p in PROFILES}, 'large': {p: 'unknown' for p in PROFILES}}
        result = prepare(4000, 20000, features, states, Identity(), Identity(), 0, 0)
        p = result['features'][0]['properties']
        self.assertAlmostEqual(p['habitatFractions']['boletusEdulis']['candidate'], .1)
        self.assertAlmostEqual(p['habitatFractions']['boletusEdulis']['unknown'], .9)
        self.assertAlmostEqual(p['zgsDataCoverageFraction'], .1)

    def test_real_artifact(self):
        overview = json.loads((ROOT/'overview.json').read_bytes())
        detail = json.loads((ROOT/'habitat.geojson.json').read_bytes())
        project = Transformer.from_crs(4326, 3035, always_xy=True)
        self.assertEqual(sum(f['properties']['detailCellCount'] for f in overview['features']), len(detail['features']))
        self.assertEqual(len({f['properties']['id'] for f in overview['features']}), len(overview['features']))
        weather_ids = {p['id'] for p in overview['weatherCells']}
        for f in overview['features']:
            self.assertTrue(shape(f['geometry']).is_valid)
            self.assertIn(f['properties']['weatherCellId'], weather_ids)
            for fractions in f['properties']['habitatFractions'].values():
                self.assertAlmostEqual(sum(fractions.values()), 1, places=6)
                self.assertTrue(all(0 <= v <= 1 for v in fractions.values()))
        old_area = sum(transform(project.transform, shape(f['geometry'])).area for f in detail['features'])
        new_area = sum(transform(project.transform, shape(f['geometry'])).area for f in overview['features'])
        self.assertLess(abs(new_area-old_area)/old_area, 1e-6)


if __name__ == '__main__':
    unittest.main()
