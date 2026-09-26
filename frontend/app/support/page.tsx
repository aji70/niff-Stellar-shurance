'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';

interface FaqEntry {
  id: string;
  question: string;
  answer: string;
}

const FAQ_ENTRIES: FaqEntry[] = [
  {
    id: 'faq-account',
    question: 'How do I reset my password?',
    answer:
      'Open Settings, choose Security, and select "Reset password". A reset link will be emailed to your registered address.',
  },
  {
    id: 'faq-claim',
    question: 'How do I file a claim?',
    answer:
      'Go to Claims, select "New claim", and attach the relevant policy. You can track the status from the same page.',
  },
  {
    id: 'faq-policy',
    question: 'Where can I find my policy documents?',
    answer:
      'All policy documents are available under Policies. Select a policy to download the latest version.',
  },
  {
    id: 'faq-error',
    question: 'What does an error code mean?',
    answer:
      'Every error code is documented on the error code reference page, including an explanation and suggested fix.',
  },
];

interface Ticket {
  id: string;
  subject: string;
  status: 'open' | 'closed';
  createdAt: string;
}

const MOCK_TICKETS: Ticket[] = [
  { id: 'T-1001', subject: 'Unable to upload claim document', status: 'open', createdAt: '2024-05-01' },
  { id: 'T-1002', subject: 'Question about policy renewal', status: 'closed', createdAt: '2024-04-18' },
];

interface TicketFormState {
  subject: string;
  message: string;
  linkType: 'none' | 'claim' | 'policy';
  linkId: string;
  captcha: string;
}

const EMPTY_FORM: TicketFormState = {
  subject: '',
  message: '',
  linkType: 'none',
  linkId: '',
  captcha: '',
};

const CAPTCHA_ANSWER = '7';

