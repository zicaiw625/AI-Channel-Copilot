#!/usr/bin/env bash
set -euo pipefail

DB_URL="${DATABASE_URL:-}"
if [[ -z "$DB_URL" ]]; then
  echo "[render-setup] DATABASE_URL is not set" >&2
  exit 1
fi

# Append sslmode=require if missing (Render Postgres typically requires TLS)
if [[ "$DB_URL" != *"sslmode="* && "$DB_URL" != *"ssl="* ]]; then
  if [[ "$DB_URL" == *"?"* ]]; then
    DB_URL="${DB_URL}&sslmode=require"
  else
    DB_URL="${DB_URL}?sslmode=require"
  fi
fi

export DATABASE_URL="$DB_URL"

# 仅输出脱敏后的连接信息（隐藏密码和用户名）
DB_HOST=$(echo "$DATABASE_URL" | sed -E 's|.*@([^/:]+).*|\1|' || echo "unknown")
echo "[render-setup] Database host: $DB_HOST" >&2

npx prisma generate
npx prisma migrate deploy
