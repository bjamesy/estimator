import { NewProjectForm } from "./new-project-form";

// The list of projects lives in the sidebar now, so this page is just the
// create form.
export default function ProjectsPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">New project</h1>
        <p className="text-muted-foreground">
          A project is a container for a job&apos;s purchasing history. Create one, then upload its
          receipts and invoices.
        </p>
      </div>

      <NewProjectForm />
    </div>
  );
}
