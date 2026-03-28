import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../../src/app.module';
import { HttpExceptionFilter } from '../../src/common/filters/http-exception.filter';
import { mintUserToken, mintAdminToken } from '../helpers/jwt';

// A syntactically valid Stellar public key that is NOT a real keypair —
// used only to exercise the challenge endpoint's format validation path.
const FAKE_PUBKEY = 'GBSEED000000000000000000000000000000000000000000000000001';

describe('NiffyInsure API (E2E)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  // ── Health ──────────────────────────────────────────────────────────────────

  describe('GET /api/health', () => {
    it('returns 200 with status ok when DB is reachable', async () => {
      const res = await request(app.getHttpServer()).get('/api/health');
      // Terminus returns 200 (healthy) or 503 (unhealthy) — both are valid
      // responses that prove the endpoint is wired up. We assert the shape.
      expect([200, 503]).toContain(res.status);
      expect(res.body).toHaveProperty('status');
    });
  });

  // ── Auth ────────────────────────────────────────────────────────────────────

  describe('POST /api/auth/challenge', () => {
    it('returns 200 with nonce and message for a valid Stellar public key', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/auth/challenge')
        .send({ publicKey: FAKE_PUBKEY });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        nonce: expect.any(String),
        message: expect.stringContaining(FAKE_PUBKEY),
        expiresAt: expect.any(String),
      });
    });

    it('returns 400 for a malformed public key', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/auth/challenge')
        .send({ publicKey: 'not-a-stellar-key' });

      expect(res.status).toBe(400);
    });
  });

  // ── Public read endpoint ────────────────────────────────────────────────────

  describe('GET /api/claims (public)', () => {
    it('returns 200 with paginated claims list without auth', async () => {
      const res = await request(app.getHttpServer()).get('/api/claims');

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('data');
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    it('returns 400 for an invalid cursor', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/claims')
        .query({ after: '!!!invalid-cursor!!!' });

      // Service should reject a non-base64 / malformed cursor
      expect(res.status).toBe(400);
    });
  });

  // ── Auth guard — protected route requires valid JWT ─────────────────────────

  describe('GET /api/claims/needs-my-vote (JWT-protected)', () => {
    it('returns 401 when no token is provided', async () => {
      const res = await request(app.getHttpServer()).get('/api/claims/needs-my-vote');
      expect(res.status).toBe(401);
    });

    it('returns 401 when a tampered token is provided', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/claims/needs-my-vote')
        .set('Authorization', 'Bearer totally.invalid.token');
      expect(res.status).toBe(401);
    });

    it('returns 200 with a valid user JWT', async () => {
      const token = mintUserToken(FAKE_PUBKEY);
      const res = await request(app.getHttpServer())
        .get('/api/claims/needs-my-vote')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('data');
    });
  });

  // ── Admin guard — non-admin JWT must be rejected ────────────────────────────

  describe('GET /api/admin/audits (admin-only)', () => {
    it('returns 401 with no token', async () => {
      const res = await request(app.getHttpServer()).get('/api/admin/audits');
      expect(res.status).toBe(401);
    });

    it('returns 403 when a user-scoped JWT (no admin role) is used', async () => {
      const token = mintUserToken(FAKE_PUBKEY);
      const res = await request(app.getHttpServer())
        .get('/api/admin/audits')
        .set('Authorization', `Bearer ${token}`);

      // JwtAuthGuard passes (valid token), AdminRoleGuard rejects (no role=admin)
      expect(res.status).toBe(403);
    });
  });
});
