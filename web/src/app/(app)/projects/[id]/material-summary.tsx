import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { createClient } from "@/lib/supabase/server";

// The Materials tab: "what did I actually buy on this job", aggregated from
// confirmed line items. Grouping mirrors createEstimateFromProject's seeding
// rules -- a line item counts toward a canonical material only via a
// "proposed" MaterialMatch; a "flagged" (or missing) match isn't trustworthy
// grouping, so those fall back to a per-description row marked "unmatched".
// This is a read-only summary, not a seeding step -- the comparison-price
// and estimate-line logic lives in the estimate flow, not here.
type SummaryRow = {
  key: string;
  name: string;
  matched: boolean;
  totalQuantity: number;
  weightedPriceSum: number;
  totalSpent: number;
  purchaseCount: number;
};

export async function MaterialSummary({ projectId }: { projectId: string }) {
  const supabase = await createClient();

  const { data: invoices } = await supabase
    .from("invoices")
    .select("id")
    .eq("project_id", projectId);
  const invoiceIds = (invoices ?? []).map((i) => i.id);

  const { data: lineItemsData } =
    invoiceIds.length > 0
      ? await supabase
          .from("line_items")
          .select("id, description, quantity, unit_price, total")
          .in("invoice_id", invoiceIds)
      : { data: [] };
  const lineItems = lineItemsData ?? [];
  const lineItemIds = lineItems.map((li) => li.id);

  const { data: matchesData } =
    lineItemIds.length > 0
      ? await supabase
          .from("material_matches")
          .select("line_item_id, status, material_catalog(name)")
          .in("line_item_id", lineItemIds)
      : { data: [] };
  const matchByLineItem = new Map(
    (matchesData ?? []).map((m) => [
      m.line_item_id,
      {
        status: m.status as string,
        name: (m.material_catalog as unknown as { name: string } | null)?.name,
      },
    ]),
  );

  const rows = new Map<string, SummaryRow>();
  for (const item of lineItems) {
    const match = matchByLineItem.get(item.id);
    const matched = Boolean(match && match.status === "proposed" && match.name);
    const name = matched ? match!.name! : item.description;
    // Separate namespaces so an unmatched description never merges into a
    // canonical material that happens to share its text.
    const key = matched ? `m:${name.toLowerCase()}` : `u:${item.description.toLowerCase()}`;
    const spent = item.total ?? item.quantity * item.unit_price;

    const existing = rows.get(key);
    if (existing) {
      existing.totalQuantity += item.quantity;
      existing.weightedPriceSum += item.quantity * item.unit_price;
      existing.totalSpent += spent;
      existing.purchaseCount += 1;
    } else {
      rows.set(key, {
        key,
        name,
        matched,
        totalQuantity: item.quantity,
        weightedPriceSum: item.quantity * item.unit_price,
        totalSpent: spent,
        purchaseCount: 1,
      });
    }
  }

  const sorted = [...rows.values()].sort((a, b) => b.totalSpent - a.totalSpent);

  if (sorted.length === 0) {
    return (
      <p className="text-muted-foreground">
        No materials yet — confirm some documents to build this project&apos;s purchasing summary.
      </p>
    );
  }

  const grandTotal = sorted.reduce((sum, r) => sum + r.totalSpent, 0);

  return (
    <div className="flex flex-col gap-2">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Material</TableHead>
            <TableHead>Total qty</TableHead>
            <TableHead>Avg unit price</TableHead>
            <TableHead>Total spent</TableHead>
            <TableHead>Purchases</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.map((r) => (
            <TableRow key={r.key}>
              <TableCell>
                {r.name}
                {!r.matched && (
                  <span className="ml-2 text-xs text-muted-foreground">(unmatched)</span>
                )}
              </TableCell>
              <TableCell>{r.totalQuantity}</TableCell>
              <TableCell>
                ${(r.totalQuantity > 0 ? r.weightedPriceSum / r.totalQuantity : 0).toFixed(2)}
              </TableCell>
              <TableCell>${r.totalSpent.toFixed(2)}</TableCell>
              <TableCell>{r.purchaseCount}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <p className="text-right text-sm font-medium">Total spent: ${grandTotal.toFixed(2)}</p>
    </div>
  );
}
