import {defineQuery} from "next-sanity";
import Link from "next/link";
import {Suspense} from "react";
import {client} from "@/sanity/client";

const POSTS_QUERY = defineQuery(
  `*[_type == "post" && defined(slug.current)] | order(_createdAt desc){ _id, title, slug }`,
);

const options = {next: {revalidate: 30}};

async function PostList() {
  const posts = await client.fetch(POSTS_QUERY, {}, options);

  if (posts.length === 0) {
    return <p>No posts yet.</p>;
  }

  return (
    <ul className="flex flex-col gap-3">
      {posts.map((post) => {
        const slug = post.slug?.current;
        if (!slug) return null;

        return (
          <li key={post._id}>
            <Link href={`/${slug}`} className="text-lg underline">
              {post.title}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export default function PostsPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-6 py-16">
      <h1 className="text-3xl font-semibold tracking-tight">Posts</h1>
      <Suspense fallback={<p>Loading posts…</p>}>
        <PostList />
      </Suspense>
    </main>
  );
}
