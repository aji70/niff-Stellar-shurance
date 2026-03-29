/**
 * @jest-environment jsdom
 */
import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { WalletAddress } from '../wallet-address'

// Mock toast so it doesn't throw in jsdom
jest.mock('@/components/ui/use-toast', () => ({
  toast: jest.fn(),
}))

const G_ADDRESS = 'GABC1234WXYZ5678'
const C_ADDRESS = 'CABC1234WXYZ5678'

describe('WalletAddress', () => {
  // ── Truncation ─────────────────────────────────────────────────────────────

  it('truncates a G-address to first 4 + last 4 chars', () => {
    render(<WalletAddress address={G_ADDRESS} showCopy={false} showExplorer={false} />)
    expect(screen.getByText('GABC...5678')).toBeInTheDocument()
  })

  it('truncates a C-address to first 4 + last 4 chars', () => {
    render(<WalletAddress address={C_ADDRESS} showCopy={false} showExplorer={false} />)
    expect(screen.getByText('CABC...5678')).toBeInTheDocument()
  })

  it('exposes full address in aria-label for screen readers', () => {
    render(<WalletAddress address={G_ADDRESS} showCopy={false} showExplorer={false} />)
    expect(screen.getByLabelText(G_ADDRESS)).toBeInTheDocument()
  })

  it('exposes full address in title tooltip', () => {
    render(<WalletAddress address={G_ADDRESS} showCopy={false} showExplorer={false} />)
    const el = screen.getByText('GABC...5678')
    expect(el).toHaveAttribute('title', G_ADDRESS)
  })

  // ── Invalid address ────────────────────────────────────────────────────────

  it('renders a dash for an empty address without throwing', () => {
    render(<WalletAddress address="" />)
    expect(screen.getByText('—')).toBeInTheDocument()
  })

  it('renders a dash for an address that does not start with G or C', () => {
    render(<WalletAddress address="XABC1234WXYZ5678" />)
    expect(screen.getByText('—')).toBeInTheDocument()
  })

  it('renders a dash for a too-short address', () => {
    render(<WalletAddress address="GABC" />)
    expect(screen.getByText('—')).toBeInTheDocument()
  })

  // ── Copy button ────────────────────────────────────────────────────────────

  it('shows copy button when showCopy=true', () => {
    render(<WalletAddress address={G_ADDRESS} showCopy showExplorer={false} />)
    expect(screen.getByRole('button', { name: /copy address/i })).toBeInTheDocument()
  })

  it('hides copy button when showCopy=false', () => {
    render(<WalletAddress address={G_ADDRESS} showCopy={false} showExplorer={false} />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('calls clipboard.writeText with full address on copy click', async () => {
    const writeText = jest.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })

    render(<WalletAddress address={G_ADDRESS} showCopy showExplorer={false} />)
    fireEvent.click(screen.getByRole('button', { name: /copy address/i }))

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(G_ADDRESS))
  })

  it('shows Copied! feedback after successful copy', async () => {
    Object.assign(navigator, { clipboard: { writeText: jest.fn().mockResolvedValue(undefined) } })

    render(<WalletAddress address={G_ADDRESS} showCopy showExplorer={false} />)
    fireEvent.click(screen.getByRole('button', { name: /copy address/i }))

    await waitFor(() => expect(screen.getByText('Copied!')).toBeInTheDocument())
  })

  // ── Explorer link ──────────────────────────────────────────────────────────

  it('shows explorer link when showExplorer=true', () => {
    render(<WalletAddress address={G_ADDRESS} showCopy={false} showExplorer />)
    expect(screen.getByRole('link', { name: /stellar expert/i })).toBeInTheDocument()
  })

  it('hides explorer link when showExplorer=false', () => {
    render(<WalletAddress address={G_ADDRESS} showCopy={false} showExplorer={false} />)
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  it('generates testnet explorer URL for testnet network', () => {
    render(<WalletAddress address={G_ADDRESS} network="testnet" showCopy={false} showExplorer />)
    const link = screen.getByRole('link', { name: /stellar expert/i })
    expect(link).toHaveAttribute(
      'href',
      `https://stellar.expert/explorer/testnet/account/${G_ADDRESS}`,
    )
  })

  it('generates mainnet explorer URL for public network', () => {
    render(<WalletAddress address={G_ADDRESS} network="public" showCopy={false} showExplorer />)
    const link = screen.getByRole('link', { name: /stellar expert/i })
    expect(link).toHaveAttribute(
      'href',
      `https://stellar.expert/explorer/public/account/${G_ADDRESS}`,
    )
  })

  it('generates correct explorer URL for C-address (contract ID)', () => {
    render(<WalletAddress address={C_ADDRESS} network="testnet" showCopy={false} showExplorer />)
    const link = screen.getByRole('link', { name: /stellar expert/i })
    expect(link).toHaveAttribute(
      'href',
      `https://stellar.expert/explorer/testnet/account/${C_ADDRESS}`,
    )
  })
})
