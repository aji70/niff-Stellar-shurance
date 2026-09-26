import Link from "next/link";
import type { ReactNode } from "react";

/**
 * Custom MDX components used by the /docs section.
 *
 * MDX is authored in-repo only; these components are never fed remote or
 * user-supplied content.
 */

type CalloutType = "info" | "warning" | "danger" | "success";

const CALLOUT_STYLES: Record<CalloutType, { wrapper: string; label: string }> = {
  info: {
    wrapper: "border-blue-500/40 bg-blue-500/10 text-blue-100",
    label: "Info",
  },
  warning: {
    wrapper: "border-amber-500/40 bg-amber-500/10 text-amber-100",
    label: "Warning",
  },
  danger: {
    wrapper: "border-red-500/40 bg-red-500/10 text-red-100",
    label: "Danger",
  },
  success: {
    wrapper: "border-emerald-500/40 bg-emerald-500/10 text-emerald-100",
    label: "Success",
  },
};

export function Callout({
  type = "info",
  title,
  children,
}: {
  type?: CalloutType;
  title?: string;
  children: ReactNode;
}) {
  const style = CALLOUT_STYLES[type] ?? CALLOUT_STYLES.info;

  return (
    <aside
      role="note"
      className={`my-6 rounded-lg border px-4 py-3 text-sm leading-relaxed ${style.wrapper}`}
    >
      <p className="mb-1 font-semibold">{title ?? style.label}</p>
      <div className="[&>p]:m-0">{children}</div>
    </aside>
  );
}

/**
 * Contract address block with copy-to-clipboard and an explorer link.
 *
 * The address is read from env per network at build time so every docs page
 * can be statically generated.
 */
export function ContractAddress({
  address,
  network = "mainnet",
  label,
}: {
  address?: string;
  network?: string;
  label?: string;
}) {
  const resolved =
    address ??
    process.env[`NEXT_PUBLIC_CONTRACT_ADDRESS_${network.toUpperCase()}`] ??
    "";

  const explorerBase =
    process.env[`NEXT_PUBLIC_EXPLORER_URL_${network.toUpperCase()}`] ??
    "https://etherscan.io";

  const explorerUrl = resolved ? `${explorerBase}/address/${resolved}` : undefined;

  return (
    <div className="my-6 rounded-lg border border-white/10 bg-white/5 px-4 py-3">
      <p className="mb-1 text-xs uppercase tracking-wide text-white/50">
        {label ?? `${network} contract`}
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <code className="break-all font-mono text-sm text-white/90">
          {resolved || "Not configured"}
        </code>
        {resolved ? (
          <>
            <CopyButton value={resolved} />
            {explorerUrl ? (
              <a
                href={explorerUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="text-sm text-blue-400 underline-offset-2 hover:underline"
              >
                View on explorer
              </a>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
}

function CopyButton({ value }: { value: string }) {
  return (
    <button
      type="button"
      onClick={() => {
        if (typeof navigator !== "undefined" && navigator.clipboard) {
          void navigator.clipboard.writeText(value);
        }
      }}
      className="rounded border border-white/15 px-2 py-1 text-xs text-white/80 transition hover:bg-white/10"
    >
      Copy
    </button>
  );
}

/**
 * Anchor that keeps internal docs navigation client-side while allowing
 * external links to open normally.
 */
export function DocsLink({ href, children }: { href: string; children: ReactNode }) {
  if (href.startsWith("http")) {
    return (
      <a href={href} target="_blank" rel="noreferrer noopener">
        {children}
      </a>
    );
  }

  return <Link href={href}>{children}</Link>;
}

export const mdxComponents = {
  Callout,
  ContractAddress,
  DocsLink,
  a: DocsLink,
};
