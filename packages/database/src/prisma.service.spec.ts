import { PrismaService } from './prisma.service';

describe('PrismaService configuration', () => {
  const originalDatabaseUrl = process.env.DATABASE_URL;

  afterEach(() => {
    if (originalDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = originalDatabaseUrl;
    }
  });

  it('fails closed when DATABASE_URL is absent', () => {
    delete process.env.DATABASE_URL;
    expect(() => new PrismaService()).toThrow('DATABASE_URL is required');
  });
});
