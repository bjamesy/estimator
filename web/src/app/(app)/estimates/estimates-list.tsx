"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ESTIMATE_STATUS_TABS, type EstimateStatusBucket } from "@/lib/estimate-status";
import { cn } from "@/lib/utils";

export type EstimateRow = {
  id: string;
  name: string;
  projectName: string | null;
  createdAt: string;
  bucket: EstimateStatusBucket;
  statusLabel: string;
};

const EMPTY_COPY: Record<EstimateStatusBucket, { title: string; description: string }> = {
  draft: {
    title: "No draft estimates",
    description: "Create one to start pricing a new job.",
  },
  pending: {
    title: "No pending estimates",
    description: "Estimates land here once they've been sent for a signature.",
  },
  confirmed: {
    title: "No confirmed estimates yet",
    description: "Estimates land here once both parties have signed.",
  },
};

export function EstimatesList({ estimates }: { estimates: EstimateRow[] }) {
  const [activeTab, setActiveTab] = useState<EstimateStatusBucket>(ESTIMATE_STATUS_TABS[0].key);
  const [query, setQuery] = useState("");

  const counts = useMemo(() => {
    const map = new Map<EstimateStatusBucket, number>(
      ESTIMATE_STATUS_TABS.map((t) => [t.key, 0]),
    );
    for (const e of estimates) map.set(e.bucket, (map.get(e.bucket) ?? 0) + 1);
    return map;
  }, [estimates]);

  const tabRows = useMemo(
    () => estimates.filter((e) => e.bucket === activeTab),
    [estimates, activeTab],
  );

  const filteredRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return tabRows;
    return tabRows.filter((e) => e.name.toLowerCase().includes(q));
  }, [tabRows, query]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-1 border-b">
        {ESTIMATE_STATUS_TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => {
              setActiveTab(tab.key);
              setQuery("");
            }}
            className={cn(
              "-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm transition-colors",
              activeTab === tab.key
                ? "border-foreground font-medium text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {tab.label}
            <span className="text-xs text-muted-foreground">{counts.get(tab.key) ?? 0}</span>
          </button>
        ))}
      </div>

      <Input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search estimates by name…"
        className="max-w-xs"
      />

      {filteredRows.length === 0 ? (
        <EmptyState
          title={query ? `No estimates match "${query}"` : EMPTY_COPY[activeTab].title}
          description={query ? undefined : EMPTY_COPY[activeTab].description}
          action={
            !query && activeTab === "draft"
              ? { href: "/estimates/new", label: "New estimate" }
              : undefined
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Project</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredRows.map((e) => (
                <TableRow key={e.id}>
                  <TableCell>
                    <Link href={`/estimates/${e.id}`} className="text-primary hover:underline">
                      {e.name}
                    </Link>
                  </TableCell>
                  <TableCell>{e.projectName ?? "—"}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{e.statusLabel}</Badge>
                  </TableCell>
                  <TableCell>{new Date(e.createdAt).toLocaleDateString()}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
