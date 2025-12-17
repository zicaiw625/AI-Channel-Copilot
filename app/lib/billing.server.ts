/**
 * Billing Module - Re-exports
 * 
 * 此文件为向后兼容的重新导出入口
 * 实际实现已拆分为以下模块：
 * - billing/plans.ts - 计划配置
 * - billing/state.server.ts - 状态管理
 * - billing/shopify.server.ts - Shopify API 交互
 */

// ============================================================================
// Re-exports from state.server.ts
// ============================================================================

export {
  // Types
  type BillingState,
  
  // Constants
  DAY_IN_MS,
  
  // Validation
  isValidShopDomain,
  validateShopDomain,
  
  // Internal helpers (for advanced usage)
  toPlanId,
  planStateKey,
  computeIncrementalTrialUsage,
  applyTrialConsumption,
  
  // State CRUD
  getBillingState,
  upsertBillingState,
  
  // State Transitions
  activateFreePlan,
  setSubscriptionTrialState,
  setSubscriptionActiveState,
  setSubscriptionExpiredState,
  markShopUninstalled,
} from "./billing/state.server";

// ============================================================================
// Re-exports from shopify.server.ts
// ============================================================================

export {
  // Dev Shop Detection
  detectAndPersistDevShop,
  
  // Subscription Sync
  syncSubscriptionFromShopify,
  
  // Subscription Queries
  hasActiveSubscription,
  getActiveSubscriptionDetails,
  
  // Subscription Operations
  cancelSubscription,
  requestSubscription,
  
  // Helper Functions
  computeIsTestMode,
  shouldSkipBillingForPath,
  calculateRemainingTrialDays,
  shouldOfferTrial,
  
  // Legacy
  ensureBilling,
} from "./billing/shopify.server";

// ============================================================================
// Re-exports from plans.ts
// ============================================================================

export {
  type PlanId,
  type PlanTier,
  type PlanConfig,
  PLAN_CONFIGS,
  PRIMARY_BILLABLE_PLAN_ID,
  getPlanConfig,
  resolvePlanByShopifyName,
} from "./billing/plans";
