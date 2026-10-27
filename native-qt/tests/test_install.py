import os
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def run(script: str, home: Path, *args: str) -> subprocess.CompletedProcess[str]:
    env = os.environ.copy()
    env["HOME"] = str(home)
    return subprocess.run(
        ["bash", str(ROOT / "scripts" / script), *args],
        cwd=ROOT,
        env=env,
        text=True,
        capture_output=True,
        check=False,
    )


def test_install_requires_yes_and_dry_run_writes_nothing(tmp_path: Path):
    refused = run("install.sh", tmp_path)
    assert refused.returncode == 2
    assert not (tmp_path / "layr-native-qt").exists()
    dry = run("install.sh", tmp_path, "--dry-run", "--yes")
    assert dry.returncode == 0, dry.stderr
    assert not (tmp_path / "layr-native-qt").exists()


def test_install_and_rollback_round_trip(tmp_path: Path):
    first = run("install.sh", tmp_path, "--yes")
    assert first.returncode == 0, first.stderr
    current = tmp_path / "layr-native-qt" / "current"
    assert (current / "layr_qt" / "__main__.py").is_file()
    first_release = current.resolve()

    second = run("install.sh", tmp_path, "--yes")
    assert second.returncode == 0, second.stderr
    assert current.resolve() != first_release

    rolled = run("rollback.sh", tmp_path, "--yes")
    assert rolled.returncode == 0, rolled.stderr
    assert current.resolve() == first_release

    refused = run("rollback.sh", tmp_path)
    assert refused.returncode == 2
