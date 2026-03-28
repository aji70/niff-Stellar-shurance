import * as jwt from 'jsonwebtoken';

const SECRET = process.env.JWT_SECRET ?? 'e2e-test-secret-at-least-32-chars!!';

/** Mint a short-lived user-scoped JWT for E2E tests. */
export function mintUserToken(walletAddress: string): string {
  const now = Math.floor(Date.now() / 1000);
  return jwt.sign(
    { sub: walletAddress, walletAddress, scope: 'user', iat: now, exp: now + 300 },
    SECRET,
  );
}

/** Mint a short-lived admin-scoped JWT for E2E tests. */
export function mintAdminToken(walletAddress: string): string {
  const now = Math.floor(Date.now() / 1000);
  return jwt.sign(
    { sub: walletAddress, walletAddress, scope: 'admin', role: 'admin', iat: now, exp: now + 300 },
    SECRET,
  );
}
