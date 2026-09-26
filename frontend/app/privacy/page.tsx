'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { MDXRemote } from 'next-mdx-remote';
import { serialize } from 'next-mdx-remote/serialize';
import { mdxComponents } from '@/components/mdx';
import privacyPolicy from '@/content/privacy/index.mdx';

type RequestKind = 'export' | 'deletion';
type RequestStatus = 'pending' | 'processing' | 'ready' | 'completed' | 'rejected';

interface PrivacyRequest {
  id: string;
  kind: RequestKind;
  status: RequestStatus;
  createdAt: string;
  downloadUrl?: string;
}

const STATUS_LABELS: Record<RequestStatus, string> = {
  pending: 'Pending review',
  processing: 'Processing',
  ready: 'Ready',
  completed: 'Completed',
  rejected: 'Rejected',
};

const POLICY_FALLBACK = `# Privacy Policy

We collect only the data required to operate the service. On-chain data is public and permanent and cannot be deleted by us.`;

export default function PrivacyPage() {
  const [policySource, setPolicySource] = useState<string | null>(null);
  const [requests, setRequests] = useState<PrivacyRequest[]>([]);
  const [kind, setKind] = useState<RequestKind>('export');
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const source = typeof privacyPolicy === 'string' ? privacyPolicy : POLICY_FALLBACK;
    serialize(source)
      .then((mdx) => {
        if (active) setPolicySource(mdx.compiledSource);
      })
      .catch(() => {
        if (active) setPolicySource(null);
      });
    return () => {
      active = false;
    };
  }, []);

  const loadRequests = useCallback(async () => {
    try {
      const res = await fetch('/api/privacy/requests', { credentials: 'include' });
      if (!res.ok) return;
      const data = (await res.json()) as { requests?: PrivacyRequest[] };
      setRequests(data.requests ?? []);
    } catch {
      // Status tracking is best-effort; the form still works without it.
    }
  }, []);

  useEffect(() => {
    void loadRequests();
  }, [loadRequests]);

  const submitRequest = useCallback(async () => {
    setSubmitting(true);
    setError(null);
    setNotice(null);
    try {
      const body: Record<string, unknown> = { kind };
      if (kind === 'deletion') {
        // Deletion requires re-authentication: sign a fresh challenge.
        const challengeRes = await fetch('/api/auth/challenge', {
          method: 'POST',
          credentials: 'include',
        });
        if (!challengeRes.ok) throw new Error('Could not start re-authentication.');
        const { challenge } = (await challengeRes.json()) as { challenge: string };
        const signature = await signChallenge(challenge);
        body.challenge = challenge;
        body.signature = signature;
      }
      const res = await fetch('/api/privacy/requests', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(payload.message ?? 'Request failed. Please try again.');
      }
      setNotice(
        kind === 'export'
          ? 'Export requested. We will email you when it is ready.'
          : 'Deletion requested. We will confirm once processed.',
      );
      setConfirming(false);
      await loadRequests();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed.');
    } finally {
      setSubmitting(false);
    }
  }, [kind, loadRequests]);

  const policy = useMemo(() => {
    if (policySource) {
      return <MDXRemote compiledSource={policySource} components={mdxComponents} />;
    }
    return <p className="text-sm text-gray-600">{POLICY_FALLBACK}</p>;
  }, [policySource]);

  return (
    <main className="mx-auto max-w-3xl px-4 py-12">
      <h1 className="text-3xl font-bold">Privacy</h1>
      <p className="mt-2 text-sm text-gray-600">
        Learn how we handle your data and request an export or deletion of your account data.
      </p>

      <section className="prose mt-8 max-w-none">{policy}</section>

      <section className="mt-12 rounded-lg border border-gray-200 p-6">
        <h2 className="text-xl font-semibold">Request your data</h2>
        <p className="mt-2 text-sm text-gray-600">
          On-chain data is public and permanent. We cannot delete data that has been written to a
          blockchain, but we can delete off-chain account data.
        </p>

        <div className="mt-4 flex gap-4">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="kind"
              value="export"
              checked={kind === 'export'}
              onChange={() => setKind('export')}
            />
            Data export
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="kind"
              value="deletion"
              checked={kind === 'deletion'}
              onChange={() => setKind('deletion')}
            />
            Data deletion
          </label>
        </div>

        {kind === 'deletion' && (
          <p className="mt-3 text-sm text-amber-700">
            Deletion requires re-authentication. You will be asked to sign a fresh challenge.
          </p>
        )}

        {!confirming ? (
          <button
            type="button"
            className="mt-4 rounded bg-black px-4 py-2 text-sm text-white disabled:opacity-50"
            onClick={() => setConfirming(true)}
          >
            Continue
          </button>
        ) : (
          <div className="mt-4 rounded border border-gray-300 p-4">
            <p className="text-sm">
              Confirm you want to request a <strong>{kind}</strong> of your data.
            </p>
            <div className="mt-3 flex gap-3">
              <button
                type="button"
                className="rounded bg-black px-4 py-2 text-sm text-white disabled:opacity-50"
                disabled={submitting}
                onClick={() => void submitRequest()}
              >
                {submitting ? 'Submitting…' : 'Confirm request'}
              </button>
              <button
                type="button"
                className="rounded border border-gray-300 px-4 py-2 text-sm"
                disabled={submitting}
                onClick={() => setConfirming(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {notice && <p className="mt-3 text-sm text-green-700">{notice}</p>}
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      </section>

      <section className="mt-12">
        <h2 className="text-xl font-semibold">Your requests</h2>
        {requests.length === 0 ? (
          <p className="mt-2 text-sm text-gray-600">You have no privacy requests yet.</p>
        ) : (
          <ul className="mt-4 divide-y divide-gray-200 rounded border border-gray-200">
            {requests.map((request) => (
              <li key={request.id} className="flex items-center justify-between p-4 text-sm">
                <div>
                  <p className="font-medium capitalize">{request.kind}</p>
                  <p className="text-gray-500">
                    {new Date(request.createdAt).toLocaleString()}
                  </p>
                </div>
                <div className="flex items-center gap-4">
                  <span className="rounded bg-gray-100 px-2 py-1 text-xs">
                    {STATUS_LABELS[request.status]}
                  </span>
                  {request.kind === 'export' && request.status === 'ready' && request.downloadUrl && (
                    <a
                      className="text-blue-600 underline"
                      href={request.downloadUrl}
                      download
                    >
                      Download
                    </a>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="mt-12 text-sm text-gray-600">
        Questions? Visit our <Link className="underline" href="/support">support page</Link>.
      </p>
    </main>
  );
}

async function signChallenge(challenge: string): Promise<string> {
  const provider = (window as unknown as { ethereum?: { request: (args: { method: string; params?: unknown[] }) => Promise<string> } }).ethereum;
  if (!provider) throw new Error('No wallet available for re-authentication.');
  const accounts = await provider.request({ method: 'eth_requestAccounts' });
  const address = Array.isArray(accounts) ? accounts[0] : accounts;
  return provider.request({
    method: 'personal_sign',
    params: [challenge, address],
  });
}
