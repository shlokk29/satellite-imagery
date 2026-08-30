"""Backend-only regression tests for offline hybrid change-event search."""

import unittest

from backend.search.search import concept_demo_change_events, search_changes


REAL_EVENTS = [
    {
        "id": "vit-building", "location_id": "vit_ap", "location": "VIT-AP University, Amaravati",
        "dataset_type": "REAL_SATELLITE_ANALYSIS", "type": "NEW CONSTRUCTION", "confidence": 0.91,
        "area_sqm": 1400, "distance_to_road_m": 24, "distance_to_water_m": 260,
        "dates": ["2021-03-06", "2026-03-05"], "explanation": "Built-up area increased near a road.",
    },
    {
        "id": "guwahati-vegetation", "location_id": "mixed", "location": "Guwahati, Assam",
        "dataset_type": "REAL_SATELLITE_ANALYSIS", "type": "VEGETATION LOSS", "confidence": 0.87,
        "area_sqm": 1200, "distance_to_road_m": 180, "distance_to_water_m": 42,
        "dates": ["2024-03-11", "2026-03-06"], "explanation": "Vegetated canopy transition near water.",
    },
    {
        "id": "river-water", "location_id": "river", "location": "Brahmaputra River, Assam",
        "dataset_type": "REAL_SATELLITE_ANALYSIS", "type": "WATER EXTENT CHANGE", "confidence": 0.86,
        "area_sqm": 1800, "distance_to_road_m": 300, "distance_to_water_m": 0,
        "dates": ["2024-02-10", "2024-10-22"], "explanation": "Water extent and shoreline shifted.",
    },
]


class HybridSearchTests(unittest.TestCase):
    def setUp(self):
        self.events = REAL_EVENTS + concept_demo_change_events()

    def assertContainsType(self, query, change_type):
        results = search_changes(query, self.events)
        self.assertTrue(results, query)
        self.assertTrue(any(result["type"] == change_type for result in results), query)

    def test_keyword_and_synonym_intents(self):
        self.assertContainsType("new buildings", "NEW CONSTRUCTION")
        self.assertContainsType("areas where greenery decreased", "VEGETATION LOSS")
        self.assertContainsType("river expansion", "WATER EXTENT CHANGE")

    def test_spatial_and_location_filters(self):
        results = search_changes("new construction near roads", self.events)
        self.assertTrue(results)
        self.assertTrue(all(result["type"] == "NEW CONSTRUCTION" for result in results))
        self.assertTrue(all(result["distance_to_road_m"] <= 80 for result in results))
        vit_results = search_changes("construction in VIT-AP", self.events)
        self.assertTrue(vit_results)
        self.assertTrue(all(result["location_id"] == "vit_ap" for result in vit_results))

    def test_temporal_filter_and_concept_demo_separation(self):
        results = search_changes("changes between 2021 and 2026", self.events)
        self.assertTrue(results)
        self.assertTrue(all(result["location_id"] != "concept_demo" for result in results))
        demo_results = search_changes("new buildings", concept_demo_change_events(), location_id="concept_demo")
        self.assertEqual(demo_results[0]["dataset_type"], "CONCEPT_DEMO")

    def test_empty_and_no_result_queries(self):
        self.assertEqual(search_changes("", self.events), self.events)
        self.assertEqual(search_changes("glacier volcanic eruption", self.events), [])


if __name__ == "__main__":
    unittest.main()
