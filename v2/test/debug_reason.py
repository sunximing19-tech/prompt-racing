import asyncio, json, sys
sys.path.insert(0, r"D:\codex_project")
from agent.agent_core import run_agent_once, to_langchain_messages
from agent.skills import get_store

async def main():
    store = get_store()
    agent = run_agent_once("test-key", "deepseek-v4-pro", "http://127.0.0.1:39001",
                           "You are a helpful AI assistant.",
                           [{"role": "user", "content": "现在几点了？"}], True, store)
    msgs = to_langchain_messages([{"role": "user", "content": "现在几点了？"}])
    n = 0
    async for event in agent.astream_events({"messages": msgs}, config={"recursion_limit": 30}, version="v2"):
        if event.get("event") == "on_chat_model_stream":
            n += 1
            if n > 8: break
            chunk = event["data"]["chunk"]
            print(n, "| content=", repr(chunk.content)[:60])
            print("   additional_kwargs=", json.dumps(chunk.additional_kwargs, ensure_ascii=False, default=str)[:200])
            print("   model_extra=", json.dumps(getattr(chunk, "model_extra", None) or {}, ensure_ascii=False, default=str)[:200])

asyncio.run(main())
