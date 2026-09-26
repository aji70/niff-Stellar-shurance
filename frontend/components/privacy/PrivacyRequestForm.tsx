'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAccount, useSignMessage } from 'wagmi';

/**
 * Privacy request flow for signed-in users.
 *
 * Supports requesting a data export or a data deletion. Deletion requires
 * re-authentication by signing a fresh challenge. Requests are tracked and
 * their status is displayed, with a download link once an export is ready.
 */

type RequestType = 'export' | 'deletion';

type RequestStatus = 'pending' | 'processing' | 'ready' | 'completed' | 'rejected';

interface PrivacyRequest {
  id: string;
  type: RequestType;
  status: RequestStatus;
  createdAt: string;
  downloadUrl?: string;
}

const STATUS_LABELS: Record<RequestStatus, string> = {
  pending: 'Pending',
  processing: 'Processing',
  ready: 'Ready',
  completed: 'Completed',
  rejected: 'Rejected',
};

async function fetchRequests(address: string): Promise<PrivacyRequest[]> {
  const res = await fetch(`/api/privacy/requests?address=${encodeURIComponent(address)}`);
  if (!res.ok) throw new Error('Failed to load privacy requests');
  return res.json();
}

async function submitRequest(
  address: string,
  type: RequestType,
  signature?: string,
): Promise<PrivacyRequest> {
  const res = await fetch('/api/privacy/requests', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address, type, signature }),
  });
  if (!res.ok) throw new Error('Failed to submit privacy request');
  return res.json();
}

export function PrivacyRequestForm() {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();

  const [requests, setRequests] = useState<PrivacyRequest[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<RequestType | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const loadRequests = useCallback(async () => {
    if (!address) return;
    setLoading(true);
    setError(null);
    try {
      setRequests(await fetchRequests(address));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }, [address]);

  useEffect(() => {
    void loadRequests();
  }, [loadRequests]);

  const handleConfirm = useCallback(async () => {
    if (!address || !confirming) return;
    setSubmitting(true);
    setError(null);
    try {
      let signature: string | undefined;
      if (confirming === 'deletion') {
        // Deletion requires re-authentication: sign a fresh challenge.
        const challenge = `Confirm deletion of off-chain data for ${address} at ${new Date().toISOString()}`;
        signature = await signMessageAsync({ message: challenge });
      }
      const created = await submitRequest(address, confirming, signature);
      setRequests((prev) => [created, ...prev]);
      setConfirming(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setSubmitting(false);
    }
  }, [address, confirming, signMessageAsync]);

  if (!isConnected || !address) {
    return (
      <section className="rounded-lg border border-gray-200 p-6">
        <h2 className="text-lg font-semibold">Privacy requests</h2>
        <p className="mt-2 text-sm text-gray-600">
          Connect your wallet to request a data export or deletion.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-lg border border-gray-200 p-6">
      <h2 className="text-lg font-semibold">Privacy requests</h2>
      <p className="mt-2 text-sm text-gray-600">
        You can request an export of your off-chain data or its deletion. Note that on-chain data
        cannot be deleted.
      </p>

      <div className="mt-4 flex flex-wrap gap-3">
        <button
          type="button"
          className="rounded-md bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          disabled={submitting}
          onClick={() => setConfirming('export')}
        >
          Request data export
        </button>
        <button
          type="button"
          className="rounded-md border border-red-300 px-4 py-2 text-sm font-medium text-red-700 disabled:opacity-50"
          disabled={submitting}
          onClick={() => setConfirming('deletion')}
        >
          Request data deletion
        </button>
      </div>

      {confirming && (
        <div className="mt-4 rounded-md border border-amber-300 bg-amber-50 p-4">
          <p className="text-sm text-amber-900">
            {confirming === 'deletion'
              ? 'Deleting your off-chain data is permanent and requires you to sign a fresh challenge. On-chain data cannot be deleted. Continue?'
              : 'We will prepare an export of your off-chain data. Continue?'}
          </p>
          <div className="mt-3 flex gap-3">
            <button
              type="button"
              className="rounded-md bg-black px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
              disabled={submitting}
              onClick={handleConfirm}
            >
              {submitting ? 'Submitting…' : 'Confirm'}
            </button>
            <button
              type="button"
              className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium disabled:opacity-50"
              disabled={submitting}
              onClick={() => setConfirming(null)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

      <div className="mt-6">
        <h3 className="text-sm font-semibold">Your requests</h3>
        {loading ? (
          <p className="mt-2 text-sm text-gray-500">Loading…</p>
        ) : requests.length === 0 ? (
          <p className="mt-2 text-sm text-gray-500">No requests yet.</p>
        ) : (
          <ul className="mt-2 divide-y divide-gray-100">
            {requests.map((request) => (
              <li key={request.id} className="flex items-center justify-between py-2 text-sm">
                <span className="capitalize">{request.type}</span>
                <span className="text-gray-500">{STATUS_LABELS[request.status]}</span>
                {request.type === 'export' && request.status === 'ready' && request.downloadUrl ? (
                  <a
                    className="font-medium text-blue-600 underline"
                    href={request.downloadUrl}
                    download
                  >
                    Download
                  </a>
                ) : (
                  <span />
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

export default PrivacyRequestForm;
