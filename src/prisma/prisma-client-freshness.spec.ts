import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('prisma client freshness', () => {
  it('generated client matches the schema (run: npm run prisma:generate)', () => {
    const root = join(__dirname, '..', '..');
    const schemaPath = join(root, 'prisma', 'schema.prisma');
    const hashPath = join(root, 'prisma', 'schema.hash');

    const schemaHash = createHash('sha256').update(readFileSync(schemaPath)).digest('hex');
    let recordedHash = '';
    try {
      recordedHash = readFileSync(hashPath, 'utf8').trim();
    } catch {
      recordedHash = '';
    }

    expect(recordedHash).toBe(schemaHash);
  });
});