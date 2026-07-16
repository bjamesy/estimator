"use client";

import { useState } from "react";

import { cn } from "@/lib/utils";

// Same "server-rendered subtree passed in as a prop, only the active one
// mounted" pattern as project-tabs.tsx -- three full credential cards
// stacked and always rendered was a lot of scrolling for a page you visit
// to check/update one certificate at a time.
export function CredentialTabs({
  tabs,
}: {
  tabs: { key: string; label: string; needsAttention: boolean; content: React.ReactNode }[];
}) {
  const [active, setActive] = useState(tabs[0]?.key);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-1 overflow-x-auto border-b">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActive(tab.key)}
            className={cn(
              "-mb-px flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-sm transition-colors",
              active === tab.key
                ? "border-foreground font-medium text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {tab.label}
            {tab.needsAttention && (
              <span
                title="Missing or expiring within 30 days"
                className="size-1.5 shrink-0 rounded-full bg-amber-500"
              />
            )}
          </button>
        ))}
      </div>
      <div>{tabs.find((t) => t.key === active)?.content}</div>
    </div>
  );
}
