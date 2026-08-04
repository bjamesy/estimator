import { createClient } from "@/lib/supabase/server";

// Neutral line-item CSV export for an executed estimate version -- the
// workflow handoff into whatever accounting/invoicing tool the contractor
// uses (QuickBooks, Jobber, Wave, a spreadsheet) instead of re-keying the
// signed scope by hand. A route handler (not a server action) so the
// browser gets a real file download from a plain <a href>, mirroring the
// PDF download link next to it on the version page.
//
// Data access is RLS-scoped via createClient(): a non-member simply gets no
// row back, so "not found" covers both a missing version and one belonging
// to another company -- no separate auth branch needed.

type VersionRow = {
  version_number: number;
  status: string;
  estimates: { name: string } | null;
};

type LineRow = {
  description: string;
  quantity: number;
  unit_price: number;
  markup_percent: number;
  total: number;
  change_kind: string;
};

// RFC 4180 field escaping: wrap in quotes and double any internal quote.
// Only strictly needed for fields containing a comma, quote, or newline,
// but quoting unconditionally is simpler and equally valid.
function csvField(value: string | number): string {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase() || "estimate";
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ estimateId: string; versionId: string }> },
) {
  const { estimateId, versionId } = await params;
  const supabase = await createClient();

  const { data: version } = await supabase
    .from("estimate_versions")
    .select("version_number, status, estimates(name)")
    .eq("id", versionId)
    .eq("estimate_id", estimateId)
    .single<VersionRow>();

  if (!version) {
    return new Response("Not found", { status: 404 });
  }

  // Signed-only: a draft/pending version isn't the agreed-upon scope yet.
  // Enforced here server-side, not just by hiding the button.
  if (version.status !== "executed") {
    return new Response("Only executed versions can be exported.", { status: 403 });
  }

  const { data: linesData } = await supabase
    .from("estimate_version_lines")
    .select("description, quantity, unit_price, markup_percent, total, change_kind")
    .eq("estimate_version_id", versionId)
    .order("created_at", { ascending: true });

  // Removed lines are struck-through and excluded from the version total --
  // you don't invoice for removed scope, so they're excluded here too, and
  // the CSV's line totals sum to the version total shown on the page.
  const lines = (linesData ?? []).filter(
    (l: LineRow) => l.change_kind !== "removed",
  ) as LineRow[];

  const header = ["Description", "Quantity", "Unit Price", "Markup %", "Line Total"];
  const rows = lines.map((l) =>
    [
      csvField(l.description),
      csvField(l.quantity),
      csvField(l.unit_price),
      csvField(l.markup_percent),
      csvField(l.total),
    ].join(","),
  );
  const csv = [header.map(csvField).join(","), ...rows].join("\r\n");

  const filename = `${sanitizeFilename(version.estimates?.name ?? "estimate")}-v${version.version_number}.csv`;

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
