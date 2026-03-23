import type { LoaderFunctionArgs } from "react-router";
import { redirect, Form, useLoaderData } from "react-router";

import { Button } from "../../components/ui";
import styles from "../../styles/index.module.css";
import { readAppFlags, isProduction } from "../../lib/env.server";
import { toUILanguage } from "../../lib/language";
import { t, type Lang } from "../../lib/i18n";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);

  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  const language = toUILanguage(url.searchParams.get("lang"));
  // 生产环境强制隐藏表单，避免 Shopify 审核风险
  // Shopify 要求：应用不得在安装或配置流程中要求商家手动输入 myshopify.com 或店铺域名
  const showForm = !isProduction() && readAppFlags().enableLoginForm;
  return { showForm, language };
};

export default function App() {
  const { showForm, language } = useLoaderData<typeof loader>();
  const lang = language as Lang;

  return (
    <div className={styles.index}>
      <div className={styles.hero}>
        <div className={styles.badge}>{t(lang, "landing_badge")}</div>
        <h1 className={styles.heading}>
          {t(lang, "landing_heading")}
        </h1>
        <p className={styles.text}>{t(lang, "landing_text")}</p>
        <div className={styles.actions}>
          {showForm && (
            <Form className={styles.form} method="get" action="/auth">
              <label className={styles.label}>
                <span>{t(lang, "shop_domain_label")}</span>
                <input
                  className={styles.input}
                  type="text"
                  name="shop"
                  placeholder={t(lang, "shop_placeholder")}
                />
              </label>
              <Button type="submit" variant="primary" size="medium">
                {t(lang, "login_to_shopify")}
              </Button>
            </Form>
          )}
          <div className={styles.chips}>
            <span>{t(lang, "chip_conservative")}</span>
            <span>{t(lang, "chip_ai_gmv")}</span>
            <span>{t(lang, "chip_top_products")}</span>
            <span>{t(lang, "chip_export")}</span>
          </div>
          <div className={styles.chips}>
            <a href={language === "English" ? "?lang=zh" : "?lang=en"} className={styles.link}>
              {language === "English" ? t(lang, "switch_to_chinese") : t(lang, "switch_to_english")}
            </a>
          </div>
        </div>
      </div>

      <div className={styles.panel}>
        <div className={styles.panelSection}>
          <h3>{t(lang, "features_v01")}</h3>
          <ul>
            <li>{t(lang, "feature_data_ingress")}</li>
            <li>{t(lang, "feature_ai_attribution")}</li>
            <li>{t(lang, "feature_dashboard")}</li>
            <li>{t(lang, "feature_debug")}</li>
            <li>{t(lang, "feature_settings")}</li>
          </ul>
        </div>
        <div className={styles.panelSection}>
          <h3>{t(lang, "who_is_it_for")}</h3>
          <p>{t(lang, "target_audience")}</p>
          <div className={styles.statsRow}>
            <div>
              <div className={styles.statLabel}>{t(lang, "stat_ai_new_customer_share")}</div>
              <div className={styles.statValue}>30-45%</div>
            </div>
            <div>
              <div className={styles.statLabel}>{t(lang, "stat_ai_aov_vs_overall")}</div>
              <div className={styles.statValue}>+15-30%</div>
            </div>
            <div>
              <div className={styles.statLabel}>{t(lang, "stat_attribution")}</div>
              <div className={styles.statValue}>{t(lang, "stat_conservative")}</div>
            </div>
          </div>
        </div>
        <div className={styles.panelSection}>
          <h3>{t(lang, "getting_started")}</h3>
          <ol>
            <li>{t(lang, "step_1")}</li>
            <li>{t(lang, "step_2")}</li>
            <li>{t(lang, "step_3")}</li>
          </ol>
        </div>
      </div>
    </div>
  );
}
