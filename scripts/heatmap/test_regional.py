"""Offline Regional V2 geometry/baseline checks; no weather or GIS downloads."""
import json
import unittest
from pathlib import Path
from shapely.geometry import shape
from shapely.ops import transform
from pyproj import Transformer
from prepare_regional import layout, ROOT, PILOT


class RegionalTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.aoi, cls.cells, cls.weather, cls.project, _, _ = layout()
        cls.data = json.loads((ROOT/'habitat.geojson.json').read_bytes())
        cls.old = {f['properties']['id']: f for f in json.loads((PILOT/'habitat.geojson.json').read_bytes())['features']}

    def test_unique_stable_ids(self):
        ids = [f['properties']['id'] for f in self.data['features']]
        self.assertEqual(len(ids), len(set(ids)))
        self.assertEqual(set(ids), {i for i, _, _ in self.cells})

    def test_clipped_geometry(self):
        for feature in self.data['features']:
            polygon = transform(self.project.transform, shape(feature['geometry']))
            self.assertTrue(polygon.is_valid)
            self.assertLess(polygon.difference(self.aoi.buffer(.01)).area, .01)
            self.assertGreater(feature['properties']['sourcePixelCount'], 0)

    def test_legacy_exact(self):
        legacy = [f for f in self.data['features'] if f['properties']['id'].startswith('area-')]
        self.assertEqual(len(legacy), 1353)
        for f in legacy:
            self.assertEqual(f, self.old[f['properties']['id']])

    def test_weather_mapping(self):
        ids = {w['id'] for w in self.weather}
        self.assertEqual(len(ids), 126)
        for f in self.data['features']:
            self.assertIn(f['properties']['weatherCellId'], ids)

    def test_regional_zgs_when_available(self):
        path = ROOT/'zgs-enrichment.json'
        if not path.exists():
            self.skipTest('Regional ZGS acquisition not finished')
        zgs = json.loads(path.read_bytes())
        baseline = json.loads((PILOT/'zgs-enrichment.json').read_bytes())
        self.assertTrue(zgs['stats']['pagingComplete'])
        self.assertEqual(zgs['stats']['requestedCount'], zgs['stats']['uniqueFeatureCount'])
        self.assertEqual(set(zgs['areas']), {f['properties']['id'] for f in self.data['features']})
        for area, values in zgs['areas'].items():
            if area.startswith('area-'):
                self.assertEqual(values, baseline['areas'][area])


if __name__ == '__main__':
    unittest.main()
