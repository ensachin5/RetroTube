"use client";

import { useRef, type KeyboardEvent, type ReactNode } from "react";

export interface TabOption<T extends string> {
  id: T;
  label: string;
  count?: number;
}

export interface TabsProps<T extends string> {
  idPrefix: string;
  label: string;
  tabs: readonly TabOption<T>[];
  activeTab: T;
  onChange: (nextTab: T) => void;
  children: ReactNode;
}

export function Tabs<T extends string>({
  idPrefix,
  label,
  tabs,
  activeTab,
  onChange,
  children,
}: TabsProps<T>) {
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (tabs.length === 0) return;

    let nextIndex: number | null = null;
    if (event.key === "ArrowRight") {
      nextIndex = (index + 1) % tabs.length;
    } else if (event.key === "ArrowLeft") {
      nextIndex = (index - 1 + tabs.length) % tabs.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = tabs.length - 1;
    }

    if (nextIndex !== null) {
      event.preventDefault();
      const target = tabs[nextIndex];
      if (target) {
        onChange(target.id);
        tabRefs.current[nextIndex]?.focus();
      }
    }
  };

  return (
    <div className="w-full">
      <div
        role="tablist"
        aria-label={label}
        className="flex flex-wrap gap-2 border-b-2 border-[var(--border-ink)] pb-3"
      >
        {tabs.map((tab, index) => {
          const isSelected = tab.id === activeTab;
          return (
            <button
              key={tab.id}
              ref={(el) => {
                tabRefs.current[index] = el;
              }}
              id={`${idPrefix}-tab-${tab.id}`}
              role="tab"
              type="button"
              aria-selected={isSelected}
              aria-controls={`${idPrefix}-panel-${tab.id}`}
              tabIndex={isSelected ? 0 : -1}
              onClick={() => onChange(tab.id)}
              onKeyDown={(e) => handleKeyDown(e, index)}
              className={`retro-btn min-h-11 flex-1 sm:flex-none px-4 py-2 rounded-md font-display font-bold text-sm sm:text-base uppercase tracking-wider flex items-center justify-center gap-2 cursor-pointer ${
                isSelected
                  ? "bg-[var(--accent-tomato)] text-[var(--on-tomato)]"
                  : "bg-[var(--bg-surface-alt)] text-[var(--text-ink)] hover:bg-[var(--bg-surface)]"
              }`}
            >
              <span>{tab.label}</span>
              {typeof tab.count === "number" ? (
                <span
                  className={`inline-flex items-center justify-center rounded px-1.5 py-0.5 text-xs border border-[var(--border-ink)] ${
                    isSelected
                      ? "bg-[var(--bg-surface)] text-[var(--text-ink)]"
                      : "bg-[var(--bg-surface)] text-[var(--text-ink)]"
                  }`}
                >
                  {tab.count}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      <div
        id={`${idPrefix}-panel-${activeTab}`}
        role="tabpanel"
        aria-labelledby={`${idPrefix}-tab-${activeTab}`}
        tabIndex={0}
        className="pt-4 focus:outline-none"
      >
        {children}
      </div>
    </div>
  );
}
