import Link from "next/link";

import { createClient } from "@/lib/supabase/server";

import { NewProjectForm } from "./new-project-form";

export default async function ProjectsPage() {
  const supabase = await createClient();
  const { data: projects } = await supabase
    .from("projects")
    .select("id, name, status, created_at")
    .order("created_at", { ascending: false });

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Projects</h1>
        <p className="text-muted-foreground">
          Every project is a container for purchasing history.
        </p>
      </div>

      <NewProjectForm />

      {projects && projects.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {projects.map((project) => (
            <li key={project.id}>
              <Link
                href={`/projects/${project.id}`}
                className="block rounded-md border px-4 py-3 hover:bg-accent"
              >
                {project.name}
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground">No projects yet.</p>
      )}
    </div>
  );
}
