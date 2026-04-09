#!/usr/bin/env bash
# 清理 ai-agent 相关的残留进程
# 用法: bash cleanup.sh

set -euo pipefail

echo "=== 查找 ai-agent 相关进程 ==="

PIDS=$(ps aux | grep -E 'bun.*(dev-entry|ai-agent|open-claude-code)' | grep -v grep | awk '{print $2}' || true)

if [ -z "$PIDS" ]; then
    echo "  没有发现残留进程 ✓"
    exit 0
fi

echo "  发现以下进程:"
ps aux | grep -E 'bun.*(dev-entry|ai-agent|open-claude-code)' | grep -v grep || true
echo ""

for PID in $PIDS; do
    echo "  终止进程 PID: $PID"
    kill "$PID" 2>/dev/null || true
done

# 等待 2 秒，检查是否还有残留
sleep 2
REMAINING=$(ps aux | grep -E 'bun.*(dev-entry|ai-agent|open-claude-code)' | grep -v grep | awk '{print $2}' || true)

if [ -n "$REMAINING" ]; then
    echo "  强制终止残留进程..."
    for PID in $REMAINING; do
        kill -9 "$PID" 2>/dev/null || true
    done
fi

echo "=== 清理完成 ==="
