"use client";

import { XIcon } from "lucide-react";

import { Button } from "@/components/ui/button";

// Bottom-sheet overlay for surfacing a normally-inline block (a form, a
// set of tools) only when needed on narrow screens, instead of always
// rendering it in the page flow. Pair with a trigger button/section hidden
// via the same breakpoint this sheet hides itself at (md:hidden) so the
// wide-screen layout renders the content inline instead.
export function MobileSheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 md:hidden">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="absolute inset-x-0 bottom-0 flex max-h-[85vh] flex-col rounded-t-xl border-t bg-background shadow-lg">
        <div className="flex items-center justify-between border-b p-2 pl-4">
          {title && <span className="text-sm font-semibold">{title}</span>}
          <Button type="button" variant="ghost" size="icon" onClick={onClose} className="ml-auto">
            <XIcon className="size-4" />
          </Button>
        </div>
        <div className="overflow-y-auto p-4">{children}</div>
      </div>
    </div>
  );
}
