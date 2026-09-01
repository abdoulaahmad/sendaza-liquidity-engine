const testDatabaseUrl = process.env.TEST_DATABASE_URL;

if (!testDatabaseUrl) throw new Error('TEST_DATABASE_URL is required for integration tests');

let databaseName: string;
try {
  databaseName = decodeURIComponent(new URL(testDatabaseUrl).pathname.replace(/^\//, ''));
} catch {
  throw new Error('TEST_DATABASE_URL must be a valid PostgreSQL URL');
}

if (!databaseName.toLowerCase().includes('test')) {
  throw new Error('Integration tests refuse a database whose name does not contain test');
}

process.env.DATABASE_URL = testDatabaseUrl;
