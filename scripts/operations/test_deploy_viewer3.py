"""Host release fixture tests. No real Docker, AWS or production access."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("release", Path(__file__).with_name("deploy-viewer3.py"))
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)

OLD = release.REGISTRY + "/s3orth:ohifar311-gha-" + "a"*12 + "-1@sha256:" + "a"*64
NEW = release.REGISTRY + "/s3orth:ohifar311-gha-" + "b"*12 + "-2@sha256:" + "b"*64
BASE = ("services:\n  viewer3:\n    image: " + OLD +
        "\n    environment:\n      OTHER: keep\n  formapi:\n    image: unchanged\n").encode()


class ReleaseTests(unittest.TestCase):
    def test_manifest_rejects_unreviewed_overlays_and_retained_override(self):
        cfg = self.root / "config/compose"
        cfg.mkdir(parents=True)
        (cfg / "images.yml").write_text("other pins")
        (self.root / ".ar-ses-invitation.override.yml").write_text("fixture")
        manifest = cfg / "manifest.json"
        files = ["docker-compose.yml", ".ar-ses-invitation.override.yml", "config/compose/images.yml"]
        manifest.write_text(json.dumps({"files": files, "version": 1}))
        self.assertEqual(len(release.checked_files(self.root)), 4)
        override = self.root / ".ar-formapi-deploy.override.yml"
        override.write_text("fixture")
        with self.assertRaises(RuntimeError):
            release.checked_files(self.root)
        override.unlink()
        manifest.write_text(json.dumps({"files": files + ["unreviewed.yml"], "version": 1}))
        with self.assertRaises(RuntimeError):
            release.checked_files(self.root)

    def test_compose_always_passes_managed_switch(self):
        with patch.object(release, "run", return_value=b"ok") as run:
            release.compose(self.root, "config", "--format", "json")
            run.assert_called_once_with(
                ["python3", str(self.root / "scripts/operations/ar-compose.py"),
                 "--ar-managed", "config", "--format", "json"], cwd=str(self.root))

    def test_pin_changes_only_viewer3(self):
        self.assertEqual(release.replace_viewer_pin(BASE, OLD, NEW),
                         BASE.replace(OLD.encode(), NEW.encode()))
        for invalid in (BASE.replace(OLD.encode(), NEW.encode()),
                        BASE + BASE, BASE.replace(b"    image: ", b"    image:  ", 1)):
            with self.assertRaises(RuntimeError):
                release.replace_viewer_pin(invalid, OLD, NEW)

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.base = self.root / "docker-compose.yml"
        self.base.write_bytes(BASE)
        self.overlay = self.root / "images.yml"
        self.overlay.write_bytes(b"other pins")
        self.running = OLD
        self.calls = []
        self.fail_new = False
        self.fail_rollback = False
        self.fail_config = False

    def effective(self, _root):
        viewer = NEW if NEW.encode() in self.base.read_bytes() else OLD
        if viewer == NEW and self.fail_config:
            viewer = OLD
        return dict({name: name + "-pin" for name in release.OTHER_MANAGED}, viewer3=viewer)

    def runtime(self, name):
        return self.running if name == "viewer3" else name + "-pin"

    def compose(self, _root, *args):
        self.calls.append(args)
        self.assertEqual(args, ("up", "-d", "--no-deps", "--pull", "never", "viewer3"))
        desired = NEW if NEW.encode() in self.base.read_bytes() else OLD
        if desired == OLD and self.fail_rollback:
            raise RuntimeError("rollback unavailable")
        self.running = desired

    def ready(self, image, attempts=25):
        return self.running == image and not (image == NEW and self.fail_new)

    def deploy(self):
        with patch.multiple(release, checked_files=lambda root: [self.base, self.overlay],
                            effective_images=self.effective, runtime=self.runtime,
                            container_ids=lambda: {"other": "original-id"}, compose=self.compose,
                            ready=self.ready, pull_images=lambda *args: None, run=lambda *args, **kw: b""):
            release.deploy_locked(self.root, NEW, OLD)

    def test_success_persists_and_only_recreates_viewer3(self):
        self.deploy()
        self.assertEqual(self.running, NEW)
        self.assertEqual(self.base.read_bytes(), BASE.replace(OLD.encode(), NEW.encode()))
        self.assertEqual(len(self.calls), 1)
        self.assertEqual(self.overlay.read_bytes(), b"other pins")
        self.assertEqual(len(list(self.root.glob(".ar-viewer3-before-*"))), 1)

    def test_effective_mismatch_restores_without_recreate(self):
        self.fail_config = True
        with self.assertRaises(RuntimeError):
            self.deploy()
        self.assertEqual(self.base.read_bytes(), BASE)
        self.assertEqual(self.calls, [])
        self.assertEqual(self.running, OLD)

    def test_readiness_failure_rolls_back(self):
        self.fail_new = True
        with self.assertRaises(RuntimeError):
            self.deploy()
        self.assertEqual(self.running, OLD)
        self.assertEqual(self.base.read_bytes(), BASE)
        self.assertEqual(len(self.calls), 2)

    def test_unverified_rollback_retains_snapshot(self):
        self.fail_new = True
        self.fail_rollback = True
        with self.assertRaises(RuntimeError):
            self.deploy()
        self.assertEqual(self.base.read_bytes(), BASE)
        self.assertEqual(self.running, NEW)
        snapshots = list(self.root.glob(".ar-viewer3-before-*/docker-compose.yml"))
        self.assertEqual(len(snapshots), 1)
        self.assertEqual(snapshots[0].read_bytes(), BASE)
        self.assertEqual(snapshots[0].stat().st_mode & 0o777, 0o600)

    def test_drift_fails_before_any_write(self):
        self.running = NEW
        with self.assertRaises(RuntimeError):
            self.deploy()
        self.assertEqual(self.base.read_bytes(), BASE)
        self.assertEqual(self.calls, [])


if __name__ == "__main__":
    unittest.main()
