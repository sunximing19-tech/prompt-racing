"""工具定义：LangChain 工具（function calling）。
包含 3 个内置工具 + 渐进式披露的 use_skill 工具。"""
from datetime import datetime
from typing import Any, Callable, Optional

from langchain_core.tools import tool
from langchain_core.tools.base import BaseTool

from .skills import SkillStore


@tool
def get_current_time() -> str:
    """获取当前本地时间（24 小时制）。"""
    return datetime.now().strftime("%H:%M:%S")


@tool
def get_today_date() -> str:
    """获取今天的日期（公历，中文格式）。"""
    return datetime.now().strftime("%Y年%m月%d日")


@tool
def calculate(expression: str) -> str:
    """计算数学表达式，如 "(1+2)*3"。表达式只允许数字与 + - * / ( ) . % 等字符。"""
    import re

    cleaned = re.sub(r"[^0-9+\-*/().%\s]", "", str(expression))
    if not cleaned:
        return "表达式为空"
    try:
        value = eval(cleaned, {"__builtins__": {}}, {})  # 白名单过滤后本地求值
        return str(value)
    except Exception as e:  # noqa: BLE001
        return f"计算失败：{e}"


def make_use_skill_tool(store: SkillStore, loaded: set[str]) -> BaseTool:
    """渐进式披露工具：按需返回某个启用 Skill 的完整指令内容。"""
    @tool
    def use_skill(name: str) -> str:
        """当你判断用户需求匹配某个 Skill（在系统提示的 Skill 索引中列出）时，
        调用本工具获取该 Skill 的完整指令，然后严格按指令执行。"""
        content = store.content_by_name(name)
        if content is None:
            return f"未找到启用的 Skill「{name}」，请检查名称是否与索引一致。"
        loaded.add(name)
        return content

    use_skill.name = "use_skill"  # type: ignore[attr-defined]
    return use_skill


def build_tools(store: SkillStore, use_skills: bool) -> list[BaseTool]:
    loaded: set[str] = set()
    tools: list[BaseTool] = [get_current_time, get_today_date, calculate]
    if use_skills:
        tools.append(make_use_skill_tool(store, loaded))
    return tools
