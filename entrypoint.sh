#!/bin/bash
set -e

PUID=${PUID:-1000}
PGID=${PGID:-1000}

# 容器内默认用户是 root (uid=0)
CURRENT_UID=$(id -u)

if [ "$CURRENT_UID" = "0" ]; then
    # 如果目标 GID 已存在但名称不同，先处理
    EXISTING_GROUP=$(getent group "$PGID" | cut -d: -f1 || true)
    if [ -n "$EXISTING_GROUP" ] && [ "$EXISTING_GROUP" != "zhubi" ]; then
        groupmod -n zhubi "$EXISTING_GROUP" 2>/dev/null || true
    elif [ -z "$EXISTING_GROUP" ]; then
        groupadd -g "$PGID" zhubi
    fi

    # 同理处理 UID
    EXISTING_USER=$(getent passwd "$PUID" | cut -d: -f1 || true)
    if [ -n "$EXISTING_USER" ] && [ "$EXISTING_USER" != "zhubi" ]; then
        usermod -l zhubi "$EXISTING_USER" 2>/dev/null || true
        usermod -d /app -m zhubi 2>/dev/null || true
    elif [ -z "$EXISTING_USER" ]; then
        useradd -u "$PUID" -g "$PGID" -d /app -M -s /bin/bash zhubi
    fi

    # 确保 /app/data 可写
    chown -R "$PUID":"$PGID" /app/data

    echo "[zhubi] uid=$PUID gid=$PGID"
    exec gosu "$PUID":"$PGID" "$@"
else
    # 非 root 启动（某些编排环境），直接运行
    exec "$@"
fi
