// Seeds the 16 school class records through the real POST /classes API
// (same validation path as the Academic frontend form). Idempotent: existing
// class names in the tenant are skipped, so re-runs create zero records.
//
// Usage:
//   node scripts/seed-school-classes.mjs
//   SEED_API_URL=http://localhost:3000/api SEED_TENANT_ID=<uuid> node scripts/seed-school-classes.mjs
//
// Requires the backend running with a tenant that accepts the caller
// (dev: AUTH_NO_SESSION=true + X-Tenant-Id header).

const API_URL = process.env.SEED_API_URL || 'http://localhost:3000/api';
const TENANT_ID = process.env.SEED_TENANT_ID || '11111111-1111-4111-8111-111111111111';

const RECORDS = [
  { educationLevel: 'INTERMEDIATE', grade: 'SIXTH', gender: 'BOYS', className: '6th Boys', capacity: 15 },
  { educationLevel: 'INTERMEDIATE', grade: 'SEVENTH', gender: 'BOYS', className: '7th Boys', capacity: 15 },
  { educationLevel: 'INTERMEDIATE', grade: 'EIGHTH', gender: 'BOYS', className: '8th Boys', capacity: 15 },
  { educationLevel: 'INTERMEDIATE', grade: 'NINTH', gender: 'BOYS', className: '9th Boys', capacity: 15 },
  { educationLevel: 'SECONDARY', grade: 'FIRST', gender: 'BOYS', className: '1st Boys A', capacity: 15 },
  { educationLevel: 'SECONDARY', grade: 'FIRST', gender: 'BOYS', className: '1st Boys B', capacity: 15 },
  { educationLevel: 'SECONDARY', grade: 'FIRST', gender: 'GIRLS', className: '1st Girls A', capacity: 15 },
  { educationLevel: 'SECONDARY', grade: 'FIRST', gender: 'GIRLS', className: '1st Girls B', capacity: 15 },
  { educationLevel: 'SECONDARY', grade: 'SECOND', gender: 'BOYS', track: 'ART', className: '2nd Boys Art', capacity: 15 },
  { educationLevel: 'SECONDARY', grade: 'SECOND', gender: 'BOYS', track: 'SCIENCE', className: '2nd Boys Science', capacity: 15 },
  { educationLevel: 'SECONDARY', grade: 'SECOND', gender: 'GIRLS', track: 'ART', className: '2nd Girls Art', capacity: 15 },
  { educationLevel: 'SECONDARY', grade: 'SECOND', gender: 'GIRLS', track: 'SCIENCE', className: '2nd Girls Science', capacity: 15 },
  { educationLevel: 'SECONDARY', grade: 'THIRD', gender: 'BOYS', track: 'ART', className: '3rd Boys Art', capacity: 15 },
  { educationLevel: 'SECONDARY', grade: 'THIRD', gender: 'BOYS', track: 'SCIENCE', className: '3rd Boys Science', capacity: 15 },
  { educationLevel: 'SECONDARY', grade: 'THIRD', gender: 'GIRLS', track: 'ART', className: '3rd Girls Art', capacity: 15 },
  { educationLevel: 'SECONDARY', grade: 'THIRD', gender: 'GIRLS', track: 'SCIENCE', className: '3rd Girls Science', capacity: 15 },
];

async function api(path, init = {}) {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', 'X-Tenant-Id': TENANT_ID, ...(init.headers || {}) },
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : undefined;
  if (!response.ok) {
    const message = body && typeof body === 'object' && 'message' in body ? body.message : `HTTP ${response.status}`;
    throw new Error(`${init.method || 'GET'} ${path} -> ${response.status}: ${JSON.stringify(message)}`);
  }
  return body;
}

const existing = await api('/classes?page=1&limit=100');
const existingNames = new Set(existing.data.map((c) => c.className));

let created = 0;
let skipped = 0;
for (const record of RECORDS) {
  if (existingNames.has(record.className)) {
    skipped += 1;
    continue;
  }
  const payload = { ...record };
  if (!payload.track) delete payload.track;
  await api('/classes', { method: 'POST', body: JSON.stringify(payload) });
  created += 1;
  console.log(`created: ${record.className}`);
}

console.log(`done: created=${created} skipped=${skipped} (tenant=${TENANT_ID})`);
if (created + skipped !== RECORDS.length) {
  console.error('MISMATCH: not all records accounted for');
  process.exitCode = 1;
}
