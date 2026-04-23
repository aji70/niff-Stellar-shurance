/**
 * IPFS Provider Chain Service Tests
 *
 * Tests multi-gateway resilience, health checks, and automatic failover.
 */
import { IpfsProviderChainService } from '../services/ipfs-provider-chain.service';
import { IpfsProvider, IpfsUploadResult } from '../interfaces/ipfs-provider.interface';

class MockProvider implements IpfsProvider {
  readonly name: string;
  private healthy: boolean;
  private shouldFailUpload: boolean;

  constructor(name: string, healthy = true, shouldFailUpload = false) {
    this.name = name;
    this.healthy = healthy;
    this.shouldFailUpload = shouldFailUpload;
  }

  async upload(): Promise<IpfsUploadResult> {
    if (this.shouldFailUpload) {
      throw new Error(`Provider ${this.name} upload failed`);
    }
    return {
      cid: `Qm${this.name}`,
      size: 100,
      mimeType: 'image/png',
      originalName: 'test.png',
      pinnedAt: new Date(),
    };
  }

  async isHealthy(): Promise<boolean> {
    return this.healthy;
  }

  setHealthy(healthy: boolean): void {
    this.healthy = healthy;
  }

  setShouldFailUpload(shouldFail: boolean): void {
    this.shouldFailUpload = shouldFail;
  }
}

describe('IpfsProviderChainService', () => {
  let service: IpfsProviderChainService;

  beforeEach(() => {
    service = new IpfsProviderChainService({
      get: () => undefined,
    } as never);
  });

  afterEach(() => {
    service.onModuleDestroy();
  });

  describe('setProviders', () => {
    it('registers providers in priority order', () => {
      const p1 = new MockProvider('p1');
      const p2 = new MockProvider('p2');
      service.setProviders([p1, p2]);
      expect(service.getHealthyProviders()).toHaveLength(2);
    });
  });

  describe('upload', () => {
    it('uses primary provider when healthy', async () => {
      const primary = new MockProvider('primary');
      const fallback = new MockProvider('fallback');
      service.setProviders([primary, fallback]);

      const result = await service.upload(Buffer.from('test'), 'file.txt', 'text/plain');
      expect(result.providerName).toBe('primary');
      expect(result.fallbackCount).toBe(0);
    });

    it('falls back to next provider when primary fails', async () => {
      const primary = new MockProvider('primary', true, true);
      const fallback = new MockProvider('fallback');
      service.setProviders([primary, fallback]);

      const result = await service.upload(Buffer.from('test'), 'file.txt', 'text/plain');
      expect(result.providerName).toBe('fallback');
      expect(result.fallbackCount).toBe(1);
    });

    it('skips unhealthy providers', async () => {
      const primary = new MockProvider('primary');
      primary.setHealthy(false);
      const fallback = new MockProvider('fallback');
      service.setProviders([primary, fallback]);

      // Run health checks to mark primary unhealthy
      await service.runHealthChecks();

      const result = await service.upload(Buffer.from('test'), 'file.txt', 'text/plain');
      expect(result.providerName).toBe('fallback');
      expect(result.fallbackCount).toBe(0);
    });

    it('throws when all providers fail', async () => {
      const p1 = new MockProvider('p1', true, true);
      const p2 = new MockProvider('p2', true, true);
      service.setProviders([p1, p2]);

      await expect(
        service.upload(Buffer.from('test'), 'file.txt', 'text/plain'),
      ).rejects.toThrow('all providers unavailable');
    });

    it('throws when no providers are healthy', async () => {
      const p1 = new MockProvider('p1', false);
      service.setProviders([p1]);
      await service.runHealthChecks();

      await expect(
        service.upload(Buffer.from('test'), 'file.txt', 'text/plain'),
      ).rejects.toThrow('All IPFS providers are currently unavailable');
    });
  });

  describe('health checks', () => {
    it('marks provider unhealthy after consecutive failures', async () => {
      const provider = new MockProvider('fragile', true, true);
      service.setProviders([provider]);

      // First failure
      try { await service.upload(Buffer.from('t'), 'f.txt', 'text/plain'); } catch { /* ignore */ }
      // Second failure
      try { await service.upload(Buffer.from('t'), 'f.txt', 'text/plain'); } catch { /* ignore */ }
      // Third failure — should mark unhealthy
      try { await service.upload(Buffer.from('t'), 'f.txt', 'text/plain'); } catch { /* ignore */ }

      const status = service.getHealthStatus();
      const record = status.find((s) => s.provider === 'fragile');
      expect(record?.healthy).toBe(false);
      expect(record?.consecutiveFailures).toBeGreaterThanOrEqual(3);
    });

    it('runHealthChecks updates health status', async () => {
      const provider = new MockProvider('checkable');
      provider.setHealthy(false);
      service.setProviders([provider]);

      await service.runHealthChecks();
      expect(service.getHealthStatus()[0].healthy).toBe(false);

      provider.setHealthy(true);
      await service.runHealthChecks();
      expect(service.getHealthStatus()[0].healthy).toBe(true);
    });
  });

  describe('exists', () => {
    it('returns exists=true when a healthy provider finds the CID', async () => {
      const provider: IpfsProvider = {
        name: 'finder',
        async upload() { return { cid: 'x', size: 1, mimeType: 'text/plain' }; },
        async exists(cid: string) { return cid === 'known'; },
        async isHealthy() { return true; },
      };
      service.setProviders([provider]);

      const result = await service.exists('known');
      expect(result.exists).toBe(true);
      expect(result.providerName).toBe('finder');
    });

    it('returns exists=false when no provider finds the CID', async () => {
      const provider: IpfsProvider = {
        name: 'finder',
        async upload() { return { cid: 'x', size: 1, mimeType: 'text/plain' }; },
        async exists() { return false; },
        async isHealthy() { return true; },
      };
      service.setProviders([provider]);

      const result = await service.exists('unknown');
      expect(result.exists).toBe(false);
    });
  });

  describe('unpin', () => {
    it('returns success=true when a provider unpins', async () => {
      const provider: IpfsProvider = {
        name: 'unpinner',
        async upload() { return { cid: 'x', size: 1, mimeType: 'text/plain' }; },
        async unpin() { return true; },
        async isHealthy() { return true; },
      };
      service.setProviders([provider]);

      const result = await service.unpin('cid');
      expect(result.success).toBe(true);
    });

    it('returns success=false when no provider supports unpin', async () => {
      const provider: IpfsProvider = {
        name: 'no-unpin',
        async upload() { return { cid: 'x', size: 1, mimeType: 'text/plain' }; },
        async isHealthy() { return true; },
      };
      service.setProviders([provider]);

      const result = await service.unpin('cid');
      expect(result.success).toBe(false);
    });
  });
});

