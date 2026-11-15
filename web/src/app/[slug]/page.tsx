import {defineQuery, PortableText} from "next-sanity";
import Link from "next/link";
import {notFound} from "next/navigation";
import {Suspense} from "react";
import {client} from "@/sanity/client";

const POST_QUERY = defineQuery(
  `*[_type == "post" && slug.current == $slug][0]{ _id, title, body }`,
);

const options = {next: {revalidate: 30}};

async function Post({params}: {params: Promise<{slug: string}>}) {
  const {slug} = await params;
  const post = await client.fetch(POST_QUERY, {slug}, options);

  if (!post) return notFound();

  return (
    <article className="flex flex-col gap-6">
      <h1 className="text-3xl font-semibold tracking-tight">{post.title}</h1>
      {Array.isArray(post.body) && <PortableText value={post.body} />}
    </article>
  );
}

export default function PostPage({params}: {params: Promise<{slug: string}>}) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-6 py-16">
      <Link href="/" className="text-sm underline">
        All posts
      </Link>
      <Suspense fallback={<p>Loading post…</p>}>
        <Post params={params} />
      </Suspense>
    </main>
  );
}
