import numpy as np
from dotenv import load_dotenv
from openai import OpenAI

load_dotenv()

client = OpenAI()

resp = client.embeddings.create(
    input=["dog", "wall"],
    model="text-embedding-3-small")
embedding_a = resp.data[0].embedding
embedding_b = resp.data[1].embedding

print("vector a embedding is", len(embedding_a))
print("vector b embedding is", len(embedding_b))
similarity_score = np.dot(embedding_a, embedding_b)
print(similarity_score)
