import { useLocation } from "react-router";

import { SectionTabs } from "../layout/SectionTabs";
import {
  APP_PATHS,
  buildEmbeddedAppPath,
  buildUTMWizardHref,
} from "../../lib/navigation";

export type AttributionNavActive = "rules" | "diagnostics" | "export" | "health" | "utm";

export function AttributionDomainNav({ active, en }: { active: AttributionNavActive; en: boolean }) {
  const location = useLocation();
  const search = location.search;
  const items = [
    {
      segment: "rules" as const,
      to: buildEmbeddedAppPath(APP_PATHS.attributionRules, search, { utmTab: null }),
      label: en ? "Attribution" : "归因规则",
    },
    {
      segment: "diagnostics" as const,
      to: buildEmbeddedAppPath(APP_PATHS.attributionDiagnostics, search, { utmTab: null }),
      label: en ? "Diagnostics" : "诊断排查",
    },
    {
      segment: "export" as const,
      to: buildEmbeddedAppPath(APP_PATHS.attributionExport, search, { utmTab: null }),
      label: en ? "Export" : "数据导出",
    },
    {
      segment: "health" as const,
      to: buildEmbeddedAppPath(APP_PATHS.attributionHealth, search, { utmTab: null }),
      label: en ? "System Health" : "系统健康",
    },
    {
      segment: "utm" as const,
      to: buildUTMWizardHref(search),
      label: en ? "UTM Wizard" : "UTM 向导",
    },
  ];

  return <SectionTabs items={items} activeSegment={active} />;
}
