import { Test, TestingModule } from '@nestjs/testing';
import { FeatureFlagsService } from './feature-flags.service';
import { PrismaService } from '../prisma/prisma.service';

describe('FeatureFlagsService', () => {
  let service: FeatureFlagsService;
  let mockPrisma: jest.Mocked<PrismaService>;

  beforeEach(async () => {
    const mockPrismaService = {
      featureFlag: {
        findMany: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FeatureFlagsService,
        { provide: PrismaService, useValue: mockPrismaService },
      ],
    }).compile();

    service = module.get<FeatureFlagsService>(FeatureFlagsService);
    mockPrisma = module.get(PrismaService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('onModuleInit', () => {
    it('should load flags from database on init', async () => {
      const mockFlags = [
        { key: 'flag1', enabled: true },
        { key: 'flag2', enabled: false },
      ];
      mockPrisma.featureFlag.findMany.mockResolvedValue(mockFlags);

      await service.onModuleInit();

      expect(mockPrisma.featureFlag.findMany).toHaveBeenCalled();
      expect(service.isEnabled('flag1')).toBe(true);
      expect(service.isEnabled('flag2')).toBe(false);
      expect(service.isEnabled('flag3')).toBe(false);
    });

    it('should handle database errors gracefully', async () => {
      mockPrisma.featureFlag.findMany.mockRejectedValue(new Error('DB error'));

      const loggerSpy = jest.spyOn(service['logger'], 'error').mockImplementation();

      await service.onModuleInit();

      expect(loggerSpy).toHaveBeenCalledWith('Failed to load feature flags from database: Error: DB error');
      expect(service.getFlags()).toEqual({});
    });
  });

  describe('loadFlagsFromDb', () => {
    it('should load and map flags correctly', async () => {
      const mockFlags = [
        { key: 'enabled_flag', enabled: true },
        { key: 'disabled_flag', enabled: false },
      ];
      mockPrisma.featureFlag.findMany.mockResolvedValue(mockFlags);

      await (service as any).loadFlagsFromDb();

      expect(service.isEnabled('enabled_flag')).toBe(true);
      expect(service.isEnabled('disabled_flag')).toBe(false);
      expect(service.isEnabled('unknown_flag')).toBe(false);
    });

    it('should log the number of loaded flags', async () => {
      const mockFlags = [{ key: 'flag1', enabled: true }];
      mockPrisma.featureFlag.findMany.mockResolvedValue(mockFlags);

      const loggerSpy = jest.spyOn(service['logger'], 'log').mockImplementation();

      await (service as any).loadFlagsFromDb();

      expect(loggerSpy).toHaveBeenCalledWith('Loaded 1 feature flags from database');
    });
  });

  describe('isEnabled', () => {
    beforeEach(async () => {
      const mockFlags = [{ key: 'test_flag', enabled: true }];
      mockPrisma.featureFlag.findMany.mockResolvedValue(mockFlags);
      await (service as any).loadFlagsFromDb();
    });

    it('should return true for enabled flags', () => {
      expect(service.isEnabled('test_flag')).toBe(true);
    });

    it('should return false for disabled or unknown flags', () => {
      expect(service.isEnabled('unknown_flag')).toBe(false);
    });
  });

  describe('getDisabledStatusCode', () => {
    it('should return 403 when env var is 403', () => {
      process.env.FEATURE_FLAGS_DISABLED_STATUS = '403';
      const newService = new FeatureFlagsService(mockPrisma);
      expect(newService.getDisabledStatusCode()).toBe(403);
    });

    it('should return 404 by default', () => {
      delete process.env.FEATURE_FLAGS_DISABLED_STATUS;
      const newService = new FeatureFlagsService(mockPrisma);
      expect(newService.getDisabledStatusCode()).toBe(404);
    });
  });

  describe('getFlags', () => {
    it('should return a copy of the feature map', async () => {
      const mockFlags = [{ key: 'flag1', enabled: true }];
      mockPrisma.featureFlag.findMany.mockResolvedValue(mockFlags);
      await (service as any).loadFlagsFromDb();

      const flags = service.getFlags();
      expect(flags).toEqual({ flag1: true });

      // Ensure it's a copy, not the original
      flags.flag1 = false;
      expect(service.isEnabled('flag1')).toBe(true);
    });
  });

  describe('refreshFlags', () => {
    it('should reload flags from database', async () => {
      mockPrisma.featureFlag.findMany.mockResolvedValueOnce([{ key: 'flag1', enabled: true }]);
      await (service as any).loadFlagsFromDb();

      expect(service.isEnabled('flag1')).toBe(true);

      // Update mock to return different flags
      mockPrisma.featureFlag.findMany.mockResolvedValueOnce([{ key: 'flag1', enabled: false }]);
      await service.refreshFlags();

      expect(service.isEnabled('flag1')).toBe(false);
    });
  });
});