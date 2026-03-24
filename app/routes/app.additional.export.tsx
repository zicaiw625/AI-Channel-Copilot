import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import {
  AdditionalPageLayout,
  ExportContent,
  useAdditionalController,
} from "../components/additional/AdditionalPage";
import { loadAdditionalPageData } from "../lib/additional.server";

export const loader = async (args: LoaderFunctionArgs) => {
  return loadAdditionalPageData(args);
};

export default function AdditionalExportRoute() {
  const data = useLoaderData<typeof loader>();
  const controller = useAdditionalController(data);

  return (
    <AdditionalPageLayout activeKey="export" controller={controller}>
      <ExportContent controller={controller} />
    </AdditionalPageLayout>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
