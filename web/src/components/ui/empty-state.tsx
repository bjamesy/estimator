import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// A consistent empty state: never a bare "no data" line. It says what's
// missing and points at the next logical action -- either an inline hint
// (when the create control already sits above it) or a call-to-action button.
export function EmptyState({
  title,
  description,
  action,
  className,
}: {
  title: string;
  description?: string;
  action?: { href: string; label: string };
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-3 rounded-lg border border-dashed px-6 py-10 text-center",
        className,
      )}
    >
      <div className="space-y-1">
        <p className="text-sm font-medium">{title}</p>
        {description && (
          <p className="mx-auto max-w-md text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {action && (
        <Link href={action.href} className={cn(buttonVariants({ size: "sm" }))}>
          {action.label}
        </Link>
      )}
    </div>
  );
}
