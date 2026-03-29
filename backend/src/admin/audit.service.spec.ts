import { Test } from '@nestjs/testing';
import { AuditService } from './audit.service';
import { PrismaService } from '../prisma/prisma.service';

const FIXTURES = [
  { id: 'a1', actor: 'GABC', action: 'reindex',      ipAddress: '1.1.1.1', createdAt: new Date('2024-01-01T10:00:00Z'), payload: {} },
  { id: 'a2', actor: 'GABC', action: 'pause',         ipAddress: '1.1.1.1', createdAt: new Date('2024-01-02T10:00:00Z'), payload: {} },
  { id: 'a3', actor: 'GXYZ', action: 'reindex',      ipAddress: '2.2.2.2', createdAt: new Date('2024-01-03T10:00:00Z'), payload: {} },
  { id: 'a4', actor: 'GXYZ', action: 'feature_flag_update', ipAddress: '2.2.2.2', createdAt: new Date('2024-01-04T10:00:00Z'), payload: {} },
  { id: 'a5', actor: 'GABC', action: 'reindex',      ipAddress: '1.1.1.1', createdAt: new Date('2024-01-05T10:00:00Z'), payload: {} },
];

function buildPrismaMock() {
  return {
    adminAuditLog: {
      create: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
  };
}

describe('AuditService', () => {
  let service: AuditService;
  let prisma: ReturnType<typeof buildPrismaMock>;

  beforeEach(async () => {
    prisma = buildPrismaMock();
    const module = await Test.createTestingModule({
      providers: [
        AuditService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = module.get(AuditService);
  });

  // ── write ──────────────────────────────────────────────────────────────────

  it('write creates a row', async () => {
    prisma.adminAuditLog.create.mockResolvedValue({});
    await service.write({ actor: 'GABC', action: 'test', payload: {} });
    expect(prisma.adminAuditLog.create).toHaveBeenCalledWith({
      data: { actor: 'GABC', action: 'test', payload: {} },
    });
  });

  // ── findAll filters ────────────────────────────────────────────────────────

  it('returns all rows when no filters', async () => {
    prisma.adminAuditLog.findMany.mockResolvedValue(FIXTURES.slice(0, 20));
    const result = await service.findAll({ limit: 20 });
    expect(prisma.adminAuditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: {} }),
    );
    expect(result.items).toHaveLength(FIXTURES.slice(0, 20).length);
  });

  it('filters by action', async () => {
    const filtered = FIXTURES.filter((f) => f.action === 'reindex');
    prisma.adminAuditLog.findMany.mockResolvedValue(filtered);
    const result = await service.findAll({ action: 'reindex' });
    expect(prisma.adminAuditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { action: 'reindex' } }),
    );
    expect(result.items).toEqual(filtered);
  });

  it('filters by actor', async () => {
    const filtered = FIXTURES.filter((f) => f.actor === 'GABC');
    prisma.adminAuditLog.findMany.mockResolvedValue(filtered);
    const result = await service.findAll({ actor: 'GABC' });
    expect(prisma.adminAuditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { actor: 'GABC' } }),
    );
    expect(result.items).toEqual(filtered);
  });

  it('filters by date range', async () => {
    const filtered = FIXTURES.filter(
      (f) => f.createdAt >= new Date('2024-01-02T00:00:00Z') && f.createdAt <= new Date('2024-01-04T23:59:59Z'),
    );
    prisma.adminAuditLog.findMany.mockResolvedValue(filtered);
    const result = await service.findAll({ from: '2024-01-02T00:00:00Z', to: '2024-01-04T23:59:59Z' });
    expect(prisma.adminAuditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          createdAt: {
            gte: new Date('2024-01-02T00:00:00Z'),
            lte: new Date('2024-01-04T23:59:59Z'),
          },
        },
      }),
    );
    expect(result.items).toEqual(filtered);
  });

  it('combines action + actor filters', async () => {
    const filtered = FIXTURES.filter((f) => f.action === 'reindex' && f.actor === 'GABC');
    prisma.adminAuditLog.findMany.mockResolvedValue(filtered);
    const result = await service.findAll({ action: 'reindex', actor: 'GABC' });
    expect(prisma.adminAuditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { action: 'reindex', actor: 'GABC' } }),
    );
    expect(result.items).toEqual(filtered);
  });

  // ── cursor pagination ──────────────────────────────────────────────────────

  it('returns hasMore=false when results fit in one page', async () => {
    prisma.adminAuditLog.findMany.mockResolvedValue(FIXTURES.slice(0, 3));
    const result = await service.findAll({ limit: 5 });
    expect(result.hasMore).toBe(false);
    expect(result.nextCursor).toBeNull();
  });

  it('returns hasMore=true and nextCursor when more rows exist', async () => {
    // take=2+1=3 rows returned, meaning there are more
    const page = [...FIXTURES.slice(0, 2), FIXTURES[2]];
    prisma.adminAuditLog.findMany.mockResolvedValue(page);
    const result = await service.findAll({ limit: 2 });
    expect(result.hasMore).toBe(true);
    expect(result.nextCursor).toBe(FIXTURES[1].id);
    expect(result.items).toHaveLength(2);
  });

  it('passes cursor to prisma when provided', async () => {
    prisma.adminAuditLog.findMany.mockResolvedValue([]);
    await service.findAll({ cursor: 'a2', limit: 2 });
    expect(prisma.adminAuditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ cursor: { id: 'a2' }, skip: 1 }),
    );
  });

  // ── streamCsv ──────────────────────────────────────────────────────────────

  it('streams CSV rows and ends response', async () => {
    prisma.adminAuditLog.findMany
      .mockResolvedValueOnce([
        { id: 'a1', actor: 'GABC', action: 'reindex', ipAddress: '1.1.1.1', createdAt: new Date('2024-01-01T10:00:00Z') },
      ])
      .mockResolvedValueOnce([]); // second batch empty → done

    const chunks: string[] = [];
    const res = {
      setHeader: jest.fn(),
      write: jest.fn((chunk: string) => chunks.push(chunk)),
      end: jest.fn(),
    } as unknown as import('express').Response;

    await service.streamCsv({}, res);

    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/csv');
    expect(chunks[0]).toBe('id,actor,action,ipAddress,createdAt\n');
    expect(chunks[1]).toContain('a1,GABC,reindex');
    expect(res.end).toHaveBeenCalled();
  });

  it('CSV export matches JSON results for same filters', async () => {
    const rows = [
      { id: 'a3', actor: 'GXYZ', action: 'reindex', ipAddress: '2.2.2.2', createdAt: new Date('2024-01-03T10:00:00Z') },
    ];
    // findAll returns same row
    prisma.adminAuditLog.findMany
      .mockResolvedValueOnce([...rows, rows[0]]) // +1 for hasMore check in findAll
      .mockResolvedValueOnce(rows)               // first batch in streamCsv
      .mockResolvedValueOnce([]);                // second batch empty

    const jsonResult = await service.findAll({ action: 'reindex', actor: 'GXYZ', limit: 1 });

    const chunks: string[] = [];
    const res = {
      setHeader: jest.fn(),
      write: jest.fn((c: string) => chunks.push(c)),
      end: jest.fn(),
    } as unknown as import('express').Response;
    await service.streamCsv({ action: 'reindex', actor: 'GXYZ' }, res);

    const csvLines = chunks.join('').split('\n').filter(Boolean).slice(1); // skip header
    expect(csvLines).toHaveLength(jsonResult.items.length);
    expect(csvLines[0]).toContain(jsonResult.items[0].id);
  });
});
