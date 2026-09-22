"""Focused GIS tests, no remote dependency."""
import unittest
from shapely.geometry import box
from enrich_zgs import parse_share, aggregate


class ZgsTests(unittest.TestCase):
    def test_share(self):
        self.assertIsNone(parse_share(None))
        self.assertEqual(parse_share(0), 0)
        self.assertEqual(parse_share(100), 100)
        for value in [-1, 101, float('nan'), float('inf'), '5', True]:
            with self.assertRaises(ValueError):
                parse_share(value)

    def test_weighted_multiple_stands(self):
        cell = box(0, 0, 100, 100)
        result = aggregate(cell, [(box(0, 0, 20, 100), {'pine': 50}),
                                  (box(20, 0, 80, 100), {'pine': 10})])
        self.assertEqual(result['pineShareAreaWeightedPct'], 20)
        self.assertEqual(result['zgsDataCoverageFraction'], .8)
        self.assertEqual(result['pineEvidenceAreaFraction'], .8)
        self.assertEqual(result['zgsStandCount'], 2)
        self.assertEqual(result['zgsPinePositiveStandCount'], 2)

    def test_missing_is_not_zero(self):
        result = aggregate(box(0, 0, 100, 100), [
            (box(0, 0, 50, 100), {'pine': None}), (box(50, 0, 100, 100), {'pine': 0})])
        self.assertEqual(result['zgsForestCoveredAreaFraction'], 1)
        self.assertEqual(result['zgsDataCoverageFraction'], .5)
        self.assertEqual(result['pineShareAreaWeightedPct'], 0)
        self.assertEqual(result['pineEvidenceAreaFraction'], 0)
        self.assertIsNone(aggregate(box(0, 0, 1, 1), [])['pineShareAreaWeightedPct'])

    def test_union_coverage_and_overlap(self):
        result = aggregate(box(0, 0, 100, 100), [
            (box(0, 0, 70, 100), {'pine': 10}), (box(50, 0, 100, 100), {'pine': 20})])
        self.assertEqual(result['zgsDataCoverageFraction'], 1)
        self.assertEqual(result['overlapAreaFraction'], .2)


if __name__ == '__main__':
    unittest.main()
