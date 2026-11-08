# Step 3 — The feature list
# The harness owns the plan: features.json. For each feature, in order:
#   the model writes code  ->  the harness runs the feature's check
# Only a passing check marks a feature "passing".
# The model saying "done" counts for nothing.
from agent import run_agent
from features import (load_features, next_feature, progress,
                      save_features, verify)
from tools import CHANGE, LOOK, reset_workspace

MAX_TRIES = 2

SYSTEM = """You are a coding agent working on a small Python project.
Implement ONLY the feature you are given. Nothing else.
Start by reading its check in checks/: that is exactly what will be tested.
You can read the checks, not change them."""


def run(task):
    features = load_features()

    while True:
        feature = next_feature(features)      # the harness picks one
        if feature is None:
            return f"All done: {progress(features)}"

        error = ""
        for attempt in range(1, MAX_TRIES + 1):
            build(feature, error)             # the model writes code
            passed, output = verify(feature)  # the harness decides
            if passed:
                break
            error = output                    # show the model what failed

        feature["state"] = "passing" if passed else "failing"
        feature["evidence"] = output
        save_features(features)

        if not passed:
            return (f"Stopped: {feature['id']} still fails after "
                    f"{MAX_TRIES} tries. A person should look.")


def build(feature, error):
    task = (f"Feature {feature['id']}: {feature['behavior']}\n"
            f"It is checked by: {feature['verify']}")
    if error:
        task += f"\n\nYour last try FAILED this check:\n{error}"
    messages = [
        {"role": "system", "content": SYSTEM},
        {"role": "user", "content": task},
    ]
    return run_agent(messages, LOOK + CHANGE)


if __name__ == "__main__":
    reset_workspace()      # start from a clean copy of the project
    print(run("features.json"))
