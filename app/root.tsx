import { Links, Meta, Outlet, Scripts, ScrollRestoration, useLoaderData } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import { useEffect } from "react";
import { useUILanguage } from "./lib/useUILanguage";
import { useNonce } from "./lib/nonce";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const qlang = url.searchParams.get("lang");
  const header = request.headers.get("accept-language") || "";
  const lang = qlang === "en" ? "en" : qlang === "zh" ? "zh" : /\ben\b/i.test(header) ? "en" : "zh";
  const uiLanguage = lang === "en" ? "English" : "中文";
  return { lang, uiLanguage };
};

export default function App() {
  const { lang, uiLanguage: initialUILanguage } = useLoaderData<typeof loader>();
  const uiLanguage = useUILanguage(initialUILanguage);
  const nonce = useNonce();
  useEffect(() => {
    const lang = uiLanguage === "English" ? "en" : "zh";
    if (typeof document !== "undefined") {
      document.documentElement.lang = lang;
    }
  }, [uiLanguage]);
  return (
    <html lang={lang}>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <link rel="preconnect" href="https://cdn.shopify.com/" />
        <link
          rel="stylesheet"
          href="https://cdn.shopify.com/static/fonts/inter/v4/styles.css"
        />
        <Meta />
        <Links />
      </head>
      <body>
        <Outlet />
        {(() => {
          const ScrollRestorationWithNonce = ScrollRestoration as unknown as (props: { nonce?: string }) => JSX.Element;
          return <ScrollRestorationWithNonce nonce={nonce} />;
        })()}
        {(() => {
          const ScriptsWithNonce = Scripts as unknown as (props: { nonce?: string }) => JSX.Element;
          return <ScriptsWithNonce nonce={nonce} />;
        })()}
      </body>
    </html>
  );
}
