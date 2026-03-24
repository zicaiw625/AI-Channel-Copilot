import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useSearchParams } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import {
  AdditionalPageLayout,
  AttributionContent,
  DiagnosticsContent,
  ExportContent,
  HealthContent,
  useAdditionalController,
} from "../components/additional/AdditionalPage";
import { loadAdditionalPageData } from "../lib/additional.server";
import { ADDITIONAL_SECTION_QUERY, parseAdditionalSection } from "../lib/navigation";

export const loader = async (args: LoaderFunctionArgs) => {
  return loadAdditionalPageData(args);
};

export default function AdditionalAttributionRoute() {
  const data = useLoaderData<typeof loader>();
  const controller = useAdditionalController(data);
  const [searchParams] = useSearchParams();
  const activeKey = parseAdditionalSection(searchParams.get(ADDITIONAL_SECTION_QUERY));

  const sectionContent =
    activeKey === "diagnostics" ? (
      <DiagnosticsContent controller={controller} />
    ) : activeKey === "export" ? (
      <ExportContent controller={controller} />
    ) : activeKey === "health" ? (
      <HealthContent controller={controller} />
    ) : (
      <AttributionContent controller={controller} />
    );

  return (
    <AdditionalPageLayout activeKey={activeKey} controller={controller}>
      {sectionContent}
    </AdditionalPageLayout>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
