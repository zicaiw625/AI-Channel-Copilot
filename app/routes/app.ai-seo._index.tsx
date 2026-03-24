import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";

import { buildEmbeddedAppUrl } from "../lib/navigation";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  throw redirect(buildEmbeddedAppUrl(request.url, "/app/ai-seo/workspace").toString());
};
