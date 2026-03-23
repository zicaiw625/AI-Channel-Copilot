import { type ReactNode, useMemo, useRef } from "react";

export interface TabOption<T extends string> {
  id: T;
  label: string;
  disabled?: boolean;
}

interface TabsProps<T extends string> {
  tabs: TabOption<T>[];
  activeTab: T;
  onChange: (tab: T) => void;
  baseId: string;
  fitContent?: boolean;
}

export function Tabs<T extends string>({
  tabs,
  activeTab,
  onChange,
  baseId,
  fitContent = false,
}: TabsProps<T>) {
  const buttonRefs = useRef(new Map<T, HTMLButtonElement | null>());

  const orderedIds = useMemo(() => tabs.map((tab) => tab.id), [tabs]);

  const focusTab = (tabId: T) => {
    const button = buttonRefs.current.get(tabId);
    button?.focus();
  };

  const moveFocus = (currentTab: T, offset: number) => {
    const currentIndex = orderedIds.indexOf(currentTab);
    if (currentIndex === -1) return;
    const nextIndex = (currentIndex + offset + orderedIds.length) % orderedIds.length;
    const nextTab = orderedIds[nextIndex];
    onChange(nextTab);
    focusTab(nextTab);
  };

  return (
    <div
      role="tablist"
      aria-orientation="horizontal"
      style={{
        display: "flex",
        gap: 4,
        marginBottom: 20,
        background: "#f4f6f8",
        padding: 4,
        borderRadius: 8,
        width: fitContent ? "fit-content" : undefined,
      }}
    >
      {tabs.map((tab) => {
        const selected = activeTab === tab.id;
        const tabId = `${baseId}-tab-${tab.id}`;
        const panelId = `${baseId}-panel-${tab.id}`;

        return (
          <button
            key={tab.id}
            ref={(node) => {
              buttonRefs.current.set(tab.id, node);
            }}
            id={tabId}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls={panelId}
            tabIndex={selected ? 0 : -1}
            disabled={tab.disabled}
            onClick={() => onChange(tab.id)}
            onKeyDown={(event) => {
              if (event.key === "ArrowRight") {
                event.preventDefault();
                moveFocus(tab.id, 1);
              } else if (event.key === "ArrowLeft") {
                event.preventDefault();
                moveFocus(tab.id, -1);
              } else if (event.key === "Home") {
                event.preventDefault();
                const firstTab = orderedIds[0];
                onChange(firstTab);
                focusTab(firstTab);
              } else if (event.key === "End") {
                event.preventDefault();
                const lastTab = orderedIds[orderedIds.length - 1];
                onChange(lastTab);
                focusTab(lastTab);
              }
            }}
            style={{
              padding: "10px 20px",
              border: "none",
              borderRadius: 6,
              background: selected ? "#fff" : "transparent",
              boxShadow: selected ? "0 1px 3px rgba(0,0,0,0.1)" : "none",
              cursor: tab.disabled ? "not-allowed" : "pointer",
              fontWeight: 500,
              color: selected ? "#212b36" : "#637381",
              fontSize: 14,
              opacity: tab.disabled ? 0.6 : 1,
            }}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

export function TabPanel<T extends string>({
  baseId,
  tabId,
  activeTab,
  children,
}: {
  baseId: string;
  tabId: T;
  activeTab: T;
  children: ReactNode;
}) {
  const panelId = `${baseId}-panel-${tabId}`;
  const labelledBy = `${baseId}-tab-${tabId}`;
  const hidden = activeTab !== tabId;

  return (
    <div
      id={panelId}
      role="tabpanel"
      aria-labelledby={labelledBy}
      hidden={hidden}
      tabIndex={0}
    >
      {children}
    </div>
  );
}
