import { notFound } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { createClient } from "@/lib/supabase/server";

import { UploadForm } from "./upload-form";

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive"> = {
  pending: "secondary",
  confirmed: "default",
  failed: "destructive",
};

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: project } = await supabase
    .from("projects")
    .select("id, name")
    .eq("id", id)
    .single();

  if (!project) {
    notFound();
  }

  const { data: documents } = await supabase
    .from("documents")
    .select("id, storage_path, status, created_at")
    .eq("project_id", id)
    .order("created_at", { ascending: false });

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">{project.name}</h1>
        <p className="text-muted-foreground">
          Upload purchasing documents for this project.
        </p>
      </div>

      <UploadForm projectId={project.id} />

      {documents && documents.length > 0 ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>File</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Uploaded</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {documents.map((doc) => (
              <TableRow key={doc.id}>
                <TableCell className="max-w-xs truncate">
                  {doc.storage_path.split("/").pop()}
                </TableCell>
                <TableCell>
                  <Badge variant={STATUS_VARIANT[doc.status] ?? "secondary"}>
                    {doc.status}
                  </Badge>
                </TableCell>
                <TableCell>{new Date(doc.created_at).toLocaleString()}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : (
        <p className="text-muted-foreground">No documents uploaded yet.</p>
      )}
    </div>
  );
}
