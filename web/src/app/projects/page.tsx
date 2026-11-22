import {Suspense} from "react";
import {ProjectList} from "@/components/project-list";

export const metadata = {
  title: "Projects",
};

export default function ProjectsPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-6 py-16">
      <h1 className="text-3xl font-semibold tracking-tight">Projects</h1>
      <Suspense fallback={<p>Loading projects…</p>}>
        <ProjectList />
      </Suspense>
    </main>
  );
}
