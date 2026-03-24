import { Link } from "react-router";

import styles from "../../styles/app.dashboard.module.css";

export type SectionTabItem = {
  to: string;
  label: string;
  segment: string;
};

export function SectionTabs({ items, activeSegment }: { items: SectionTabItem[]; activeSegment: string }) {
  return (
    <div className={styles.inlineActions} style={{ marginTop: 8, flexWrap: "wrap" }}>
      {items.map((item) => (
        <Link
          key={item.segment}
          to={item.to}
          className={item.segment === activeSegment ? styles.primaryButton : styles.secondaryButton}
        >
          {item.label}
        </Link>
      ))}
    </div>
  );
}
