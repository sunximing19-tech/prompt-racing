"""Agent 核心：使用 LangChain 生态（LangGraph ReAct Agent）构建智能体。

- 模型：OpenAI 兼容接口（默认 DeepSeek），通过 langchain-openai 的 ChatOpenAI 接入
- 工具：LangChain tool（function calling），方便以后继续增加
- 渐进式披露：系统提示只放 Skill 索引（名称+描述），完整指令由 use_skill 工具按需返回
"""
from typing import Any, AsyncIterator, Optional

from langchain_core.messages import BaseMessage, HumanMessage
from langchain_deepseek import ChatDeepSeek
from langgraph.graph.state import CompiledStateGraph
from langgraph.prebuilt import create_react_agent

from .skills import SkillStore
from .tools import build_tools

DEFAULT_MODEL = "deepseek-v4-pro"
DEFAULT_BASE_URL = "https://api.deepseek.com"
MAX_TOOL_ROUNDS = 6

_SKILL_INDEX_TEMPLATE = (
    "\n\n【可用 Skill 索引（渐进式披露）】\n"
    "你拥有以下已启用的 Skill。当用户需求匹配某个 Skill 时，先调用 use_skill(name) "
    "获取该 Skill 的完整指令，再按指令执行；不要凭空猜测 Skill 内容。\n"
    "注意：每次调用工具（含 use_skill）拿到结果后，都必须继续推理，并结合工具结果"
    "给出最终的完整答复，不要在调用工具后直接结束。\n"
    "{index}\n"
)


def build_system_prompt(user_system: str, store: SkillStore) -> str:
    """组装系统提示：用户自定义 System Prompt + Skill 索引（不含完整内容）。"""
    index = store.index()
    if not index:
        return user_system or "You are a helpful AI assistant."
    lines = "\n".join(
        f"- Skill「{item['name']}」：{item['description'] or '（无描述）'}" for item in index
    )
    return (user_system or "You are a helpful AI assistant.") + _SKILL_INDEX_TEMPLATE.format(
        index=lines
    )


def build_agent(
    api_key: str,
    model: str,
    base_url: str,
    system_prompt: str,
    use_skills: bool,
    store: SkillStore,
) -> CompiledStateGraph:
    """构建 LangGraph ReAct Agent。"""
    llm = ChatDeepSeek(
        model=model or DEFAULT_MODEL,
        api_key=api_key,
        base_url=(base_url or DEFAULT_BASE_URL).rstrip("/"),
        temperature=0.7,
        max_retries=1,
        timeout=120,
        streaming=True,
    )
    tools = build_tools(store, use_skills)
    agent = create_react_agent(llm, tools, prompt=system_prompt, version="v2")
    return agent


def _chunk_content(chunk: Any) -> str:
    """从 AIMessageChunk 提取文本增量（兼容 str 与 list 两种格式）。"""
    content = getattr(chunk, "content", "")
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for item in content:
            if isinstance(item, str):
                parts.append(item)
            elif isinstance(item, dict):
                text = item.get("text") or item.get("content") or ""
                if text:
                    parts.append(text)
        return "".join(parts)
    return ""


def _chunk_reasoning(chunk: Any) -> str:
    """从 AIMessageChunk 提取推理/思考增量（DeepSeek 的 reasoning_content）。"""
    extra = getattr(chunk, "additional_kwargs", {}) or {}
    value = extra.get("reasoning_content") or extra.get("reasoning")
    return value or ""


def format_sse(obj: dict[str, Any]) -> str:
    """把事件对象转成 SSE 文本。"""
    import json

    return f"data: {json.dumps(obj, ensure_ascii=False)}\n\n"


async def stream_agent_events(
    agent: CompiledStateGraph,
    messages: list[BaseMessage],
    max_rounds: int = MAX_TOOL_ROUNDS,
) -> AsyncIterator[dict[str, Any]]:
    """运行 Agent 并以事件流方式产出前端可用的事件。

    事件类型：
      - {type: content, delta}     正文增量
      - {type: reasoning, delta}   思考增量
      - {type: tool_start, name, arguments}
      - {type: tool_end, name, output}
      - {type: done, content, reasoning, toolCalls}
      - {type: error, message}
    """
    config: dict[str, Any] = {"recursion_limit": max_rounds * 4 + 10}
    tool_calls_trace: list[dict[str, Any]] = []
    final_content = ""
    final_reasoning = ""
    try:
        async for event in agent.astream_events(
            {"messages": messages}, config=config, version="v2"
        ):
            kind = event.get("event")
            if kind == "on_chat_model_stream":
                chunk = event.get("data", {}).get("chunk")
                if chunk is None:
                    continue
                delta = _chunk_content(chunk)
                if delta:
                    final_content += delta
                    yield {"type": "content", "delta": delta}
                reasoning = _chunk_reasoning(chunk)
                if reasoning:
                    final_reasoning += reasoning
                    yield {"type": "reasoning", "delta": reasoning}
            elif kind == "on_tool_start":
                name = event.get("name") or ""
                raw_input = event.get("data", {}).get("input") or {}
                if isinstance(raw_input, dict) and isinstance(raw_input.get("args"), dict):
                    arguments = raw_input["args"]
                else:
                    arguments = raw_input
                yield {"type": "tool_start", "name": name, "arguments": arguments}
            elif kind == "on_tool_end":
                name = event.get("name") or ""
                output = event.get("data", {}).get("output")
                if hasattr(output, "content"):
                    output = output.content
                tool_calls_trace.append({"name": name, "output": str(output)})
                yield {"type": "tool_end", "name": name, "output": str(output)}
        yield {
            "type": "done",
            "content": final_content,
            "reasoning": final_reasoning,
            "toolCalls": tool_calls_trace,
        }
    except Exception as e:  # noqa: BLE001
        yield {"type": "error", "message": str(e)}


def to_langchain_messages(conversation: list[dict[str, Any]]) -> list[BaseMessage]:
    """把前端传来的消息数组转成 LangChain 消息（system 由调用方单独传入）。"""
    from langchain_core.messages import AIMessage

    result: list[BaseMessage] = []
    for msg in conversation:
        role = msg.get("role")
        content = msg.get("content") or ""
        if role == "user":
            result.append(HumanMessage(content=content))
        elif role == "assistant":
            result.append(AIMessage(content=content))
        else:
            result.append(HumanMessage(content=content))
    return result


def run_agent_once(
    api_key: str,
    model: str,
    base_url: str,
    user_system: str,
    history: list[dict[str, Any]],
    use_skills: bool,
    store: SkillStore,
) -> CompiledStateGraph:
    """一次性构建 agent（供服务端每次请求使用）。"""
    system_prompt = build_system_prompt(user_system, store)
    return build_agent(api_key, model, base_url, system_prompt, use_skills, store)
