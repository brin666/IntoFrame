"""Semantic-sky invariants; add --model-smoke to run the pinned CPU model."""

import sys
import os
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
import sky_detector

MODEL_SMOKE = "--model-smoke" in sys.argv
if MODEL_SMOKE:
    sys.argv.remove("--model-smoke")


class SkyDetectorTests(unittest.TestCase):
    def test_non_sky_and_subject_are_exactly_zero_with_inward_feather(self):
        probability = np.zeros((100, 100), dtype=np.float32)
        probability[10:60, 10:90] = 0.95
        winner = probability > 0
        alpha = np.zeros((100, 100), dtype=np.uint8)
        alpha[20:40, 35:60] = 255
        alpha[19, 35:60] = 2
        alpha[18, 35:60] = 1
        original = alpha.copy()
        subject = Image.fromarray(alpha)
        mask, suitability = sky_detector.sky_mask_from_probabilities(probability, winner, subject)
        editable = np.asarray(mask)
        np.testing.assert_array_equal(np.asarray(subject), original)
        self.assertEqual(mask.mode, "L")
        self.assertEqual(mask.size, subject.size)
        self.assertTrue(suitability["eligible"])
        self.assertEqual(suitability["status"], "supported")
        self.assertIsNone(suitability["reason"])
        self.assertTrue(np.all(editable[probability < 0.8] == 0))
        self.assertTrue(np.all(editable[alpha >= 2] == 0))
        self.assertTrue(np.all(editable[18, 35:60] > 0))
        self.assertGreater(editable[10, 10], 0)
        self.assertLess(editable[10, 10], 255)
        self.assertEqual(editable[14, 14], 255)

    def test_no_sky_never_substitutes_non_subject_background(self):
        subject = Image.new("L", (100, 100), 0)
        mask, suitability = sky_detector.sky_mask_from_probabilities(
            np.zeros((100, 100)), np.zeros((100, 100), dtype=bool), subject
        )
        self.assertIsNone(mask.getbbox())
        self.assertFalse(suitability["eligible"])
        self.assertEqual(suitability["skyFraction"], 0)
        self.assertEqual(suitability["status"], "no-sky")
        self.assertTrue(suitability["reason"])

    def test_confidence_and_argmax_are_both_required(self):
        probability = np.full((100, 100), 0.79, dtype=np.float32)
        probability[:50] = 0.99
        winner = np.ones((100, 100), dtype=bool)
        winner[:50] = False
        mask, suitability = sky_detector.sky_mask_from_probabilities(
            probability, winner, Image.new("L", (100, 100))
        )
        self.assertIsNone(mask.getbbox())
        self.assertFalse(suitability["eligible"])

    def test_fragmented_confident_patches_in_broad_potential_sky_are_uncertain(self):
        probability = np.full((100, 100), 0.6, dtype=np.float32)
        probability[::4, ::4] = 0.95
        mask, suitability = sky_detector.sky_mask_from_probabilities(
            probability, np.ones((100, 100), dtype=bool), Image.new("L", (100, 100))
        )
        self.assertIsNone(mask.getbbox())
        self.assertFalse(suitability["eligible"])
        self.assertEqual(suitability["status"], "uncertain")
        self.assertLess(suitability["confidenceCoverage"], 0.9)
        self.assertEqual(suitability["reason"],
                         "Sky boundaries are uncertain. Choose an outdoor photo with a clearer, open sky.")

    def test_lower_confidence_sky_extends_only_twelve_pixels_from_a_seed(self):
        probability = np.zeros((200, 200), dtype=np.float32)
        probability[:180] = 0.95
        probability[180:197] = 0.6
        mask, suitability = sky_detector.sky_mask_from_probabilities(
            probability, probability > 0, Image.new("L", (200, 200))
        )
        editable = np.asarray(mask)
        self.assertTrue(suitability["eligible"])
        self.assertGreaterEqual(suitability["confidenceCoverage"], 0.9)
        self.assertGreater(editable[191, 100], 0)
        self.assertTrue(np.all(editable[192:] == 0))
        self.assertEqual(editable[190, 100], 255)

    def test_boundary_extension_never_enters_other_labels_or_subject(self):
        probability = np.full((200, 200), 0.95, dtype=np.float32)
        probability[180:190] = 0.6
        probability[190:] = 0.4
        winner = np.ones((200, 200), dtype=bool)
        winner[50:55, 50:100] = False  # High probability still cannot supply a sky label.
        alpha = np.zeros((200, 200), dtype=np.uint8)
        alpha[170:190, 100:120] = 255
        alpha[170:190, 120] = 2
        subject = Image.fromarray(alpha)
        mask, suitability = sky_detector.sky_mask_from_probabilities(probability, winner, subject)
        editable = np.asarray(mask)
        self.assertTrue(suitability["eligible"])
        self.assertTrue(np.all(editable[~winner] == 0))
        self.assertTrue(np.all(editable[alpha >= 2] == 0))
        self.assertTrue(np.all(editable[probability < 0.5] == 0))
        np.testing.assert_array_equal(np.asarray(subject), alpha)

    def test_boundary_feather_is_at_most_two_native_pixels_on_large_images(self):
        probability = np.zeros((800, 1000), dtype=np.float32)
        probability[:400] = 0.95
        mask, suitability = sky_detector.sky_mask_from_probabilities(
            probability, probability > 0, Image.new("L", (1000, 800))
        )
        self.assertTrue(suitability["eligible"])
        self.assertLess(mask.getpixel((500, 399)), 255)
        self.assertEqual(mask.getpixel((500, 398)), 255)
        self.assertEqual(mask.getpixel((500, 400)), 0)

    def test_tiny_components_removed_but_interior_sky_is_retained(self):
        probability = np.zeros((100, 100), dtype=np.float32)
        probability[40:60, 40:60] = 0.95  # No contact with any image border.
        probability[2:4, 2:4] = 0.99
        mask, suitability = sky_detector.sky_mask_from_probabilities(
            probability, probability > 0, Image.new("L", (100, 100))
        )
        self.assertTrue(suitability["eligible"])
        self.assertAlmostEqual(suitability["skyFraction"], 0.04)
        self.assertEqual(mask.getpixel((2, 2)), 0)
        self.assertEqual(mask.getpixel((50, 50)), 255)

    def test_less_than_one_percent_returns_an_empty_mask(self):
        probability = np.zeros((100, 100), dtype=np.float32)
        probability[30:39, 30:40] = 0.95
        mask, suitability = sky_detector.sky_mask_from_probabilities(
            probability, probability > 0, Image.new("L", (100, 100))
        )
        self.assertIsNone(mask.getbbox())
        self.assertFalse(suitability["eligible"])
        self.assertAlmostEqual(suitability["skyFraction"], 0.009)

    def test_subject_exclusion_precedes_minimum_eligible_area(self):
        probability = np.full((100, 100), 0.95, dtype=np.float32)
        alpha = np.full((100, 100), 255, dtype=np.uint8)
        alpha[30:35, 30:40] = 0
        mask, suitability = sky_detector.sky_mask_from_probabilities(
            probability, np.ones((100, 100), dtype=bool), Image.fromarray(alpha)
        )
        self.assertIsNone(mask.getbbox())
        self.assertFalse(suitability["eligible"])
        self.assertAlmostEqual(suitability["skyFraction"], 0.005)

    def test_logits_resize_to_native_grid_and_retain_non_sky_exclusion(self):
        logits = np.full((4, 10, 10), -10, dtype=np.float32)
        logits[1] = 10  # Buildings/road stand in for any non-sky ADE class.
        logits[1, :5] = -10
        logits[2, :5] = 10
        mask, suitability = sky_detector.sky_mask_from_logits(logits, Image.new("L", (100, 80)))
        editable = np.asarray(mask)
        self.assertEqual(mask.size, (100, 80))
        self.assertTrue(suitability["eligible"])
        self.assertTrue(np.all(editable[40:] == 0))
        self.assertGreater(editable[10, 50], 0)

    def test_invalid_model_output_is_rejected(self):
        subject = Image.new("L", (100, 100))
        for logits in (np.zeros((2, 10, 10)), np.zeros((4, 10)), np.full((4, 10, 10), np.nan)):
            with self.subTest(shape=logits.shape), self.assertRaises(ValueError):
                sky_detector.sky_mask_from_logits(logits, subject)

    def test_mismatched_coordinates_rejected_before_loading_model(self):
        with patch.object(sky_detector, "_load_model") as load:
            with self.assertRaises(ValueError):
                sky_detector.detect_sky(Image.new("RGB", (100, 100)), Image.new("L", (101, 100)))
            load.assert_not_called()

    def test_model_failure_raises_instead_of_returning_a_fallback_mask(self):
        with patch.object(sky_detector, "_load_model", side_effect=OSError("offline")):
            with self.assertRaisesRegex(RuntimeError, "unavailable"):
                sky_detector.detect_sky(Image.new("RGB", (100, 100)), Image.new("L", (100, 100)))

    @unittest.skipUnless(MODEL_SMOKE, "Run --model-smoke to verify the pinned CPU model.")
    def test_pinned_model_on_real_sky_and_non_sky_photos(self):
        fixtures = {
            "coffee": (ROOT / "backend/data/smoke/object_coffee_source.webp", False),
            "cat": (ROOT / "backend/data/smoke/pet_chelsea_source.webp", False),
            "portrait": (ROOT / "backend/data/sky-inputs/portrait-sky.png", False),
            "outdoor-person": (ROOT / "backend/data/sky-inputs/outdoor-person.png", True),
        }
        if os.environ.get("INTOFRAME_TEST_PHOTO"):
            fixtures["building"] = (Path(os.environ["INTOFRAME_TEST_PHOTO"]), True)
        for name, (path, expected) in fixtures.items():
            with self.subTest(photo=name), Image.open(path) as original:
                source = original.convert("RGB")
                mask, suitability = sky_detector.detect_sky(source, Image.new("L", source.size))
                self.assertEqual(suitability["eligible"], expected, suitability)
                self.assertEqual(bool(mask.getbbox()), expected)
                if name == "portrait":
                    self.assertEqual(suitability["status"], "uncertain")
                    self.assertLess(suitability["confidenceCoverage"], 0.9)
                print(f"{name}: {suitability}", flush=True)
        _, model = sky_detector._load_model()
        self.assertEqual(next(model.parameters()).device.type, "cpu")


if __name__ == "__main__":
    unittest.main()
