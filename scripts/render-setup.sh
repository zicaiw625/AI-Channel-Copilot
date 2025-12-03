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

echo "[render-setup] Using DATABASE_URL=$DATABASE_URL" >&2

# 尝试修复失败的迁移状态 (仅针对已知的失败迁移)
# 注意：这只是一个临时修复，成功部署后应该移除
echo "[render-setup] Attempting to resolve potential failed migration state..."
npx prisma migrate resolve --rolled-back 20251203_add_performance_indexes || true

npx prisma generate
npx prisma migrate deploy
