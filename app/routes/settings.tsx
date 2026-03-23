import { redirect, type LoaderFunctionArgs } from "react-router";

import { getPreservedSearchParams } from "../lib/navigation";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const params = getPreservedSearchParams(url.search);
  const query = params.toString();
  return redirect(`/app/additional${query ? `?${query}` : ""}`);
};

