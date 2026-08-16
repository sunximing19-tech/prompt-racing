"""AI Agent v2 后端服务（FastAPI + LangChain Agent）。

- 提供 /api/chat（SSE 流式 Agent 对话）、/api/skills（渐进式披露的 Skill 管理）
- 托管 public/ 静态页面（桌面版与网页版共用）
- 默认端口 34987，被占用自动换随机端口，启动后打印 PORT=<n> 供 Electron 读取
"""
import argparse
import os
import socket
import sys

# PyInstaller 打包后 __file__ 指向临时目录，需要改用资源路径
if getattr(sys, "frozen", False):
    BASE_DIR = os.path.dirname(sys.executable)
    _parent = os.path.dirname(BASE_DIR)
else:
    BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # 项目根目录
    _parent = BASE_DIR
PUBLIC_DIR = os.path.join(BASE_DIR, "public")
if not os.path.isdir(PUBLIC_DIR):
    PUBLIC_DIR = os.path.join(_parent, "public")

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse
from sse_starlette.sse import EventSourceResponse

from .agent_core import run_agent_once, stream_agent_events, to_langchain_messages
from .skills import get_store

DEFAULT_PORT = 34987
app = FastAPI(title="AI Agent v2")
store = get_store()


@app.get("/api/health")
async def health():
    return {"ok": True, "version": 2}


@app.get("/api/skills")
async def list_skills():
    return store.list_all()


@app.post("/api/skills")
async def create_skill(request: Request):
    body = await request.json()
    skill = store.create(
        name=str(body.get("name") or ""),
        description=str(body.get("description") or ""),
        content=str(body.get("content") or ""),
    )
    return JSONResponse(status_code=201, content=skill)


@app.patch("/api/skills/{skill_id}")
async def update_skill(skill_id: str, request: Request):
    body = await request.json()
    updated = store.update(skill_id, body)
    if updated is None:
        return JSONResponse(status_code=404, content={"error": "Skill 不存在"})
    return updated


@app.delete("/api/skills/{skill_id}")
async def delete_skill(skill_id: str):
    if store.delete(skill_id):
        return {"ok": True}
    return JSONResponse(status_code=404, content={"error": "Skill 不存在"})


@app.post("/api/chat")
async def chat(request: Request):
    api_key = request.headers.get("x-api-key") or ""
    body = await request.json()
    if not api_key:
        return JSONResponse(status_code=400, content={"error": "缺少 API Key"})

    user_system = str(body.get("system") or "")
    history = body.get("messages") or []
    model = str(body.get("model") or "")
    base_url = str(body.get("baseUrl") or "")
    use_skills = bool(body.get("toolsEnabled", True)) and bool(store.index())

    agent = run_agent_once(
        api_key=api_key,
        model=model,
        base_url=base_url,
        user_system=user_system,
        history=history,
        use_skills=use_skills,
        store=store,
    )
    messages = to_langchain_messages(history)

    async def event_gen():
        import json

        async for event in stream_agent_events(agent, messages):
            # 先转成 JSON 字符串，避免 sse-starlette 用 str() 输出 Python 格式
            yield {"event": "message", "data": json.dumps(event, ensure_ascii=False)}

    return EventSourceResponse(event_gen())


async def _index_fallback():
    index_file = os.path.join(PUBLIC_DIR, "index.html")
    if os.path.isfile(index_file):
        return FileResponse(index_file)
    return JSONResponse(status_code=404, content={"error": "Not Found"})


# 静态资源（必须在 API 路由之后注册，避免覆盖 /api/*）
@app.get("/{path:path}")
async def static_or_index(path: str):
    if path.startswith("api/"):
        return JSONResponse(status_code=404, content={"error": "接口不存在"})
    if not path:
        return await _index_fallback()
    candidate = os.path.normpath(os.path.join(PUBLIC_DIR, path))
    if os.path.commonpath([candidate, PUBLIC_DIR]) != PUBLIC_DIR:
        return JSONResponse(status_code=403, content={"error": "Forbidden"})
    if os.path.isfile(candidate):
        return FileResponse(candidate)
    return await _index_fallback()


def _find_free_port(start: int) -> int:
    if start:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            try:
                s.bind(("127.0.0.1", start))
                return start
            except OSError:
                pass
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def main() -> None:
    import uvicorn

    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    args = parser.parse_args()

    port = _find_free_port(args.port)
    # Electron 通过读取该行获知实际端口
    print(f"PORT={port}", flush=True)
    print(f"AI Agent v2 服务已启动: http://127.0.0.1:{port}", flush=True)
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="warning")


if __name__ == "__main__":
    main()
