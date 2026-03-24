import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import {
  AdditionalPageLayout,
  HealthContent,
  useAdditionalController,
} from "../components/additional/AdditionalPage";
import { loadAdditionalPageData } from "../lib/additional.server";

export const loader = async (args: LoaderFunctionArgs) => {
  return loadAdditionalPageData(args);
};

export default function AdditionalHealthRoute() {
  const data = useLoaderData<typeof loader>();
  const controller = useAdditionalController(data);

  return (
    <AdditionalPageLayout activeKey="health" controller={controller}>
      <HealthContent controller={controller} />
    </AdditionalPageLayout>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
