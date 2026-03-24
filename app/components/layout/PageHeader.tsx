import { Link } from "react-router";
import type { ReactNode } from "react";

import styles from "../../styles/app.dashboard.module.css";

export type PageHeaderAction = {
  to: string;
  label: string;
  variant?: "primary" | "secondary";
};

export function PageHeader({
  back,
  actions,
  extra,
}: {
  back?: { to: string; label: string };
  actions?: PageHeaderAction[];
  extra?: ReactNode;
}) {
  return (
    <div
      style={{
        marginBottom: 16,
        display: "flex",
        gap: 12,
        flexWrap: "wrap",
        alignItems: "center",
        justifyContent: "space-between",
      }}
    >
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
        {back ? (
          <Link to={back.to} className={styles.secondaryButton}>
            ← {back.label}
          </Link>
        ) : null}
        {actions?.map((a) => (
          <Link
            key={`${a.to}:${a.label}`}
            to={a.to}
            className={a.variant === "primary" ? styles.primaryButton : styles.secondaryButton}
          >
            {a.label}
          </Link>
        ))}
      </div>
      {extra}
    </div>
  );
}
