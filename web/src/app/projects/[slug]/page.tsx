import {PortableText, type PortableTextComponents} from "next-sanity";
import {Image} from "next-sanity/image";
import Link from "next/link";
import {notFound} from "next/navigation";
import {client} from "@/sanity/client";
import {urlFor} from "@/sanity/image";
import {PROJECT_QUERY} from "@/sanity/queries";
import type {PROJECT_QUERY_RESULT} from "../../../../sanity.types";

const options = {next: {revalidate: 30}};

const components: PortableTextComponents = {
  types: {
    image: ({value}: {value?: {alt?: string; asset?: unknown}}) => {
      if (!value?.asset) return null;
      const src = urlFor(value).width(1600).auto("format").url();
      if (!src) return null;
      return (
        <Image
          src={src}
          alt={value.alt || ""}
          width={1600}
          height={1000}
          className="h-auto w-full"
        />
      );
    },
  },
};

function ProjectArticle({project}: {project: NonNullable<PROJECT_QUERY_RESULT>}) {
  const dates = [project.startDate, project.endDate].filter(Boolean).join(" – ");
  const disciplines = (project.disciplines ?? []).filter(Boolean).join(" · ");
  const tools = (project.tools ?? []).filter(Boolean).join(", ");
  const hero = project.mainImage?.asset
    ? urlFor(project.mainImage).width(1600).auto("format").url()
    : null;

  return (
    <article className="flex flex-col gap-6">
      <header className="flex flex-col gap-3">
        <h1 className="text-3xl font-semibold tracking-tight">{project.title}</h1>
        {project.summary ? <p className="text-lg">{project.summary}</p> : null}
        <dl className="flex flex-col gap-1 text-sm">
          {project.role ? (
            <div>
              <dt className="inline">Role: </dt>
              <dd className="inline">{project.role}</dd>
            </div>
          ) : null}
          {disciplines ? (
            <div>
              <dt className="inline">Disciplines: </dt>
              <dd className="inline">{disciplines}</dd>
            </div>
          ) : null}
          {tools ? (
            <div>
              <dt className="inline">Tools: </dt>
              <dd className="inline">{tools}</dd>
            </div>
          ) : null}
          {dates ? (
            <div>
              <dt className="inline">Dates: </dt>
              <dd className="inline">{dates}</dd>
            </div>
          ) : null}
        </dl>
        {project.projectUrl ? (
          <a className="underline" href={project.projectUrl} rel="noreferrer">
            Visit project
          </a>
        ) : null}
      </header>
      {hero ? (
        <Image
          src={hero}
          alt={project.mainImage?.alt || project.title || ""}
          width={1600}
          height={1000}
          className="h-auto w-full"
          priority
        />
      ) : null}
      {project.description ? <p>{project.description}</p> : null}
      {project.objective ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-xl font-semibold">Objective</h2>
          <p>{project.objective}</p>
        </section>
      ) : null}
      {Array.isArray(project.body) && project.body.length > 0 ? (
        <div className="flex flex-col gap-4 leading-7 [&_a]:underline [&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:pl-5">
          <PortableText components={components} value={project.body} />
        </div>
      ) : null}
      {project.deliverablesText ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-xl font-semibold">Deliverables</h2>
          <p>{project.deliverablesText}</p>
        </section>
      ) : null}
      {project.outcomesText ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-xl font-semibold">Outcomes</h2>
          <p>{project.outcomesText}</p>
        </section>
      ) : null}
    </article>
  );
}

export const instant = false;

export default async function ProjectPage({params}: {params: Promise<{slug: string}>}) {
  const {slug} = await params;
  const project = await client.fetch(PROJECT_QUERY, {slug}, options);
  if (!project) notFound();

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-6 py-16">
      <Link href="/projects" className="text-sm underline">
        All projects
      </Link>
      <ProjectArticle project={project} />
    </main>
  );
}
