'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';

/**
 * Error code reference page.
 *
 * Renders the backend error catalog and supports deep links of the form
 * `/support/error-codes#CODE` (the transaction error dialog links here).
 * When the page loads with a hash, the matching entry is scrolled into view
 * and highlighted.
 */

export interface ErrorCodeEntry {
  code: string;
  title: string;
  description: string;
  fix?: string;
}

/** Fallback catalog used when the backend catalog is unavailable. */
const FALLBACK_CATALOG: ErrorCodeEntry[] = [
  {
    code: 'AUTH_REQUIRED',
    title: 'Authentication required',
    description: 'The request was made without a valid session.',
    fix: 'Sign in again and retry the action.',
  },
  {
    code: 'INSUFFICIENT_FUNDS',
    title: 'Insufficient funds',
    description: 'The account balance is too low to complete the transaction.',
    fix: 'Top up the account or use a different payment method.',
  },
  {
    code: 'CLAIM_NOT_FOUND',
    title: 'Claim not found',
    description: 'The referenced claim does not exist or is not visible to you.',
    fix: 'Check the claim reference and try again.',
  },
  {
    code: 'POLICY_EXPIRED',
    title: 'Policy expired',
    description: 'The referenced policy is no longer active.',
    fix: 'Renew the policy before retrying.',
  },
  {
    code: 'RATE_LIMITED',
    title: 'Too many requests',
    description: 'You have exceeded the allowed request rate.',
    fix: 'Wait a moment and retry.',
  },
  {
    code: 'VALIDATION_ERROR',
    title: 'Validation error',
    description: 'One or more submitted fields are invalid.',
    fix: 'Review the highlighted fields and submit again.',
  },
];

function normalizeHash(hash: string): string {
  return decodeURIComponent(hash.replace(/^#/, '')).trim().toUpperCase();
}

export default function ErrorCodesPage() {
  const [catalog, setCatalog] = useState<ErrorCodeEntry[]>(FALLBACK_CATALOG);
  const [query, setQuery] = useState('');
  const [activeCode, setActiveCode] = useState<string | null>(null);
  const entryRefs = useRef<Record<string, HTMLLIElement | null>>({});

  // Load the backend error catalog when available.
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch('/api/support/error-codes', {
          headers: { Accept: 'application/json' },
        });
        if (!res.ok) return;
        const data = (await res.json()) as ErrorCodeEntry[];
        if (!cancelled && Array.isArray(data) && data.length > 0) {
          setCatalog(data);
        }
      } catch {
        // Keep the fallback catalog on failure.
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  // Deep link handling: scroll to and highlight the entry referenced by the hash.
  useEffect(() => {
    function applyHash() {
      const code = normalizeHash(window.location.hash);
      if (!code) {
        setActiveCode(null);
        return;
      }
      setActiveCode(code);
      const el = entryRefs.current[code];
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }
    applyHash();
    window.addEventListener('hashchange', applyHash);
    return () => window.removeEventListener('hashchange', applyHash);
  }, [catalog]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return catalog;
    return catalog.filter((entry) =>
      [entry.code, entry.title, entry.description, entry.fix ?? '']
        .join(' ')
        .toLowerCase()
        .includes(q),
    );
  }, [catalog, query]);

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <nav className="mb-6 text-sm text-gray-500">
        <Link href="/support" className="hover:underline">
          Support
        </Link>
        <span className="mx-2">/</span>
        <span className="text-gray-700">Error codes</span>
      </nav>

      <h1 className="text-2xl font-semibold text-gray-900">Error code reference</h1>
      <p className="mt-2 text-sm text-gray-600">
        Every error code returned by the platform, with an explanation and a suggested fix.
      </p>

      <div className="mt-6">
        <label htmlFor="error-code-search" className="sr-only">
          Search error codes
        </label>
        <input
          id="error-code-search"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by code or message…"
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
      </div>

      {filtered.length === 0 ? (
        <p className="mt-8 text-sm text-gray-500">No error codes match your search.</p>
      ) : (
        <ul className="mt-8 space-y-4">
          {filtered.map((entry) => {
            const code = entry.code.toUpperCase();
            const isActive = activeCode === code;
            return (
              <li
                key={entry.code}
                id={entry.code}
                ref={(el) => {
                  entryRefs.current[code] = el;
                }}
                className={`scroll-mt-24 rounded-lg border p-4 transition-colors ${
                  isActive
                    ? 'border-blue-500 bg-blue-50'
                    : 'border-gray-200 bg-white'
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <code className="rounded bg-gray-100 px-2 py-0.5 text-sm font-mono text-gray-800">
                    {entry.code}
                  </code>
                  <a
                    href={`#${entry.code}`}
                    className="text-xs text-blue-600 hover:underline"
                    aria-label={`Link to ${entry.code}`}
                  >
                    #
                  </a>
                </div>
                <h2 className="mt-2 text-base font-medium text-gray-900">{entry.title}</h2>
                <p className="mt-1 text-sm text-gray-600">{entry.description}</p>
                {entry.fix ? (
                  <p className="mt-2 text-sm text-gray-700">
                    <span className="font-medium">Fix: </span>
                    {entry.fix}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
