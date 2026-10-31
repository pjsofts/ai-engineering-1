# Step 2 — Embeddings
# Embed a question and a few sentences, then rank the sentences by how close
# they are to the question. Watch the top match: it shares no words with it.
from llm import embed
from vectors import cosine_similarity

SENTENCES = [
    "Deduct money from the customer's saved card",
    "Render the navigation bar at the top of the page",
    "Refuse clients that send too many requests per minute",
    "Email the receipt after an order is placed",
    "Hash the password with a random salt",
]


def run(question):
    vectors = embed([question] + SENTENCES)          # one call, six vectors
    question_vector, sentence_vectors = vectors[0], vectors[1:]

    ranking = rank(question_vector, sentence_vectors)
    return "\n".join(f"{item['score']:.3f}  {item['text']}" for item in ranking)


def rank(question_vector, sentence_vectors):
    ranking = []
    for sentence, vector in zip(SENTENCES, sentence_vectors):
        score = cosine_similarity(question_vector, vector)
        ranking.append({"text": sentence, "score": round(score, 3)})
    ranking.sort(key=lambda item: item["score"], reverse=True)
    return ranking


if __name__ == "__main__":
    print(run("take payment from a user"))
