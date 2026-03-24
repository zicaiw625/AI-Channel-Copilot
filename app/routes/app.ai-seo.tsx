import { Outlet, useLocation } from "react-router";
import type { HeadersFunction } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { SectionTabs } from "../components/layout/SectionTabs";
import { APP_PATHS, buildEmbeddedAppPath, getPreservedSearchParams } from "../lib/navigation";

export default function AiSeoLayout() {
  const location = useLocation();
  const search = location.search;
  const en = getPreservedSearchParams(search).get("lang") === "en";
  const p = location.pathname;
  const activeSegment = p.includes("/funnel") ? "funnel" : p.includes("/optimization") ? "optimization" : "workspace";
  const items = [
    {
      to: buildEmbeddedAppPath(APP_PATHS.aiSeoWorkspace, search),
      label: en ? "Workspace" : "工作台",
      segment: "workspace" as const,
    },
    {
      to: buildEmbeddedAppPath(APP_PATHS.aiSeoOptimization, search),
      label: en ? "Optimization" : "优化建议",
      segment: "optimization" as const,
    },
    {
      to: buildEmbeddedAppPath(APP_PATHS.aiSeoFunnel, search),
      label: en ? "Funnel" : "漏斗分析",
      segment: "funnel" as const,
    },
  ];

  return (
    <>
      <div style={{ padding: "0 16px 12px", background: "#f1f2f3", borderBottom: "1px solid #dfe3e8" }}>
        <SectionTabs items={items} activeSegment={activeSegment} />
      </div>
      <Outlet />
    </>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
