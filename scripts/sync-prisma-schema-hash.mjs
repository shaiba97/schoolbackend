import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const schemaPath = join(root, 'prisma', 'schema.prisma');
const hashPath = join(root, 'prisma', 'schema.hash');

const hash = createHash('sha256').update(await readFile(schemaPath)).digest('hex');
await writeFile(hashPath, hash + '\n');
console.log(`Wrote ${hashPath}`);
console.log(hash);