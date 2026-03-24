import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Link, useLoaderData, useLocation } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { authenticate } from "../shopify.server";
import { getSettings } from "../lib/settings.server";
import { useUILanguage } from "../lib/useUILanguage";
import { resolveUILanguageFromRequest } from "../lib/language.server";
import styles from "../styles/app.dashboard.module.css";
import { hasFeature, FEATURES } from "../lib/access.server";
import { logger } from "../lib/logger.server";
import prisma from "../db.server";
import { buildEmbeddedAppPath } from "../lib/navigation";

// ============================================================================
// Types
// ============================================================================

interface TeamMember {
  id: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  isOwner: boolean;
  locale: string | null;
}

// ============================================================================
// Loader
// ============================================================================

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const auth = await authenticate.admin(request);
  if (auth instanceof Response) throw auth;
  const { admin, session } = auth;
  const shopDomain = session.shop;
  
  const isGrowth = await hasFeature(shopDomain, FEATURES.MULTI_STORE);
  const settings = await getSettings(shopDomain);
  const language = resolveUILanguageFromRequest(request, settings.languages?.[0] || "中文");

  // 获取店铺信息
  let shopName = shopDomain.replace(".myshopify.com", "");
  try {
    if (admin) {
      const response = await admin.graphql(`query { shop { name } }`);
      const data = await response.json();
      shopName = data?.data?.shop?.name || shopName;
    }
  } catch (e) {
    logger.debug("[team] Failed to fetch shop name", { shopDomain }, { error: e });
  }

  // 非 Growth 用户跳过团队成员查询
  if (!isGrowth) {
    return {
      language,
      shopDomain,
      shopName,
      isGrowth,
      teamMembers: [] as TeamMember[],
      currentUserEmail: session.onlineAccessInfo?.associated_user?.email || null,
    };
  }

  // 获取当前店铺的所有 session（代表访问过应用的用户）
  let teamMembers: TeamMember[] = [];
  
  try {
    const sessions = await prisma.session.findMany({
      where: { shop: shopDomain },
      orderBy: { expires: "desc" },
      take: 100, // 限制查询数量，避免性能问题
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        accountOwner: true,
        locale: true,
      },
    });
    
    // 去重并格式化（基于 email 去重）
    const seen = new Set<string>();
    teamMembers = sessions
      .filter(s => {
        if (!s.email) return false;
        if (seen.has(s.email)) return false;
        seen.add(s.email);
        return true;
      })
      .map(s => ({
        id: s.id,
        email: s.email,
        firstName: s.firstName,
        lastName: s.lastName,
        isOwner: s.accountOwner,
        locale: s.locale,
      }));
  } catch (e) {
    logger.warn("[team] Failed to fetch team members", { shopDomain }, { error: e });
  }

  return {
    language,
    shopDomain,
    shopName,
    isGrowth,
    teamMembers,
    currentUserEmail: session.onlineAccessInfo?.associated_user?.email || null,
  };
};

// ============================================================================
// Components
// ============================================================================

