"""Numerical invariants for subject protection and preview/export assets."""

import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from compositing import composite_subject, recover_subject_edges
import main


class CompositingTests(unittest.TestCase):
    def sample(self):
        alpha = np.zeros((40, 40), dtype=np.uint8)
        alpha[8:32, 8:32] = 255
        alpha[7, 8:32] = 150
        foreground = np.array([190, 110, 40], dtype=np.float32)
        background = np.array([40, 140, 220], dtype=np.float32)
        a = alpha[..., None] / 255
        rgb = np.uint8(np.rint(foreground * a + background * (1 - a)))
        return Image.fromarray(rgb), Image.fromarray(alpha), foreground

    def test_edge_color_recovers_without_eroding_alpha_or_changing_core(self):
        source, mask, known_foreground = self.sample()
        recovered, metrics = recover_subject_edges(source, mask)
        rgb = np.asarray(source)
        rgba = np.asarray(recovered)
        alpha = np.asarray(mask)
        np.testing.assert_array_equal(rgba[..., 3], alpha)
        np.testing.assert_array_equal(rgba[alpha == 255, :3], rgb[alpha == 255])
        edge = alpha == 150
        before_error = np.abs(rgb[edge] - known_foreground).mean()
        after_error = np.abs(rgba[edge, :3] - known_foreground).mean()
        self.assertLess(after_error, before_error)
        self.assertGreater(metrics["edgePixelsChanged"], 0)
        self.assertLessEqual(np.abs(rgba[..., :3].astype(int) - rgb.astype(int)).max(), 48)

    def test_straight_alpha_is_applied_once(self):
        subject = Image.new("RGBA", (1, 1), (200, 100, 50, 128))
        result = composite_subject(subject, Image.new("RGB", (1, 1), (0, 0, 0)))
        self.assertEqual(result.getpixel((0, 0)), (100, 50, 25))

    def test_mismatched_coordinates_rejected(self):
        with self.assertRaises(ValueError):
            recover_subject_edges(Image.new("RGB", (40, 40)), Image.new("L", (41, 40)))

    def test_empty_editable_sky_never_recovers_non_sky_subject_edges(self):
        # Include a subject near the image origin: an all-true distance field
        # must not be mistaken for nearby editable sky.
        alpha = np.zeros((40, 40), dtype=np.uint8)
        alpha[4:30, 4:30] = 255
        alpha[3, 4:30] = 150
        background = np.array([40, 140, 220], dtype=np.float32)
        foreground = np.array([190, 110, 40], dtype=np.float32)
        weight = alpha[..., None] / 255
        rgb = np.uint8(np.rint(foreground * weight + background * (1 - weight)))
        recovered, metrics = recover_subject_edges(
            Image.fromarray(rgb), Image.fromarray(alpha), Image.new("L", (40, 40))
        )
        np.testing.assert_array_equal(np.asarray(recovered)[..., :3], rgb)
        np.testing.assert_array_equal(np.asarray(recovered)[..., 3], alpha)
        self.assertEqual(metrics["edgePixelsChanged"], 0)

    def test_ground_contact_edges_remain_observed_when_only_top_sky_changes(self):
        alpha = np.zeros((80, 80), dtype=np.uint8)
        alpha[12:65, 25:55] = 255
        alpha[11, 25:55] = 150
        alpha[65, 25:55] = 150
        background = np.array([40, 140, 220], dtype=np.float32)
        foreground = np.array([190, 110, 40], dtype=np.float32)
        weight = alpha[..., None] / 255
        rgb = np.uint8(np.rint(foreground * weight + background * (1 - weight)))
        sky = np.zeros((80, 80), dtype=np.uint8)
        sky[:10] = 255
        recovered, metrics = recover_subject_edges(Image.fromarray(rgb), Image.fromarray(alpha), Image.fromarray(sky))
        rgba = np.asarray(recovered)
        np.testing.assert_array_equal(rgba[65, :, :3], rgb[65])
        np.testing.assert_array_equal(rgba[..., 3], alpha)
        self.assertTrue(np.any(rgba[11, :, :3] != rgb[11]))
        self.assertGreater(metrics["edgePixelsChanged"], 0)

    def test_native_and_padded_assets_keep_identical_rgb(self):
        source, mask, _ = self.sample()
        # Nontrivial RGB ensures a lossy encode would be detected.
        rng = np.random.default_rng(5)
        sky = Image.fromarray(rng.integers(0, 256, (40, 40, 3), dtype=np.uint8))
        editable_array = np.zeros((40, 40), dtype=np.uint8)
        editable_array[:6] = 255
        editable_array[6] = 128
        editable = Image.fromarray(editable_array)
        sky_suitability = {"eligible": True, "status": "supported", "skyFraction": 0.175,
                           "reason": None, "model": "test-semantic-sky"}
        job_id, style = "compositing-test", "dreamy-pink"
        with tempfile.TemporaryDirectory() as temp, patch.object(main, "DATA", Path(temp)), patch.object(main, "segment", return_value=mask), patch.object(main, "detect_sky", return_value=(editable, sky_suitability)):
            main.jobs[job_id] = {"stage": "preparing"}
            main.restyle_jobs[(job_id, style)] = {"stage": "generating"}
            try:
                result = main._process(job_id, source)
                folder = Path(temp) / job_id
                np.testing.assert_array_equal(np.asarray(Image.open(folder / "source.webp")), np.asarray(source))
                np.testing.assert_array_equal(np.asarray(Image.open(folder / "subject.png"))[..., :3], np.asarray(source))
                np.testing.assert_array_equal(np.asarray(Image.open(folder / "mask.png")), np.asarray(mask))
                np.testing.assert_array_equal(np.asarray(Image.open(folder / "editable-sky.png")), editable_array)
                self.assertTrue(result["sky"]["eligible"])
                with patch.object(main, "restyle", return_value=(sky, sky, {"seed": 5})):
                    styled = main._process_restyle(job_id, style)
                output = folder / "styles" / style / main.ATMOSPHERE_VERSION
                background = Image.open(output / "background.webp")
                padded = np.asarray(Image.open(output / "render-background.webp"))
                bg = np.asarray(background)
                visible_non_sky = (editable_array == 0) & (np.asarray(mask) == 0)
                balanced_source = np.asarray(main.harmonize_layer(source, style))
                np.testing.assert_array_equal(bg[visible_non_sky], balanced_source[visible_non_sky])
                visible_sky = (editable_array == 255) & (np.asarray(mask) == 0)
                np.testing.assert_array_equal(bg[visible_sky], np.asarray(sky)[visible_sky])
                np.testing.assert_array_equal(padded[12:52, 12:52], bg)
                render_sky = np.asarray(Image.open(output / "render-sky.webp"))
                render_scene = np.asarray(Image.open(output / "render-scene.png"))
                np.testing.assert_array_equal(render_sky[12:52, 12:52], np.asarray(sky))
                native_scene = render_scene[12:52, 12:52]
                np.testing.assert_array_equal(native_scene[visible_non_sky, :3], balanced_source[visible_non_sky])
                layered = Image.alpha_composite(Image.fromarray(render_sky).convert("RGBA"), Image.fromarray(render_scene)).convert("RGB")
                np.testing.assert_array_equal(np.asarray(layered), padded)
                subject = Image.open(output / "subject.png")
                np.testing.assert_array_equal(np.asarray(subject)[..., 3], np.asarray(mask))
                expected = composite_subject(subject, background)
                np.testing.assert_array_equal(np.asarray(Image.open(output / "composite.png")), np.asarray(expected))
                self.assertEqual(styled["backgroundGeometry"], "sky-layers")
                self.assertEqual(styled["atmosphereVersion"], main.ATMOSPHERE_VERSION)
                self.assertEqual(styled["renderSkyUrl"], f"/media/{job_id}/styles/{style}/{main.ATMOSPHERE_VERSION}/render-sky.webp")
                self.assertEqual(styled["renderSceneUrl"], f"/media/{job_id}/styles/{style}/{main.ATMOSPHERE_VERSION}/render-scene.png")
                self.assertEqual(styled["editableSkyUrl"], result["sky"]["maskUrl"])
                self.assertTrue((output / "metadata.json").is_file())
            finally:
                main.jobs.pop(job_id, None)
                main.restyle_jobs.pop((job_id, style), None)


if __name__ == "__main__":
    unittest.main()
