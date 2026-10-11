"""Exercise local sky repair; --artifacts replays frozen skies without generation."""

import json
import sys
import unittest
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw
from scipy.ndimage import distance_transform_edt

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
from sky_refinement import refine_sky_boundary
from sky_compositing import build_sky_layers

ARTIFACTS = "--artifacts" in sys.argv
if ARTIFACTS:
    sys.argv.remove("--artifacts")


def fixture():
    """A brown native tower with sky omitted in the coarse crossing cells."""
    rgb = np.full((160, 160, 3), (182, 223, 243), dtype=np.uint8)
    alpha = np.zeros((160, 160), dtype=np.uint8)
    alpha[28:, 60:100] = 255
    rgb[alpha > 0] = (125, 100, 75)
    rgb[144:, :60] = (100, 90, 80)
    rgb[144:, 100:] = (100, 90, 80)
    editable = np.full((160, 160), 255, dtype=np.uint8)
    editable[20:, 52:108] = 0
    editable[144:] = 0
    logits = np.full((150, 40, 40), -20, dtype=np.float32)
    logits[2] = 0
    logits[2, 5:, 13:27] = np.log(0.1)
    logits[84, 5:, 13:27] = np.log(0.9)
    logits[2, 36:] = -20
    logits[6, 36:] = 10
    return Image.fromarray(rgb), Image.fromarray(alpha), Image.fromarray(editable), logits


def frozen_fixtures():
    base = ROOT / "screenshots" / "edge-repair"
    fixtures = [("big-ben", base / "before", base / "semantic-recomputed.npz")]
    for name in ("eiffel", "dog"):
        folder = base / "acceptance-before" / name
        fixtures.append((name, folder, folder / "semantic-recomputed.npz"))
    return [item for item in fixtures if (item[1] / "source.webp").exists() and item[2].exists()]


class SkyRefinementTests(unittest.TestCase):
    def test_local_native_sky_omission_is_repaired_without_alpha_change(self):
        source, subject, editable, logits = fixture()
        alpha_before = np.asarray(subject).copy()
        original = np.asarray(editable).copy()
        result, metrics = refine_sky_boundary(source, subject, editable, logits)
        output = np.asarray(result)
        self.assertEqual(result.mode, "L")
        self.assertEqual(result.size, source.size)
        self.assertEqual(output[80, 55], 255)
        self.assertEqual(output[80, 104], 255)
        self.assertEqual(metrics["status"], "refined")
        self.assertEqual(metrics["reachPixels"], 16)
        np.testing.assert_array_equal(np.asarray(subject), alpha_before)
        np.testing.assert_array_equal(np.asarray(editable), original)
        self.assertTrue(np.all(output[alpha_before >= 2] == 0))
        self.assertTrue(np.all(output[144:] == original[144:]))
        self.assertLessEqual(metrics["maximumChangedDistanceToSubject"], 16)
        self.assertLessEqual(metrics["maximumChangedDistanceToSky"], 16)

    def test_other_blue_objects_and_confident_same_class_building_are_barriers(self):
        for other_class in (20, 84, 6):
            with self.subTest(other_class=other_class):
                source, subject, editable, logits = fixture()
                # This object has exactly the same RGB as adjacent sky. Semantic
                # confidence must protect it even when its class is the tower's.
                logits[:, 16:23, 25:27] = -20
                logits[other_class, 16:23, 25:27] = 10
                result, _ = refine_sky_boundary(source, subject, editable, logits)
                self.assertTrue(np.all(np.asarray(result)[64:92, 100:108] == 0))
                self.assertEqual(result.getpixel((55, 80)), 255)

    def test_non_sky_rgb_and_disconnected_sky_colored_holes_do_not_extend(self):
        source, subject, editable, logits = fixture()
        rgb = np.asarray(source).copy()
        rgb[70:90, 52:60] = (45, 80, 45)
        result, _ = refine_sky_boundary(Image.fromarray(rgb), subject, editable, logits)
        self.assertTrue(np.all(np.asarray(result)[70:90, 52:60] == 0))
        # Surround a sky-colored pocket with a non-sky native barrier.
        rgb[65:95, 100:108] = (125, 100, 75)
        rgb[72:88, 102:106] = (182, 223, 243)
        result, _ = refine_sky_boundary(Image.fromarray(rgb), subject, editable, logits)
        self.assertTrue(np.all(np.asarray(result)[72:88, 102:106] == 0))

    def test_fine_translucent_subject_alpha_is_preserved_and_protected(self):
        source, subject, editable, logits = fixture()
        alpha = np.asarray(subject).copy()
        alpha[40:100, 57] = 2
        alpha[40:100, 58] = 20
        alpha[40:100, 59] = 127
        alpha[40:100, 56] = 1
        subject = Image.fromarray(alpha)
        result, _ = refine_sky_boundary(source, subject, editable, logits)
        np.testing.assert_array_equal(np.asarray(subject), alpha)
        self.assertTrue(np.all(np.asarray(result)[alpha >= 2] == 0))
        self.assertGreater(result.getpixel((56, 80)), 0)

    def test_no_confirmed_sky_and_no_subject_return_existing_mask(self):
        source, subject, editable, logits = fixture()
        for subject_image, sky_image, status in (
            (subject, Image.new("L", source.size), "no-confirmed-sky"),
            (Image.new("L", source.size), editable, "no-reliable-subject"),
        ):
            result, metrics = refine_sky_boundary(source, subject_image, sky_image, logits)
            np.testing.assert_array_equal(np.asarray(result), np.asarray(sky_image))
            self.assertEqual(metrics["status"], status)

    def test_invalid_native_coordinates_and_logits_are_rejected(self):
        source, subject, editable, logits = fixture()
        with self.assertRaises(ValueError):
            refine_sky_boundary(source, Image.new("L", (159, 160)), editable, logits)
        for invalid in (np.zeros((2, 10, 10)), np.zeros((4, 10)), np.full((4, 10, 10), np.nan)):
            with self.subTest(shape=invalid.shape), self.assertRaises(ValueError):
                refine_sky_boundary(source, subject, editable, invalid)
        with self.assertRaises(ValueError):
            refine_sky_boundary(source, subject, Image.new("L", source.size, 255), logits)

    def test_frozen_photos_preserve_protected_alpha_and_bounded_scene(self):
        fixtures = frozen_fixtures()
        if not fixtures:
            self.skipTest("Frozen diagnostic photos are local acceptance artifacts.")
        for name, folder, raw_path in fixtures:
            with self.subTest(photo=name):
                source = Image.open(folder / "source.webp").convert("RGB")
                subject = Image.open(folder / "mask.png").convert("L")
                editable = Image.open(folder / "editable-sky.png").convert("L")
                alpha = np.asarray(subject).copy()
                original = np.asarray(editable).copy()
                with np.load(raw_path) as data:
                    result, metrics = refine_sky_boundary(source, subject, editable, data["logits"])
                output = np.asarray(result)
                changed = output != original
                distance = distance_transform_edt(alpha < 128)
                np.testing.assert_array_equal(np.asarray(subject), alpha)
                self.assertTrue(np.all(output[alpha >= 2] == 0))
                self.assertTrue(np.all(output >= original))
                self.assertTrue(np.all(~changed | (distance <= metrics["reachPixels"])))
                if name == "big-ben":
                    self.assertEqual(result.getpixel((894, 651)), 255)
                    self.assertEqual(result.getpixel((835, 525)), 0)
                print(f"{name}: {json.dumps(metrics)}", flush=True)


