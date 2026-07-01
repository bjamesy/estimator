"use client";

import { Fragment, useState } from "react";

import { extractDocument } from "@/app/actions/extraction";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { ExtractionPayload } from "@/lib/extraction";

type Document = {
  id: string;
  storage_path: string;
  status: string;
  created_at: string;
};

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive"> = {
  pending: "secondary",
  confirmed: "default",
  failed: "destructive",
};

type ExtractionState = {
  loading: boolean;
  data: ExtractionPayload | null;
  error: string | null;
};

export function DocumentsTable({ documents }: { documents: Document[] }) {
  const [results, setResults] = useState<Record<string, ExtractionState>>({});

  async function handleExtract(documentId: string) {
    setResults((prev) => ({ ...prev, [documentId]: { loading: true, data: null, error: null } }));
    const { data, error } = await extractDocument(documentId);
    setResults((prev) => ({ ...prev, [documentId]: { loading: false, data, error } }));
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>File</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Uploaded</TableHead>
          <TableHead />
        </TableRow>
      </TableHeader>
      <TableBody>
        {documents.map((doc) => {
          const result = results[doc.id];
          return (
            <Fragment key={doc.id}>
              <TableRow>
                <TableCell className="max-w-xs truncate">
                  {doc.storage_path.split("/").pop()}
                </TableCell>
                <TableCell>
                  <Badge variant={STATUS_VARIANT[doc.status] ?? "secondary"}>{doc.status}</Badge>
                </TableCell>
                <TableCell>{new Date(doc.created_at).toLocaleString()}</TableCell>
                <TableCell>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={result?.loading}
                    onClick={() => handleExtract(doc.id)}
                  >
                    {result?.loading ? "Extracting..." : "Extract"}
                  </Button>
                </TableCell>
              </TableRow>
              {result && (result.data || result.error) && (
                <TableRow>
                  <TableCell colSpan={4}>
                    <ExtractionResultView result={result} />
                  </TableCell>
                </TableRow>
              )}
            </Fragment>
          );
        })}
      </TableBody>
    </Table>
  );
}

function ExtractionResultView({ result }: { result: ExtractionState }) {
  if (result.error) {
    return (
      <Card className="border-destructive">
        <CardContent className="pt-6 text-sm text-destructive">{result.error}</CardContent>
      </Card>
    );
  }

  if (!result.data) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Extracted data</CardTitle>
        <p className="text-sm text-muted-foreground">
          {result.data.supplier_name} · {result.data.invoice_date ?? "no date"} ·{" "}
          {result.data.total != null ? `$${result.data.total.toFixed(2)}` : "no total"}
        </p>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Description</TableHead>
              <TableHead>SKU</TableHead>
              <TableHead>Qty</TableHead>
              <TableHead>Unit price</TableHead>
              <TableHead>Total</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {result.data.line_items.map((item, i) => (
              <TableRow key={i}>
                <TableCell>{item.description}</TableCell>
                <TableCell>{item.sku ?? "—"}</TableCell>
                <TableCell>{item.quantity}</TableCell>
                <TableCell>${item.unit_price.toFixed(2)}</TableCell>
                <TableCell>${item.total.toFixed(2)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
