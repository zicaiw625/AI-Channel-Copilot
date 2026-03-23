import { redirect, type LoaderFunctionArgs } from "react-router";

import { getShopifyContextParams } from "../lib/navigation";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const params = getShopifyContextParams(url.search);
  const query = params.toString();
  return redirect(`/app/additional${query ? `?${query}` : ""}`);
};

