"""Numerical gates for semantic-sky replacement and preserved scene layers."""

import sys
import unittest
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from sky_compositing import build_sky_layers
from compositing import recover_subject_edges, composite_subject


class SkyCompositingTests(unittest.TestCase):
    def sample(self):
        rng = np.random.default_rng(42)
        rgb = rng.integers(0, 256, (80, 100, 3), dtype=np.uint8)
        generated = rng.integers(0, 256, rgb.shape, dtype=np.uint8)
        alpha = np.zeros((80, 100), dtype=np.uint8)
        alpha[10:65, 35:65] = 255
        alpha[9, 35:65] = 140
        alpha[65, 35:65] = 120
        editable = np.zeros_like(alpha)
        editable[:30] = 255
        editable[30] = 128
        editable[31] = 64
        editable[alpha > 0] = 0
        return tuple(Image.fromarray(value) for value in (rgb, alpha, editable, generated))

    def test_visible_non_sky_rgb_is_byte_exact_even_beside_subject_hole(self):
        source, subject, editable, generated = self.sample()
        before = [np.asarray(image).copy() for image in (source, subject, editable, generated)]
        background, scene, underlay = build_sky_layers(source, subject, editable, generated)
        rgb, alpha, weight, sky = before
        visible_non_sky = (weight == 0) & (alpha == 0)
        np.testing.assert_array_equal(np.asarray(background)[visible_non_sky], rgb[visible_non_sky])
        np.testing.assert_array_equal(np.asarray(scene)[visible_non_sky, :3], rgb[visible_non_sky])
        np.testing.assert_array_equal(np.asarray(scene)[visible_non_sky, 3], 255)
        np.testing.assert_array_equal(np.asarray(underlay)[alpha == 0], weight[alpha == 0])
        for image, original in zip((source, subject, editable, generated), before):
            np.testing.assert_array_equal(np.asarray(image), original)

    def test_visible_sky_uses_requested_feather_without_recoloring_scene_rgb(self):
        source, subject, editable, generated = self.sample()
        background, scene, underlay = build_sky_layers(source, subject, editable, generated)
        rgb = np.asarray(source).astype(np.uint32)
        sky = np.asarray(generated).astype(np.uint32)
        weight = np.asarray(editable).astype(np.uint32)
        visible = np.asarray(subject) == 0
        expected = ((rgb * (255 - weight[..., None]) + sky * weight[..., None] + 127) // 255).astype(np.uint8)
        np.testing.assert_array_equal(np.asarray(background)[visible], expected[visible])
        np.testing.assert_array_equal(np.asarray(scene)[visible, :3], np.asarray(source)[visible])
        np.testing.assert_array_equal(np.asarray(scene)[..., 3], 255 - np.asarray(underlay))
        self.assertEqual(scene.mode, "RGBA")
        self.assertEqual(background.mode, "RGB")
        self.assertEqual(underlay.mode, "L")

    def test_empty_sky_keeps_every_observed_non_subject_pixel(self):
        source, subject, _, generated = self.sample()
        background, scene, underlay = build_sky_layers(
            source, subject, Image.new("L", source.size), generated
        )
        visible = np.asarray(subject) == 0
        np.testing.assert_array_equal(np.asarray(background)[visible], np.asarray(source)[visible])
        self.assertIsNone(underlay.getbbox())
        self.assertTrue(np.all(np.asarray(scene)[..., 3] == 255))

    def test_sky_underlay_never_expands_into_visible_ground(self):
        source, subject, editable, generated = self.sample()
        _, _, underlay = build_sky_layers(source, subject, editable, generated)
        weight = np.asarray(underlay)
        alpha = np.asarray(subject)
        original_sky = np.asarray(editable)
        self.assertTrue(np.any(weight[alpha > 0] > 0))
        self.assertTrue(np.all(weight[(alpha == 0) & (original_sky == 0)] == 0))
        self.assertTrue(np.all(weight[70:] == 0))

    def test_translucent_ground_contact_keeps_original_final_rgb(self):
        source, subject, editable, generated = self.sample()
        background, _, underlay = build_sky_layers(source, subject, editable, generated)
        foreground, _ = recover_subject_edges(source, subject, underlay)
        composite = composite_subject(foreground, background)
        alpha = np.asarray(subject)
        contacts = (alpha > 0) & (alpha < 250) & (np.asarray(underlay) == 0)
        self.assertTrue(contacts.any())
        np.testing.assert_array_equal(np.asarray(composite)[contacts], np.asarray(source)[contacts])

    def test_all_inputs_must_share_source_coordinates(self):
        source, subject, editable, generated = self.sample()
        for index in range(3):
            inputs = [subject, editable, generated]
            inputs[index] = inputs[index].resize((99, 80))
            with self.subTest(input=index), self.assertRaises(ValueError):
                build_sky_layers(source, *inputs)


if __name__ == "__main__":
    unittest.main()
