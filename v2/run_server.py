"""AI Agent v2 服务启动入口（同时用于 PyInstaller 打包）。"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from agent.server import main  # noqa: E402

if __name__ == "__main__":
    main()
