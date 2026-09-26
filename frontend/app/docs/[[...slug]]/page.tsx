import { notFound } from "next/navigation";
import { MDXRemote } from "next-mdx-remote/rsc";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import Link from "next/link";
import { mdxComponents } from "@/components/docs/mdx-components";
import { DocsSidebar } from "@/components/docs/sidebar";
import { TableOfContents } from "@/components/docs/table-of-contents";
import { getDocNav, getDocSlugs, getDocSource } from "@/lib/docs";

export const dynamicParams = false;

export function generateStaticParams() {
  return getDocSlugs().map((slug) => ({ slug: slug.length ? slug : undefined }));
}

export function generateMetadata({ params }: { params: { slug?: string[] } }) {
  const doc = getDocSource(params.slug ?? []);
  if (!doc) return {};
  return { title: `${doc.title} — Docs` };
}

export default function DocsPage({ params }: { params: { slug?: string[] } }) {
  const slug = params.slug ?? [];
  const doc = getDocSource(slug);
  if (!doc) notFound();

  const nav = getDocNav();
  const index = nav.findIndex((item) => item.slug.join("/") === slug.join("/"));
  const prev = index > 0 ? nav[index - 1] : null;
  const next = index >= 0 && index < nav.length - 1 ? nav[index + 1] : null;

  return (
    <div className="mx-auto flex max-w-6xl gap-10 px-4 py-10">
      <DocsSidebar items={nav} active={slug.join("/")} />
      <article className="prose min-w-0 flex-1">
        <MDXRemote source={doc.content} components={mdxComponents} />
        <nav className="mt-12 flex justify-between border-t pt-6 text-sm">
          {prev ? (
            <Link href={`/docs/${prev.slug.join("/")}`}>← {prev.title}</Link>
          ) : (
            <span />
          )}
          {next ? (
            <Link href={`/docs/${next.slug.join("/")}`}>{next.title} →</Link>
          ) : (
            <span />
          )}
        </nav>
        <a
          className="mt-4 inline-block text-sm text-gray-500 hover:underline"
          href={`https://github.com/handsoff/app/edit/main/frontend/content/docs/${slug.join("/") || "index"}.mdx`}
          target="_blank"
          rel="noreferrer"
        >
          Edit on GitHub
        </a>
      </article>
      <TableOfContents headings={doc.headings} />
    </div>
  );
}