export default function SupportPage() {
  const [query, setQuery] = useState('');
  const [openFaq, setOpenFaq] = useState<string | null>(null);
  const [helpful, setHelpful] = useState<Record<string, boolean>>({});
  const [form, setForm] = useState<TicketFormState>(EMPTY_FORM);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitted, setSubmitted] = useState(false);

  // Assume the user is signed in when a session token is present.
  const isSignedIn = useMemo(() => {
    if (typeof window === 'undefined') return false;
    return Boolean(window.localStorage.getItem('auth_token'));
  }, []);

  const filteredFaq = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return FAQ_ENTRIES;
    return FAQ_ENTRIES.filter(
      (entry) =>
        entry.question.toLowerCase().includes(q) || entry.answer.toLowerCase().includes(q),
    );
  }, [query]);

  function updateField<K extends keyof TicketFormState>(key: K, value: TicketFormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function validate(): boolean {
    const next: Record<string, string> = {};
    if (!form.subject.trim()) next.subject = 'Subject is required.';
    if (!form.message.trim()) next.message = 'Message is required.';
    if (form.linkType !== 'none' && !form.linkId.trim()) {
      next.linkId = `Enter the ${form.linkType} reference.`;
    }
    if (!isSignedIn && form.captcha.trim() !== CAPTCHA_ANSWER) {
      next.captcha = 'Incorrect captcha answer.';
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!validate()) return;
    setSubmitted(true);
    setForm(EMPTY_FORM);
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="text-2xl font-semibold">Support center</h1>
      <p className="mt-2 text-sm text-gray-600">
        Browse the FAQ, contact us, or look up an error code.
      </p>

      <nav className="mt-4 flex gap-4 text-sm">
        <Link className="text-blue-600 hover:underline" href="/support/error-codes">
          Error code reference
        </Link>
      </nav>

      <section className="mt-8">
        <h2 className="text-lg font-medium">Frequently asked questions</h2>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search the FAQ"
          aria-label="Search the FAQ"
          className="mt-3 w-full rounded border border-gray-300 px-3 py-2 text-sm"
        />

        <ul className="mt-4 divide-y divide-gray-200 rounded border border-gray-200">
          {filteredFaq.map((entry) => {
            const isOpen = openFaq === entry.id;
            return (
              <li key={entry.id}>
                <button
                  type="button"
                  onClick={() => setOpenFaq(isOpen ? null : entry.id)}
                  aria-expanded={isOpen}
                  className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-medium"
                >
                  {entry.question}
                  <span aria-hidden>{isOpen ? '\u2212' : '+'}</span>
                </button>
                {isOpen && (
                  <div className="px-4 pb-4 text-sm text-gray-700">
                    <p>{entry.answer}</p>
                    <div className="mt-3 flex items-center gap-3">
                      <span className="text-xs text-gray-500">Was this helpful?</span>
                      <button
                        type="button"
                        onClick={() => setHelpful((prev) => ({ ...prev, [entry.id]: true }))}
                        className="rounded border border-gray-300 px-2 py-1 text-xs"
                      >
                        Yes
                      </button>
                      <button
                        type="button"
                        onClick={() => setHelpful((prev) => ({ ...prev, [entry.id]: false }))}
                        className="rounded border border-gray-300 px-2 py-1 text-xs"
                      >
                        No
                      </button>
                      {helpful[entry.id] !== undefined && (
                        <span className="text-xs text-green-600">Thanks for your feedback.</span>
                      )}
                    </div>
                  </div>
                )}
              </li>
            );
          })}
          {filteredFaq.length === 0 && (
            <li className="px-4 py-3 text-sm text-gray-500">No matching questions.</li>
          )}
        </ul>
      </section>

      <section className="mt-10">
        <h2 className="text-lg font-medium">Contact us</h2>
        {submitted && (
          <p className="mt-2 text-sm text-green-600">
            Your ticket has been submitted. We will get back to you shortly.
          </p>
        )}
        <form onSubmit={handleSubmit} className="mt-3 space-y-4" noValidate>
          <div>
            <label className="block text-sm font-medium" htmlFor="subject">
              Subject
            </label>
            <input
              id="subject"
              value={form.subject}
              onChange={(e) => updateField('subject', e.target.value)}
              className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm"
            />
            {errors.subject && <p className="mt-1 text-xs text-red-600">{errors.subject}</p>}
          </div>

          <div>
            <label className="block text-sm font-medium" htmlFor="message">
              Message
            </label>
            <textarea
              id="message"
              rows={4}
              value={form.message}
              onChange={(e) => updateField('message', e.target.value)}
              className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm"
            />
            {errors.message && <p className="mt-1 text-xs text-red-600">{errors.message}</p>}
          </div>

          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-sm font-medium" htmlFor="linkType">
                Link to
              </label>
              <select
                id="linkType"
                value={form.linkType}
                onChange={(e) => updateField('linkType', e.target.value as TicketFormState['linkType'])}
                className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm"
              >
                <option value="none">Nothing</option>
                <option value="claim">Claim</option>
                <option value="policy">Policy</option>
              </select>
            </div>
            {form.linkType !== 'none' && (
              <div className="flex-1">
                <label className="block text-sm font-medium" htmlFor="linkId">
                  {form.linkType === 'claim' ? 'Claim reference' : 'Policy number'}
                </label>
                <input
                  id="linkId"
                  value={form.linkId}
                  onChange={(e) => updateField('linkId', e.target.value)}
                  className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm"
                />
                {errors.linkId && <p className="mt-1 text-xs text-red-600">{errors.linkId}</p>}
              </div>
            )}
          </div>

          {!isSignedIn && (
            <div>
              <label className="block text-sm font-medium" htmlFor="captcha">
                Captcha: what is 3 + 4?
              </label>
              <input
                id="captcha"
                value={form.captcha}
                onChange={(e) => updateField('captcha', e.target.value)}
                className="mt-1 w-32 rounded border border-gray-300 px-3 py-2 text-sm"
              />
              {errors.captcha && <p className="mt-1 text-xs text-red-600">{errors.captcha}</p>}
            </div>
          )}

          <button
            type="submit"
            className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white"
          >
            Submit ticket
          </button>
        </form>
      </section>

      <section className="mt-10">
        <h2 className="text-lg font-medium">Your tickets</h2>
        <ul className="mt-3 divide-y divide-gray-200 rounded border border-gray-200">
          {MOCK_TICKETS.map((ticket) => (
            <li key={ticket.id} className="flex items-center justify-between px-4 py-3 text-sm">
              <Link className="text-blue-600 hover:underline" href={`/support/tickets/${ticket.id}`}>
                {ticket.subject}
              </Link>
              <span className="text-xs text-gray-500">
                {ticket.status} \u00b7 {ticket.createdAt}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
