from deepeval.metrics import (
    ContextualPrecisionMetric,
    ContextualRecallMetric,
    ContextualRelevancyMetric,
)


# DeepEval's three retriever metrics. They judge the retrieval context only,
# so the guide's generated answer is not needed.
#   precision: are the relevant cafes ranked above the irrelevant ones?
#   recall:    does the context contain everything the expected answer says?
#   relevancy: how much of the context is relevant to the request at all?
RETRIEVAL_METRICS = [
    ContextualPrecisionMetric(),
    ContextualRecallMetric(),
    ContextualRelevancyMetric(),
]
