import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { markAbandonedCheckoutsForAllShops } from "../lib/funnelService.server";
import { logger } from "../lib/logger.server";

/**
 * Cron job API for marking abandoned checkouts
 * 
 * 用法:
 * - GET: 查看任务状态
 * - POST: 执行放弃结账标记任务
 * 
 * 推荐配置:
 * - Vercel Cron: 每小时执行一次
 * - 或使用外部调度器 (如 cron-job.org) 调用此端点
 * 
 * vercel.json 配置示例:
 * {
 *   "crons": [{
 *     "path": "/api/cron/abandoned-checkouts",
 *     "schedule": "0 * * * *"
 *   }]
 * }
 */

// 用于验证 cron 请求的密钥（从环境变量读取）
const CRON_SECRET = process.env.CRON_SECRET;

/**
 * 验证 cron 请求
 * 支持多种验证方式:
 * 1. Vercel Cron 的 Authorization header
 * 2. 自定义 CRON_SECRET
 * 3. 本地开发模式 (无密钥时跳过验证)
 */
function verifyCronRequest(request: Request): boolean {
  // Vercel Cron 验证
  // 🔒 安全修复：必须确保 CRON_SECRET 已设置才进行比对，防止 "Bearer undefined" 绕过
  const authHeader = request.headers.get("authorization");
  if (CRON_SECRET && authHeader === `Bearer ${CRON_SECRET}`) {
    return true;
  }
  
  // 自定义密钥验证 (URL 参数)
  const url = new URL(request.url);
  const secret = url.searchParams.get("secret");
  if (CRON_SECRET && secret === CRON_SECRET) {
    return true;
  }
  
  // 本地开发模式 (未设置 CRON_SECRET 时允许访问)
  if (!CRON_SECRET && process.env.NODE_ENV === "development") {
    return true;
  }
  
  return false;
}

/**
 * GET: 查看任务状态
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  if (!verifyCronRequest(request)) {
    return new Response("Unauthorized", { status: 401 });
  }
  
  return Response.json({
    status: "ready",
    endpoint: "/api/cron/abandoned-checkouts",
    method: "POST to execute",
    description: "Marks checkouts as abandoned if not completed within 24 hours",
    schedule: "Recommended: hourly (0 * * * *)",
  });
};

/**
 * POST: 执行放弃结账标记任务
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const startTime = Date.now();
  
  // 验证请求
  if (!verifyCronRequest(request)) {
    logger.warn("[cron] Unauthorized abandoned-checkouts request", {
      ip: request.headers.get("x-forwarded-for") || "unknown",
    });
    return new Response("Unauthorized", { status: 401 });
  }
  
  try {
    logger.info("[cron] Starting abandoned checkouts job");
    
    // 从请求中获取可选的阈值参数
    const url = new URL(request.url);
    const hoursThreshold = parseInt(url.searchParams.get("hours") || "24", 10);
    
    // 验证阈值范围
    const validHours = Math.max(1, Math.min(168, hoursThreshold));
    
    // 执行标记任务
    const result = await markAbandonedCheckoutsForAllShops(validHours);
    
    const duration = Date.now() - startTime;
    
    logger.info("[cron] Completed abandoned checkouts job", {
      duration,
      ...result,
    });
    
    return Response.json({
      success: true,
      duration: `${duration}ms`,
      hoursThreshold: validHours,
      ...result,
    });
  } catch (error) {
    const err = error as Error;
    const duration = Date.now() - startTime;
    
    logger.error("[cron] Failed abandoned checkouts job", {
      duration,
    }, {
      error: err.message,
      stack: err.stack,
    });
    
    return Response.json({
      success: false,
      duration: `${duration}ms`,
      error: err.message,
    }, { status: 500 });
  }
};
