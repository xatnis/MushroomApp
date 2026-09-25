"""Focused GIS tests, no remote dependency."""
import unittest
from shapely.geometry import box
from enrich_zgs import parse_share, aggregate, boletus_host_share, BOLETUS_HOSTS, chanterelle_host_share, CHANTERELLE_HOSTS


class ZgsTests(unittest.TestCase):
    def test_chanterelle_parsing_and_missing(self):
        zero = dict.fromkeys(CHANTERELLE_HOSTS, 0)
        self.assertEqual(chanterelle_host_share(zero | {'spruce': 20, 'pine': 10, 'fir': 50}), (30, True))
        self.assertEqual(chanterelle_host_share({'pine': 0}), (0, False))
        self.assertEqual(chanterelle_host_share({'fir': 100, 'softBroadleaves': 100}), (None, False))
        for values in [{'spruce': -1}, {'oak': float('nan')}, {'beech': '20'}, {'pine': 80, 'spruce': 40}]:
            with self.assertRaises(ValueError):
                chanterelle_host_share(values)

    def test_chanterelle_weighting_union_and_invalid(self):
        zero = dict.fromkeys(CHANTERELLE_HOSTS, 0)
        cell = box(0, 0, 100, 100)
        result = aggregate(cell, [(box(0, 0, 20, 100), zero | {'spruce': 80}),
                                  (box(20, 0, 80, 100), zero | {'beech': 20})])
        self.assertEqual(result['chanterelleKnownHostShareAreaWeightedPct'], 35)
        self.assertEqual(result['chanterelleHostEvidenceAreaFraction'], .8)
        self.assertEqual(result['chanterelleHostStandCount'], 2)
        self.assertEqual(result['chanterelleHostPositiveStandCount'], 2)
        self.assertEqual(result['chanterelleHostIncompleteStandCount'], 0)
        overlap = aggregate(cell, [(box(0, 0, 70, 100), zero | {'oak': 10}),
                                   (box(50, 0, 100, 100), zero | {'pine': 10})])
        self.assertEqual(overlap['chanterelleHostEvidenceAreaFraction'], 1)
        self.assertEqual(overlap['overlapAreaFraction'], .2)
        missing = aggregate(cell, [(cell, {'pine': 10})])
        self.assertEqual(missing['chanterelleHostIncompleteStandCount'], 1)
        invalid = aggregate(cell, [(cell, zero | {'_invalidChanterelle': True})])
        self.assertIsNone(invalid['chanterelleKnownHostShareAreaWeightedPct'])
        self.assertEqual(invalid['chanterelleHostInvalidStandCount'], 1)

    def test_boletus_known_sum_and_missing(self):
        self.assertEqual(boletus_host_share(dict(zip(BOLETUS_HOSTS, [20, 10, 5, 30, 15]))), (80, True))
        self.assertEqual(boletus_host_share({'spruce': 20, 'pine': 0}), (20, False))
        self.assertEqual(boletus_host_share({}), (None, False))
        self.assertEqual(boletus_host_share(dict.fromkeys(BOLETUS_HOSTS, 0)), (0, True))
        for shares in [{'spruce': -1}, {'oak': float('nan')}, {'fir': '20'}, {'spruce': 80, 'beech': 40}]:
            with self.assertRaises(ValueError):
                boletus_host_share(shares)

    def test_boletus_weighting_and_union(self):
        zero = dict.fromkeys(BOLETUS_HOSTS, 0)
        cell = box(0, 0, 100, 100)
        result = aggregate(cell, [(box(0, 0, 20, 100), zero | {'spruce': 80}),
                                  (box(20, 0, 80, 100), zero | {'beech': 20})])
        self.assertEqual(result['boletusHostShareAreaWeightedPct'], 35)
        self.assertEqual(result['boletusHostEvidenceAreaFraction'], .8)
        self.assertEqual(result['boletusHostStandCount'], 2)
        self.assertEqual(result['boletusHostPositiveStandCount'], 2)
        self.assertEqual(result['boletusHostIncompleteStandCount'], 0)
        overlap = aggregate(cell, [(box(0, 0, 70, 100), zero | {'oak': 10}),
                                   (box(50, 0, 100, 100), zero | {'fir': 10})])
        self.assertEqual(overlap['boletusHostEvidenceAreaFraction'], 1)

    def test_boletus_missing_and_invalid_are_not_zero(self):
        result = aggregate(box(0, 0, 100, 100), [(box(0, 0, 50, 100), {'spruce': 30}),
                                              (box(50, 0, 100, 100), {})])
        self.assertEqual(result['boletusHostShareAreaWeightedPct'], 30)
        self.assertEqual(result['boletusHostIncompleteStandCount'], 2)
        self.assertEqual(result['boletusHostEvidenceAreaFraction'], .5)
        invalid = aggregate(box(0, 0, 1, 1), [(box(0, 0, 1, 1), {'oak': 120})])
        self.assertIsNone(invalid['boletusHostShareAreaWeightedPct'])
        self.assertEqual(invalid['boletusHostInvalidStandCount'], 1)

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
