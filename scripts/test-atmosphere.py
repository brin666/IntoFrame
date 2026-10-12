"""Numerical contracts for sky grading and pointwise scene ambience."""

import sys
import unittest
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from atmosphere import grade_sky, harmonize_layer


class AtmosphereTests(unittest.TestCase):
    def sample(self, mode="RGBA"):
        rng = np.random.default_rng(7)
        pixels = rng.integers(0, 256, (37, 53, 4 if mode == "RGBA" else 3), dtype=np.uint8)
        if mode == "RGBA":
            pixels[0, :8, 3] = (0, 1, 32, 96, 128, 192, 254, 255)
        return Image.fromarray(pixels, mode)

    def test_golden_hour_is_the_exact_input_object_and_pixels(self):
        for mode in ("RGB", "RGBA"):
            source = self.sample(mode)
            before = source.tobytes()
            for operation in (grade_sky, harmonize_layer):
                self.assertIs(operation(source, "golden-hour"), source)
                self.assertEqual(source.tobytes(), before)

    def test_alpha_mode_size_and_input_are_preserved(self):
        for mode in ("RGB", "RGBA"):
            source = self.sample(mode)
            before = np.asarray(source).copy()
            for style in ("dreamy-pink", "cinematic-night"):
                for operation in (grade_sky, harmonize_layer):
                    with self.subTest(mode=mode, style=style, operation=operation.__name__):
                        result = operation(source, style)
                        self.assertEqual(result.mode, mode)
                        self.assertEqual(result.size, source.size)
                        np.testing.assert_array_equal(np.asarray(source), before)
                        if mode == "RGBA":
                            np.testing.assert_array_equal(np.asarray(result)[..., 3], before[..., 3])

    def test_layer_curve_is_spatially_independent_and_alpha_independent(self):
        source = self.sample()
        rgba = np.asarray(source)
        for style in ("dreamy-pink", "cinematic-night"):
            result = np.asarray(harmonize_layer(source, style))
            rgb_result = np.asarray(harmonize_layer(source.convert("RGB"), style))
            np.testing.assert_array_equal(result[..., :3], rgb_result)
            # Permuting all pixels destroys neighborhoods. A pointwise curve
            # must still produce the same colors at their new coordinates.
            permuted = Image.fromarray(rgba[::-1, ::-1].copy(), "RGBA")
            permuted_result = np.asarray(harmonize_layer(permuted, style))
            np.testing.assert_array_equal(permuted_result, result[::-1, ::-1])
            crop = harmonize_layer(source.crop((5, 7, 19, 22)), style)
            np.testing.assert_array_equal(np.asarray(crop), result[7:22, 5:19])

    def test_pink_clouds_have_pink_lavender_color_and_continuous_contrast(self):
        ramp = np.tile(np.arange(256, dtype=np.uint8)[None, :, None], (12, 1, 3))
        output = np.asarray(grade_sky(Image.fromarray(ramp, "RGB"), "dreamy-pink"))
        self.assertTrue(np.all(output[..., 0] > output[..., 1]))
        self.assertTrue(np.all(output[..., 2] > output[..., 1]))
        self.assertGreater(int(output[0, -1, 0]) - int(output[0, 0, 0]), 160)
        self.assertGreater(len(np.unique(output[0, :, 0])), 150)
        self.assertLessEqual(int(np.abs(np.diff(output[0].astype(np.int16), axis=0)).max()), 2)

    def test_night_suppresses_sparse_bright_specks_but_preserves_cloud_shape(self):
        yy, xx = np.mgrid[:96, :128]
        cloud = 50 + 120 * np.exp(-((xx - 78) ** 2 + (yy - 45) ** 2) / 650)
        clean = np.repeat(cloud[..., None], 3, axis=2).astype(np.uint8)
        spotted = clean.copy()
        spotted[10::12, 9::17] = 255
        clean_output = np.asarray(grade_sky(Image.fromarray(clean, "RGB"), "cinematic-night"))
        output = np.asarray(grade_sky(Image.fromarray(spotted, "RGB"), "cinematic-night"))
        # Isolated white dots should converge on their surrounding cloud,
        # while the broad cloud's light center remains clearly brighter.
        self.assertLess(np.abs(output.astype(int) - clean_output.astype(int)).max(), 6)
        self.assertGreater(float(output[45, 78].mean() - output[45, 10].mean()), 20)
        self.assertTrue(np.all(output[..., 2] > output[..., 1]))
        self.assertTrue(np.all(output[..., 1] > output[..., 0]))

    def test_night_scene_retains_gold_clock_and_monotonic_fine_detail(self):
        samples = np.array([[(220, 175, 95), (245, 245, 235), (15, 25, 35)]], dtype=np.uint8)
        output = np.asarray(harmonize_layer(Image.fromarray(samples, "RGB"), "cinematic-night"))[0]
        self.assertGreater(int(output[0, 0]), int(output[0, 1]))
        self.assertGreater(output[1].min(), 190)
        self.assertGreater(output[2, 2], output[2, 0])
        ramp = np.tile(np.arange(256, dtype=np.uint8)[None, :, None], (1, 1, 3))
        output = np.asarray(harmonize_layer(Image.fromarray(ramp, "RGB"), "cinematic-night"))[0]
        self.assertTrue(np.all(np.diff(output.astype(np.int16), axis=0) >= 0))
        self.assertGreater(len(np.unique(output[:, 0])), 200)

    def test_invalid_style_mode_and_empty_input_are_rejected(self):
        for operation in (grade_sky, harmonize_layer):
            with self.assertRaises(ValueError):
                operation(Image.new("RGB", (1, 1)), "unknown")
            with self.assertRaises(ValueError):
                operation(Image.new("L", (1, 1)), "dreamy-pink")
            with self.assertRaises(ValueError):
                operation(Image.fromarray(np.array([[np.nan]], dtype=np.float32)), "dreamy-pink")
            with self.assertRaises(ValueError):
                operation(Image.new("RGB", (0, 1)), "dreamy-pink")
            with self.assertRaises(TypeError):
                operation(None, "dreamy-pink")


if __name__ == "__main__":
    unittest.main()