function MemberCard({
  member,
  isCurrent,
  en,
}: {
  member: TeamMember;
  isCurrent: boolean;
  en: boolean;
}) {
  const initials = [member.firstName?.[0], member.lastName?.[0]]
    .filter(Boolean)
    .join("")
    .toUpperCase() || (member.email?.[0] || "?").toUpperCase();

  return (
    <div
      role="listitem"
      aria-label={`${en ? "Team member" : "团队成员"}: ${member.email || ""}`}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 16,
        padding: 16,
        background: isCurrent ? "#f6ffed" : "#fff",
        border: isCurrent ? "2px solid #52c41a" : "1px solid #e0e0e0",
        borderRadius: 8,
      }}
    >
      {/* Avatar */}
      <div
        style={{
          width: 48,
          height: 48,
          borderRadius: "50%",
          background: member.isOwner ? "#635bff" : "#008060",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#fff",
          fontSize: 16,
          fontWeight: 600,
        }}
        aria-hidden="true"
      >
        {initials}
      </div>
      
      {/* Info */}
      <div style={{ flex: 1 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontWeight: 600, fontSize: 15, color: "#212b36" }}>
            {member.firstName && member.lastName
              ? `${member.firstName} ${member.lastName}`
              : member.email}
          </span>
          {member.isOwner && (
            <span
              style={{
                padding: "2px 6px",
                background: "#635bff",
                color: "#fff",
                borderRadius: 4,
                fontSize: 10,
                fontWeight: 500,
              }}
            >
              {en ? "Owner" : "所有者"}
            </span>
          )}
          {isCurrent && (
            <span
              style={{
                padding: "2px 6px",
                background: "#52c41a",
                color: "#fff",
                borderRadius: 4,
                fontSize: 10,
                fontWeight: 500,
              }}
            >
              {en ? "You" : "你"}
            </span>
          )}
        </div>
        <div style={{ fontSize: 13, color: "#637381", marginTop: 2 }}>
          {member.email}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export default function Team() {
  const { language, shopDomain, shopName, isGrowth, teamMembers, currentUserEmail } = useLoaderData<typeof loader>();
  const uiLanguage = useUILanguage(language);
  const en = uiLanguage === "English";
  const location = useLocation();
  const dashboardHref = buildEmbeddedAppPath("/app", location.search, { backTo: null, fromTab: null, tab: null });
  const billingHref = buildEmbeddedAppPath("/app/billing", location.search, { backTo: null, fromTab: null, tab: null });

  if (!isGrowth) {
    return (
      <s-page heading={en ? "Team Access" : "团队访问"}>
        <div className={styles.page}>
          <div style={{ marginBottom: 16 }}>
            <Link to={dashboardHref} className={styles.secondaryButton}>
              ← {en ? "Back to Dashboard" : "返回仪表盘"}
            </Link>
          </div>
          
          <div
            style={{
              textAlign: "center",
              padding: 60,
              background: "#f9fafb",
              borderRadius: 12,
              border: "2px dashed #c4cdd5",
            }}
          >
            <div style={{ fontSize: 48, marginBottom: 16 }}>🔒</div>
            <h2 style={{ margin: "0 0 8px", fontSize: 20, color: "#212b36" }}>
              {en ? "Requires Growth" : "需要 Growth 版"}
            </h2>
            <p style={{ margin: "0 0 20px", color: "#637381" }}>
              {en
                ? "Team management is available on the Growth plan. Upgrade to see who on your team has access."
                : "团队管理功能仅在 Growth 版中可用。升级后可查看团队成员的访问权限。"}
            </p>
            <Link
              to={billingHref}
              style={{
                display: "inline-block",
                padding: "12px 24px",
                background: "#008060",
                color: "#fff",
                borderRadius: 6,
                fontSize: 14,
                fontWeight: 600,
                textDecoration: "none",
              }}
            >
              {en ? "Upgrade to Growth" : "升级到 Growth 版"}
            </Link>
          </div>
        </div>
      </s-page>
    );
  }

  return (
    <s-page heading={en ? "Team Access" : "团队访问"}>
      <div className={styles.page}>
        {/* 顶部导航 */}
        <div style={{ marginBottom: 16, display: "flex", gap: 12, justifyContent: "space-between" }}>
          <Link to={dashboardHref} className={styles.secondaryButton}>
            ← {en ? "Back to Dashboard" : "返回仪表盘"}
          </Link>
          
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "6px 12px",
              background: "#f6ffed",
              border: "1px solid #b7eb8f",
              borderRadius: 20,
              fontSize: 13,
              color: "#389e0d",
              fontWeight: 500,
            }}
          >
            ✨ {en ? "Requires Growth" : "需要 Growth 版"}
          </div>
        </div>

        {/* 店铺信息 */}
        <div className={styles.card}>
          <div className={styles.sectionHeader}>
            <div>
              <p className={styles.sectionLabel}>{en ? "Store" : "店铺"}</p>
              <h3 className={styles.sectionTitle}>{shopName}</h3>
            </div>
            <span className={styles.badge}>
              {teamMembers.length} {en ? (teamMembers.length === 1 ? "member" : "members") : "位成员"}
            </span>
          </div>
          
          <p className={styles.helpText}>
            {en
              ? "Team members with access to this Shopify store can use AI Sales Tracker & Attribution."
              : "拥有此 Shopify 店铺访问权限的团队成员可以使用 AI Sales Tracker & Attribution。"}
          </p>
        </div>

        {/* 成员列表 */}
        <div className={styles.card} style={{ marginTop: 20 }}>
          <div className={styles.sectionHeader}>
            <div>
              <p className={styles.sectionLabel}>{en ? "Team Members" : "团队成员"}</p>
              <h3 className={styles.sectionTitle}>
                {en ? "People with Access" : "有访问权限的人员"}
              </h3>
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 16 }}>
            {teamMembers.length > 0 ? (
              teamMembers.map((member) => (
                <MemberCard
                  key={member.id}
                  member={member}
                  isCurrent={member.email != null && member.email === currentUserEmail}
                  en={en}
                />
              ))
            ) : (
              <div
                style={{
                  textAlign: "center",
                  padding: 40,
                  color: "#637381",
                }}
              >
                {en
                  ? "No team members found. Invite staff to your Shopify store to grant access."
                  : "未找到团队成员。邀请员工加入您的 Shopify 店铺以授予访问权限。"}
              </div>
            )}
          </div>
        </div>

        {/* 如何添加成员 */}
        <div className={styles.card} style={{ marginTop: 20 }}>
          <div className={styles.sectionHeader}>
            <div>
              <p className={styles.sectionLabel}>{en ? "Add Members" : "添加成员"}</p>
              <h3 className={styles.sectionTitle}>
                {en ? "How to Grant Access" : "如何授予访问权限"}
              </h3>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginTop: 16 }}>
            <StepCard
              step="1"
              title={en ? "Go to Shopify Settings" : "进入 Shopify 设置"}
              description={en
                ? "Open your Shopify Admin and go to Settings → Users and permissions"
                : "打开 Shopify 后台，进入 设置 → 用户和权限"}
            />
            <StepCard
              step="2"
              title={en ? "Add Staff Member" : "添加员工"}
              description={en
                ? "Click 'Add staff' and enter their email address"
                : "点击「添加员工」并输入对方的邮箱地址"}
            />
            <StepCard
              step="3"
              title={en ? "Set Permissions" : "设置权限"}
              description={en
                ? "Grant them access to 'Apps' permission to use AI Sales Tracker & Attribution"
                : "授予「应用」权限以使用 AI Sales Tracker & Attribution"}
            />
            <StepCard
              step="4"
              title={en ? "Automatic Access" : "自动获得访问权限"}
              description={en
                ? "Once they accept the invite, they can access this app automatically"
                : "一旦对方接受邀请，即可自动访问此应用"}
            />
          </div>

          <div style={{ marginTop: 20 }}>
            <a
              href={`https://${shopDomain}/admin/settings/account/users`}
              target="_blank"
              rel="noreferrer"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                padding: "12px 20px",
                background: "#008060",
                color: "#fff",
                borderRadius: 6,
                fontSize: 14,
                fontWeight: 600,
                textDecoration: "none",
              }}
            >
              {en ? "Open Shopify Settings →" : "打开 Shopify 设置 →"}
            </a>
          </div>
        </div>

        {/* 权限说明 */}
        <div
          style={{
            marginTop: 20,
            padding: 16,
            background: "#f0f7ff",
            border: "1px solid #91caff",
            borderRadius: 8,
            fontSize: 13,
            color: "#0958d9",
          }}
        >
          <strong>💡 {en ? "Note:" : "说明："}</strong>{" "}
          {en
            ? "AI Sales Tracker & Attribution inherits permissions from your Shopify store. Staff members with 'Apps' permission will automatically have access to this app with the same data visibility as other apps."
            : "AI Sales Tracker & Attribution 继承 Shopify 店铺的权限设置。拥有「应用」权限的员工将自动获得此应用的访问权限，数据可见性与其他应用相同。"}
        </div>
      </div>
    </s-page>
  );
}

function StepCard({
  step,
  title,
  description,
}: {
  step: string;
  title: string;
  description: string;
}) {
  return (
    <div
      style={{
        padding: 16,
        background: "#f9fafb",
        borderRadius: 8,
      }}
    >
      <div
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 28,
          height: 28,
          borderRadius: "50%",
          background: "#008060",
          color: "#fff",
          fontSize: 14,
          fontWeight: 600,
          marginBottom: 12,
        }}
      >
        {step}
      </div>
      <h4 style={{ margin: "0 0 6px", fontSize: 14, fontWeight: 600, color: "#212b36" }}>
        {title}
      </h4>
      <p style={{ margin: 0, fontSize: 13, color: "#637381", lineHeight: 1.5 }}>
        {description}
      </p>
    </div>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