def write_artifacts():
    reports = {}
    for name, folder, raw_path in frozen_fixtures():
        source = Image.open(folder / "source.webp").convert("RGB")
        subject = Image.open(folder / "mask.png").convert("L")
        editable = Image.open(folder / "editable-sky.png").convert("L")
        with np.load(raw_path) as data:
            result, metrics = refine_sky_boundary(source, subject, editable, data["logits"])
        destination = ROOT / "screenshots" / "edge-repair" / "refinement-candidates" / name
        destination.mkdir(parents=True, exist_ok=True)
        result.save(destination / "editable-after.png")
        changed = np.asarray(result) != np.asarray(editable)
        Image.fromarray(changed.astype(np.uint8) * 255).save(destination / "changed.png")
        style = folder / "styles" / "cinematic-night"
        saved_sky = Image.open(style / "render-sky.webp").convert("RGB")
        left = (saved_sky.width - source.width) // 2
        top = (saved_sky.height - source.height) // 2
        sky = saved_sky.crop((left, top, left + source.width, top + source.height))
        background, scene, _ = build_sky_layers(source, subject, result, sky)
        subject_rgba = Image.open(style / "subject.png").convert("RGBA")
        final = Image.alpha_composite(background.convert("RGBA"), subject_rgba).convert("RGB")
        final.save(destination / "composite-after.png")
        scene.save(destination / "scene-after.png")
        before = Image.open(style / "composite.png").convert("RGB")
        panels = [("Original", source), ("Frozen before", before), ("Same sky / refined", final)]
        panel_width = 420
        panel_height = round(source.height * panel_width / source.width)
        montage = Image.new("RGB", (panel_width * 3, panel_height + 28), (24, 24, 24))
        draw = ImageDraw.Draw(montage)
        for index, (title, picture) in enumerate(panels):
            draw.text((index * panel_width + 8, 7), title, fill="white")
            montage.paste(picture.resize((panel_width, panel_height)), (index * panel_width, 28))
        montage.save(destination / "comparison.png")
        metrics["subjectAlphaChangedPixels"] = int(np.count_nonzero(
            np.asarray(subject_rgba.getchannel("A")) != np.asarray(subject)
        ))
        metrics["sameFrozenSky"] = True
        (destination / "metrics.json").write_text(json.dumps(metrics, indent=2), encoding="utf8")
        reports[name] = metrics
    print(json.dumps(reports, indent=2), flush=True)


if __name__ == "__main__":
    suite = unittest.main(exit=False)
    if not suite.result.wasSuccessful():
        sys.exit(1)
    if ARTIFACTS:
        write_artifacts()
