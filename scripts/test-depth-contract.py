"""Check native subject depth, legacy PNGs and single inference without models."""

from __future__ import annotations

import json
from pathlib import Path
import struct
import sys
import tempfile
import unittest
from unittest.mock import patch

import cv2
import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
import depth_estimator
import main


class DepthContractTests(unittest.TestCase):
    def test_single_prediction_retains_native_relief_and_legacy_png(self):
        raw = np.linspace(-1, 4, 60, dtype=np.float32).reshape(6, 10)
        raw[0, 0], raw[-1, -1] = -20, 30
        source = Image.new("RGB", (10, 6))
        with patch.object(depth_estimator, "_predict_raw", return_value=raw) as predict:
            png, native = depth_estimator.estimate_with_raw(source)
        predict.assert_called_once_with(source)
        np.testing.assert_array_equal(native, raw)
        low, high = np.percentile(raw, (2, 98))
        legacy = cv2.GaussianBlur(
            np.clip((raw - low) / (high - low), 0, 1).astype(np.float32), (5, 5), 0.9
        )
        np.testing.assert_array_equal(np.asarray(png), np.round(legacy * 255).astype(np.uint8))
        self.assertEqual(png.mode, "L")
        self.assertEqual(png.size, source.size)
        with patch.object(depth_estimator, "_predict_raw", return_value=raw) as predict:
            compatible = depth_estimator.estimate(source)
        predict.assert_called_once_with(source)
        np.testing.assert_array_equal(compatible, png)

    def test_invalid_and_flat_predictions_fail_explicitly(self):
        source = Image.new("RGB", (10, 6))
        valid = np.arange(60, dtype=np.float32).reshape(6, 10)
        for name, raw in (
            ("nan", np.where(valid == 3, np.nan, valid)),
            ("infinity", np.where(valid == 3, np.inf, valid)),
            ("flat", np.ones((6, 10), dtype=np.float32)),
            ("dimensions", np.ones((10, 6), dtype=np.float32)),
        ):
            with self.subTest(name=name):
                with patch.object(depth_estimator, "_predict_raw", return_value=raw) as predict:
                    with self.assertRaises(RuntimeError):
                        depth_estimator.estimate_with_raw(source)
                predict.assert_called_once_with(source)

    def test_metadata_uses_opaque_subject_and_full_native_prediction(self):
        raw = np.linspace(-2, 10, 60, dtype=np.float32).reshape(6, 10)
        alpha = np.zeros(raw.shape, dtype=np.uint8)
        alpha[2:5, 4:9] = 255
        alpha[0, 0] = 160  # Excluded from the percentile population.
        alpha[1, 1] = 161
        metadata, diagnostics = depth_estimator.subject_depth_metadata(raw, Image.fromarray(alpha))
        values = raw[alpha > 160]
        self.assertEqual(metadata["encoding"], "float32-little-endian-row-major")
        self.assertEqual((metadata["width"], metadata["height"]), (10, 6))
        for key, expected in (
            ("subjectP05", np.percentile(values, 5)),
            ("subjectP95", np.percentile(values, 95)),
            ("subjectMedian", np.median(values)),
            ("globalP02", np.percentile(raw, 2)),
            ("globalP98", np.percentile(raw, 98)),
            ("globalMin", raw.min()), ("globalMax", raw.max()),
        ):
            self.assertEqual(metadata[key], float(expected))
        self.assertTrue(diagnostics["eligible"])
        self.assertEqual(diagnostics["subjectPixelCount"], len(values))
        json.dumps(metadata, allow_nan=False)

    def test_unreliable_subject_ranges_are_not_reported_as_ready(self):
        raw = np.linspace(0, 100, 100, dtype=np.float32).reshape(10, 10)
        alpha = np.zeros(raw.shape, dtype=np.uint8)
        alpha[3:7, 3:7] = 255
        for name, subject_values, expected_status in (
            ("flat", np.full(16, 50), "flat-subject-range"),
            ("weak", np.linspace(50, 50.01, 16), "weak-subject-range"),
        ):
            with self.subTest(name=name):
                candidate = raw.copy()
                candidate[alpha > 160] = subject_values
                metadata, diagnostics = depth_estimator.subject_depth_metadata(
                    candidate, Image.fromarray(alpha)
                )
                self.assertIsNotNone(metadata)
                self.assertEqual(diagnostics["status"], expected_status)
                self.assertFalse(diagnostics["eligible"])
                self.assertTrue(diagnostics["reason"])
        metadata, diagnostics = depth_estimator.subject_depth_metadata(raw, Image.new("L", (10, 10), 160))
        self.assertIsNone(metadata)
        self.assertEqual(diagnostics["status"], "no-opaque-subject")
        self.assertFalse(diagnostics["eligible"])
        with self.assertRaises(RuntimeError):
            depth_estimator.subject_depth_metadata(raw, Image.new("L", (9, 10)))

    def test_job_exports_little_endian_row_major_once_and_keeps_scene_assets(self):
        # Force foreign byte order and column layout to catch accidental native
        # serialization; normal inference already returns contiguous float32.
        raw = np.asfortranarray(np.linspace(-3, 8, 240).reshape(12, 20).astype(">f4"))
        source = Image.new("RGB", (20, 12), (150, 120, 100))
        alpha = np.zeros((12, 20), dtype=np.uint8)
        alpha[4:8, 8:12] = 255
        job_id = "depth-contract-test"
        with tempfile.TemporaryDirectory(prefix="intoframe-depth-test-") as temporary:
            data = Path(temporary)
            folder = data / job_id
            folder.mkdir()
            source.save(folder / "source.webp", lossless=True)
            Image.fromarray(alpha).save(folder / "mask.png")
            with patch.object(main, "DATA", data), patch.dict(main.depth_jobs, {
                job_id: {"status": "processing", "stage": "queued"}
            }), patch.object(depth_estimator, "_predict_raw", return_value=raw) as predict:
                result = main._process_depth(job_id)
            predict.assert_called_once()
            payload = (folder / "subject-depth-f32.bin").read_bytes()
            self.assertEqual(len(payload), source.width * source.height * 4)
            decoded = np.array(struct.unpack("<240f", payload)).reshape(12, 20)
            np.testing.assert_array_equal(decoded, raw)
            saved_metadata = json.loads((folder / "subject-depth.json").read_text(encoding="utf8"))
            self.assertEqual(saved_metadata, result["meshDepthMetadata"])
            self.assertEqual(result["meshDepthUrl"], f"/media/{job_id}/subject-depth-f32.bin")
            self.assertEqual(result["encoding"], "uint8-png-near-white")
            self.assertEqual(result["width"], source.width)
            self.assertEqual(result["height"], source.height)
            for name in ("depth.png", "render-depth.png", "background.webp"):
                with Image.open(folder / name) as asset:
                    expected_size = source.size if name == "depth.png" else (
                        result["renderWidth"], result["renderHeight"]
                    )
                    self.assertEqual(asset.size, expected_size)


if __name__ == "__main__":
    unittest.main()
