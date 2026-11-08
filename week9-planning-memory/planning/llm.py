# llm.py — the only code that talks to the model. The same as weeks 1 and 7.
#
#   chat(messages, tools)  -> Reply   one turn; the model may ask for tools
#   tool_result(call, result)         the message that carries a tool's answer
import inspect
import json
import os
from dataclasses import dataclass, field

from dotenv import load_dotenv
from openai import OpenAI

load_dotenv()
client = OpenAI()  # reads OPENAI_API_KEY and OPENAI_BASE_URL from .env
MODEL = os.environ.get("MODEL", "gpt-4o-mini")


@dataclass
class ToolCall:
    id: str        # links the call to its result
    name: str      # which tool
    args: dict     # the arguments the model chose


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
    The model sees the name, the docstring and the parameters. Nothing else."""
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
