import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import {
  AdditionalPageLayout,
  DiagnosticsContent,
  useAdditionalController,
} from "../components/additional/AdditionalPage";
import { loadAdditionalPageData } from "../lib/additional.server";

export const loader = async (args: LoaderFunctionArgs) => {
  return loadAdditionalPageData(args);
};

export default function AdditionalDiagnosticsRoute() {
  const data = useLoaderData<typeof loader>();
  const controller = useAdditionalController(data);

  return (
    <AdditionalPageLayout activeKey="diagnostics" controller={controller}>
      <DiagnosticsContent controller={controller} />
    </AdditionalPageLayout>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
