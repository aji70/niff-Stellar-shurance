import Link from "next/link";
import type { ReactNode } from "react";

const GITHUB_REPO = "https://github.com/handsoff/contracts";

export interface TocItem {
  id: string;
  title: string;
}

export interface DocsNavItem {
  href: string;
  title: string;
}

export interface DocsLayoutProps {
  title: string;
  description?: string;
  toc?: TocItem[];
  prev?: DocsNavItem;
  next?: DocsNavItem;
  /** Path of the MDX source relative to the repo root, used for the edit link. */
  sourcePath: string;
  children: ReactNode;
}

function editUrl(sourcePath: string): string {
  return `${GITHUB_REPO}/edit/main/${sourcePath.replace(/^\/+/, "")}`;
}

export default function DocsLayout({
  title,
  description,
  toc = [],
  prev,
  next,
  sourcePath,
  children,
}: DocsLayoutProps) {
  return (
    <div className="mx-auto flex w-full max-w-6xl gap-10 px-4 py-10">
      <aside className="hidden w-56 shrink-0 lg:block">
        <nav aria-label="Table of contents" className="sticky top-24">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500">
            On this page
          </p>
          {toc.length === 0 ? (
            <p className="text-sm text-gray-400">No sections</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {toc.map((item) => (
                <li key={item.id}>
                  <a
                    href={`#${item.id}`}
                    className="text-gray-600 hover:text-gray-900"
                  >
                    {item.title}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </nav>
      </aside>

      <article className="min-w-0 flex-1">
        <header className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
          {description ? (
            <p className="mt-2 text-gray-600">{description}</p>
          ) : null}
          <a
            href={editUrl(sourcePath)}
            target="_blank"
            rel="noreferrer"
            className="mt-3 inline-block text-sm text-blue-600 hover:underline"
          >
            Edit on GitHub
          </a>
        </header>

        <div className="prose prose-gray max-w-none">{children}</div>

        <nav
          aria-label="Previous and next"
          className="mt-12 flex items-center justify-between border-t border-gray-200 pt-6 text-sm"
        >
          {prev ? (
            <Link href={prev.href} className="text-blue-600 hover:underline">
              &larr; {prev.title}
            </Link>
          ) : (
            <span />
          )}
          {next ? (
            <Link href={next.href} className="text-blue-600 hover:underline">
              {next.title} &rarr;
            </Link>
          ) : (
            <span />
          )}
        </nav>
      </article>
    </div>
  );
}
