'use client'

import { useState } from 'react'
import { Copy, ExternalLink } from 'lucide-react'
import { cn } from '@/lib/utils'
import { toast } from '@/components/ui/use-toast'

export type StellarNetwork = 'testnet' | 'public'

export interface WalletAddressProps {
  address: string
  network?: StellarNetwork
  showCopy?: boolean
  showExplorer?: boolean
  className?: string
}

function isValidStellarAddress(address: string): boolean {
  return (
    typeof address === 'string' &&
    address.length >= 8 &&
    (address.startsWith('G') || address.startsWith('C'))
  )
}

function truncate(address: string): string {
  if (address.length <= 8) return address
  return `${address.slice(0, 4)}...${address.slice(-4)}`
}

function explorerUrl(address: string, network: StellarNetwork): string {
  const base =
    network === 'public'
      ? 'https://stellar.expert/explorer/public/account'
      : 'https://stellar.expert/explorer/testnet/account'
  return `${base}/${address}`
}

export function WalletAddress({
  address,
  network = 'testnet',
  showCopy = true,
  showExplorer = true,
  className,
}: WalletAddressProps) {
  const [copied, setCopied] = useState(false)

  if (!isValidStellarAddress(address)) {
    return (
      <span className={cn('font-mono text-sm text-muted-foreground', className)}>
        —
      </span>
    )
  }

  const display = truncate(address)

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(address)
      setCopied(true)
      toast({ title: 'Copied!', description: address })
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // clipboard unavailable — silent fail
    }
  }

  return (
    <span className={cn('inline-flex items-center gap-1', className)}>
      <span
        className="font-mono text-sm"
        title={address}
        aria-label={address}
      >
        {display}
      </span>

      {showCopy && (
        <button
          type="button"
          onClick={handleCopy}
          aria-label={copied ? 'Copied!' : `Copy address ${address}`}
          className="inline-flex items-center rounded p-0.5 text-muted-foreground hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        >
          <Copy className="h-3.5 w-3.5" aria-hidden="true" />
          {copied && (
            <span className="ml-1 text-xs text-green-600" aria-live="polite">
              Copied!
            </span>
          )}
        </button>
      )}

      {showExplorer && (
        <a
          href={explorerUrl(address, network)}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`View ${address} on Stellar Expert explorer`}
          className="inline-flex items-center rounded p-0.5 text-muted-foreground hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        >
          <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
        </a>
      )}
    </span>
  )
}
