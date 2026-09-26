'use client';

import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'privacy.consent.v1';

type ConsentValue = 'accepted' | 'rejected';

interface StoredConsent {
  value: ConsentValue;
  timestamp: string;
}

function readConsent(): StoredConsent | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredConsent;
    if (parsed && (parsed.value === 'accepted' || parsed.value === 'rejected')) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

function writeConsent(value: ConsentValue): void {
  if (typeof window === 'undefined') return;
  try {
    const payload: StoredConsent = { value, timestamp: new Date().toISOString() };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Storage may be unavailable (private mode); fail silently.
  }
}

/**
 * Cookie and analytics consent banner.
 *
 * Shown only when analytics are configured (NEXT_PUBLIC_ANALYTICS_ENABLED)
 * and the visitor has not yet made a choice. The decision is persisted in
 * localStorage so the banner is not shown again.
 */
export function ConsentBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const analyticsEnabled = process.env.NEXT_PUBLIC_ANALYTICS_ENABLED === 'true';
    if (!analyticsEnabled) return;
    if (readConsent()) return;
    setVisible(true);
  }, []);

  const decide = useCallback((value: ConsentValue) => {
    writeConsent(value);
    setVisible(false);
  }, []);

  if (!visible) return null;

  return (
    <div
      role="dialog"
      aria-live="polite"
      aria-label="Cookie and analytics consent"
      className="fixed inset-x-0 bottom-0 z-50 border-t border-gray-200 bg-white/95 p-4 shadow-lg backdrop-blur dark:border-gray-800 dark:bg-gray-900/95"
    >
      <div className="mx-auto flex max-w-5xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-gray-700 dark:text-gray-300">
          We use cookies and analytics to understand how the site is used. You can accept or
          reject analytics tracking. See our{' '}
          <a href="/privacy" className="font-medium text-blue-600 underline dark:text-blue-400">
            privacy policy
          </a>{' '}
          for details.
        </p>
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            onClick={() => decide('rejected')}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
          >
            Reject
          </button>
          <button
            type="button"
            onClick={() => decide('accepted')}
            className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
          >
            Accept
          </button>
        </div>
      </div>
    </div>
  );
}

export default ConsentBanner;
