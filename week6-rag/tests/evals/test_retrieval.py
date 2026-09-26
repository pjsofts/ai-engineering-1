"""Compare the cafe guide's retrieval with and without Jev re-ranking.

Each golden runs twice: once with the plain vector top 4, once with the vector
top 8 re-ranked by Jev. Both runs are scored with the same three contextual
metrics, so the difference between them is the effect of re-ranking.

Run from the project root:
    deepeval test run tests/evals/test_retrieval.py
"""
import sys
from pathlib import Path

import pytest

from deepeval import assert_test
from deepeval.dataset import EvaluationDataset, Golden
from deepeval.test_case import LLMTestCase

from metrics import RETRIEVAL_METRICS

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
import chat  # noqa: E402


dataset = EvaluationDataset()
dataset.add_goldens_from_json_file(
    file_path=str(Path(__file__).with_name(".dataset.json")))


@pytest.mark.parametrize("use_jev", [False, True], ids=["vector_only", "vector_plus_jev"])
@pytest.mark.parametrize("golden", dataset.goldens)
def test_retrieval(golden: Golden, use_jev: bool):
    hits = chat.retrieve(golden.input, use_jev=use_jev)
    retrieval_context = [chat.hit_text(hit) for hit in hits]

    label = "vector + Jev" if use_jev else "vector only"
    print(f"\n  {label} retrieved, in order:")
    for rank, hit in enumerate(hits, start=1):
        print(f"    #{rank} {hit.metadata['name']}")

    test_case = LLMTestCase(
        input=golden.input,
        # The contextual metrics score retrieval only, so no answer is generated.
        actual_output="",
        expected_output=golden.expected_output,
        retrieval_context=retrieval_context,
    )
    assert_test(test_case=test_case, metrics=RETRIEVAL_METRICS)
