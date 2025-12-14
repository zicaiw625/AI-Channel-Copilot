import { useEffect, useState } from "react";
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { useAppBridge } from "@shopify/app-bridge-react";
import { requireEnv } from "../lib/env.server";

/**
 * Shopify Embedded App session token exchange endpoint.
 *
 * Important:
 * - In some flows (e.g. billing confirm / iframe reload), Shopify SDK may return a Response
 *   from `authenticate.admin(request)` (HTML/redirect) instead of throwing.
 * - If we accidentally treat it as an object, we return `null` and render a blank page.
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const host = url.searchParams.get("host") || "";
  const shopifyReload = url.searchParams.get("shopify-reload") || "";

  // Validate required params
  if (!host || !shopifyReload) {
    return {
      ok: false,
      apiKey: requireEnv("SHOPIFY_API_KEY"),
      host,
      shopifyReload,
      message: "Missing host/shopify-reload",
    };
  }

  // Security: only allow reloading back into our own app origin
  const appUrl = requireEnv("SHOPIFY_APP_URL");
  let reloadOk = false;
  try {
    const reloadUrl = new URL(shopifyReload);
    reloadOk = reloadUrl.origin === new URL(appUrl).origin;
  } catch {
    reloadOk = false;
  }
  if (!reloadOk) {
    return {
      ok: false,
      apiKey: requireEnv("SHOPIFY_API_KEY"),
      host,
      shopifyReload,
      message: "Invalid shopify-reload target",
    };
  }

  return {
    ok: true,
    apiKey: requireEnv("SHOPIFY_API_KEY"),
    host,
    shopifyReload,
  };
};

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

export default function SessionToken() {
  const data = useLoaderData<typeof loader>();
  const [error, setError] = useState<string | null>(null);

  if (!data?.apiKey) {
    return (
      <div style={{ padding: 16, fontFamily: "system-ui" }}>
        <p>Session token bootstrap failed.</p>
      </div>
    );
  }

  return (
    <AppProvider embedded apiKey={data.apiKey}>
      <SessionTokenInner
        ok={Boolean(data.ok)}
        host={data.host || ""}
        shopifyReload={data.shopifyReload || ""}
        initialMessage={(data as any).message}
        onError={setError}
        error={error}
      />
    </AppProvider>
  );
}

function SessionTokenInner(props: {
  ok: boolean;
  host: string;
  shopifyReload: string;
  initialMessage?: string;
  error: string | null;
  onError: (msg: string) => void;
}) {
  const app = useAppBridge();

  useEffect(() => {
    if (!props.ok) return;
    let cancelled = false;

    (async () => {
      try {
        // Get a session token (JWT) from App Bridge
        const token = await app.idToken();
        if (cancelled) return;

        // Append id_token to the reload URL so server-side authenticate.admin can validate
        const next = new URL(props.shopifyReload);
        next.searchParams.set("id_token", token);

        // Navigate the top frame back into the app
        window.top?.location.assign(next.toString());
      } catch (e) {
        if (cancelled) return;
        props.onError(e instanceof Error ? e.message : String(e));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [app, props]);

  return (
    <div style={{ padding: 16, fontFamily: "system-ui" }}>
      <p style={{ margin: 0, fontWeight: 600 }}>
        正在恢复会话并返回应用…
      </p>
      <p style={{ marginTop: 8, color: "#666" }}>
        {props.initialMessage ? `(${props.initialMessage})` : "如果没有自动跳转，请稍等或刷新。"}
      </p>
      {props.error && (
        <pre style={{ marginTop: 12, padding: 12, background: "#fff2f0", color: "#a8071a", borderRadius: 6, whiteSpace: "pre-wrap" }}>
{props.error}
        </pre>
      )}
      {props.ok && props.shopifyReload && (
        <p style={{ marginTop: 12 }}>
          <a href={props.shopifyReload} target="_top" rel="noreferrer">
            点击返回应用
          </a>
        </p>
      )}
    </div>
  );
}

