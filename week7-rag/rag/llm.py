# llm.py — the only code that talks to the API.
#
#   embed(texts)           -> list of vectors, one per text
#   ask(prompt, system)    -> str
#   chat(messages, tools)  -> Reply   (one agent turn; the model may ask for tools)
import inspect
import json
import os
from dataclasses import dataclass, field

from dotenv import load_dotenv
from openai import OpenAI

load_dotenv()
client = OpenAI()   # reads OPENAI_API_KEY and OPENAI_BASE_URL from .env
MODEL = os.environ.get("MODEL", "gpt-4o-mini")
EMBED_MODEL = os.environ.get("EMBED_MODEL", "text-embedding-3-small")


def embed(texts):
    """Turn each text into a vector (a list of 1536 numbers).
    One API call for the whole list: much cheaper than one call per text."""
    response = client.embeddings.create(model=EMBED_MODEL, input=texts)
    return [item.embedding for item in response.data]


def ask(prompt, system="You are a helpful assistant. Be concise."):
    response = client.chat.completions.create(
        model=MODEL,
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": prompt},
        ],
    )
    return response.choices[0].message.content


# ---- for the agent demo (same as in the workflows webinar) -----------------

@dataclass
class ToolCall:
    id: str
    name: str
    args: dict


@dataclass
class Reply:
    text: str
    tool_calls: list = field(default_factory=list)

    @property
    def message(self):
        """This reply as a message you can append to the conversation."""
        message = {"role": "assistant", "content": self.text}
        if self.tool_calls:
            message["tool_calls"] = [
                {"id": call.id, "type": "function",
                 "function": {"name": call.name, "arguments": json.dumps(call.args)}}
                for call in self.tool_calls
            ]
        return message


def chat(messages, tools=()):
    extra = {"tools": [tool_schema(tool) for tool in tools]} if tools else {}
    response = client.chat.completions.create(model=MODEL, messages=messages, **extra)
    message = response.choices[0].message
    calls = [
        ToolCall(call.id, call.function.name, json.loads(call.function.arguments))
        for call in message.tool_calls or []
    ]
    return Reply(message.content or "", calls)


def tool_result(call, result):
    """The message that tells the model what a tool returned."""
    return {"role": "tool", "tool_call_id": call.id, "content": str(result)}


def tool_schema(function):
    """Describe a plain Python function so the model can call it.
    The model sees the name, the docstring and the parameters."""
    params = inspect.signature(function).parameters
    return {
        "type": "function",
        "function": {
            "name": function.__name__,
            "description": inspect.getdoc(function) or "",
            "parameters": {
                "type": "object",
                "properties": {name: {"type": "string"} for name in params},
                "required": list(params),
            },
        },
    }
