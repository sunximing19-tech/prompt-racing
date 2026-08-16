"""Skill 存储：JSON 文件持久化，线程安全。"""
import json
import os
import threading
import uuid
from typing import Any, Optional

_DEFAULT_DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data")


class SkillStore:
    def __init__(self, path: Optional[str] = None) -> None:
        self.path = path or os.path.join(
            os.environ.get("AI_AGENT_DATA_DIR", _DEFAULT_DATA_DIR), "skills.json"
        )
        self._lock = threading.Lock()
        self._skills: list[dict[str, Any]] = []
        self._load()

    def _load(self) -> None:
        try:
            with open(self.path, "r", encoding="utf-8") as f:
                data = json.load(f)
            self._skills = data if isinstance(data, list) else []
        except (OSError, ValueError):
            self._skills = []
        for s in self._skills:
            s.setdefault("id", uuid.uuid4().hex)
            s.setdefault("name", "")
            s.setdefault("description", "")
            s.setdefault("content", "")
            s.setdefault("enabled", True)
            s.setdefault("createdAt", 0)
            s.setdefault("updatedAt", 0)

    def _save(self) -> None:
        os.makedirs(os.path.dirname(self.path), exist_ok=True)
        tmp = self.path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(self._skills, f, ensure_ascii=False, indent=2)
        os.replace(tmp, self.path)

    def list_all(self) -> list[dict[str, Any]]:
        with self._lock:
            return sorted(
                (dict(s) for s in self._skills),
                key=lambda s: (s.get("updatedAt") or 0),
                reverse=True,
            )

    def create(self, name: str, description: str = "", content: str = "") -> dict[str, Any]:
        with self._lock:
            now = int(__import__("time").time() * 1000)
            skill = {
                "id": uuid.uuid4().hex,
                "name": (name or "").strip()[:80],
                "description": (description or "").strip()[:300],
                "content": content or "",
                "enabled": True,
                "createdAt": now,
                "updatedAt": now,
            }
            self._skills.append(skill)
            self._save()
            return dict(skill)

    def update(self, skill_id: str, fields: dict[str, Any]) -> Optional[dict[str, Any]]:
        with self._lock:
            for s in self._skills:
                if s.get("id") != skill_id:
                    continue
                for key in ("name", "description", "content"):
                    if key in fields:
                        s[key] = str(fields[key])
                if "enabled" in fields:
                    s["enabled"] = bool(fields["enabled"])
                s["updatedAt"] = int(__import__("time").time() * 1000)
                self._save()
                return dict(s)
            return None

    def delete(self, skill_id: str) -> bool:
        with self._lock:
            before = len(self._skills)
            self._skills = [s for s in self._skills if s.get("id") != skill_id]
            if len(self._skills) != before:
                self._save()
                return True
            return False

    def index(self) -> list[dict[str, str]]:
        """渐进式披露：只返回启用的 Skill 的名称与一句话描述（索引）。"""
        with self._lock:
            return [
                {"name": s.get("name", ""), "description": s.get("description", "")}
                for s in self._skills
                if s.get("enabled") and s.get("name")
            ]

    def content_by_name(self, name: str) -> Optional[str]:
        """返回启用 Skill 的完整指令内容（按需披露），找不到返回 None。"""
        with self._lock:
            for s in self._skills:
                if s.get("enabled") and s.get("name") == name:
                    return s.get("content", "")
            return None


_store: Optional[SkillStore] = None
_store_lock = threading.Lock()


def get_store() -> SkillStore:
    global _store
    with _store_lock:
        if _store is None:
            _store = SkillStore()
        return _store
