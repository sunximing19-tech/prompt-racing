import asyncio, json, sys
sys.path.insert(0, r"D:\codex_project")
from agent.agent_core import run_agent_once, stream_agent_events, to_langchain_messages
from agent.skills import get_store

async def main():
    store = get_store()
    agent = run_agent_once("test-key", "deepseek-v4-pro", "http://127.0.0.1:39001",
                           "You are a helpful AI assistant.",
                           [{"role": "user", "content": "现在几点了？"}],
                           True, store)
    msgs = to_langchain_messages([{"role": "user", "content": "现在几点了？"}])
    async for event in agent.astream_events({"messages": msgs}, config={"recursion_limit": 30}, version="v2"):
        kind = event.get("event")
        if kind in ("on_tool_start", "on_tool_end", "on_chat_model_stream"):
            name = event.get("name")
            data = event.get("data", {})
            out = {"event": kind, "name": name, "data_keys": list(data.keys())}
            if kind == "on_tool_start":
                out["input"] = data.get("input")
            elif kind == "on_tool_end":
                out["output_type"] = type(data.get("output")).__name__
            elif kind == "on_chat_model_stream":
                chunk = data.get("chunk")
                out["chunk_type"] = type(chunk).__name__
                out["content"] = chunk.content if hasattr(chunk, "content") else None
                out["additional_kwargs"] = getattr(chunk, "additional_kwargs", None)
            print(json.dumps(out, ensure_ascii=False, default=str)[:400])

asyncio.run(main())
