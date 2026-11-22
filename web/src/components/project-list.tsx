import Link from "next/link";
import {client} from "@/sanity/client";
import {PROJECTS_QUERY} from "@/sanity/queries";

const options = {next: {revalidate: 30}};

export async function ProjectList() {
  const projects = await client.fetch(PROJECTS_QUERY, {}, options);

  if (projects.length === 0) {
    return <p>No published projects yet.</p>;
  }

  return (
    <ul className="flex flex-col gap-6">
      {projects.map((project) => {
        if (!project.slug) return null;
        const disciplines = (project.disciplines ?? []).filter(Boolean).join(" · ");

        return (
          <li key={project._id} className="flex flex-col gap-1">
            <Link href={`/projects/${project.slug}`} className="text-lg underline">
              {project.title}
            </Link>
            {disciplines ? <p className="text-sm">{disciplines}</p> : null}
            {project.summary ? <p>{project.summary}</p> : null}
          </li>
        );
      })}
    </ul>
  );
}
