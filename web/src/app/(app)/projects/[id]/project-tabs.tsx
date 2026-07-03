"use client";

import { useState } from "react";

import { cn } from "@/lib/utils";

// Each tab's content is a server-rendered subtree passed in as a prop from
// the (server) project page, so all three are fetched once on load and
// switching is instant and client-only -- no navigation, no refetch. Only
// the active subtree is mounted, so the Documents tab's polling table isn't
// running in the background while you're on another tab.
type TabKey = "documents" | "estimates" | "materials";

const TABS: { key: TabKey; label: string }[] = [
  { key: "documents", label: "Documents" },
  { key: "estimates", label: "Estimates" },
  { key: "materials", label: "Materials" },
];

export function ProjectTabs({
  documents,
  estimates,
  materials,
}: {
  documents: React.ReactNode;
  estimates: React.ReactNode;
  materials: React.ReactNode;
}) {
  const [active, setActive] = useState<TabKey>("documents");
  const content: Record<TabKey, React.ReactNode> = { documents, estimates, materials };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex gap-1 border-b">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActive(tab.key)}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-sm transition-colors",
              active === tab.key
                ? "border-foreground font-medium text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div>{content[active]}</div>
    </div>
  );
}
