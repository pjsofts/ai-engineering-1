# vectors.py — the one piece of maths behind semantic search.
#
# An embedding is a direction in space. Texts that mean similar things point
# in similar directions. Cosine similarity measures how alike two directions are:
#   1.0  same direction (same meaning)
#   0.0  unrelated
import math


def dot(a, b):
    return sum(x * y for x, y in zip(a, b))


def length(vector):
    return math.sqrt(dot(vector, vector))


def cosine_similarity(a, b):
    return dot(a, b) / (length(a) * length(b))
