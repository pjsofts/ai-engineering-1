# features.py — a feature list that the HARNESS owns, not the model.
#
# Each feature has a behavior, a command that checks it, and a state.
# Only one thing can move a feature to "passing": its command succeeding.
# The model writes code. It never decides that a feature is done.
import json

from tools import WORKSPACE, run_command

FEATURES_FILE = WORKSPACE / "features.json"


def load_features():
    return json.loads(FEATURES_FILE.read_text())


def save_features(features):
    FEATURES_FILE.write_text(json.dumps(features, indent=2))


def next_feature(features):
    """The first feature that is not passing yet, whose dependencies all pass."""
    passing = [f["id"] for f in features if f["state"] == "passing"]
    for feature in features:
        ready = all(dep in passing for dep in feature["deps"])
        if feature["state"] != "passing" and ready:
            return feature
    return None


def verify(feature):
    """Run the feature's check. True only if the command succeeds."""
    output = run_command(feature["verify"])
    return output.startswith("PASSED"), output


def progress(features):
    passing = sum(1 for feature in features if feature["state"] == "passing")
    return f"{passing} of {len(features)} features passing"
