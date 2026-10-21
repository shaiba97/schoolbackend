// Seeds the 13 school subject records through POST /subjects/batch
// (single-transaction bulk create: department validation + duplicate-name
// rejection happen server-side). Skips names already present, so re-runs
// create zero records.
//
// Usage:
//   node scripts/seed-subjects.mjs
//   SEED_API_URL=http://localhost:3000/api SEED_TENANT_ID=<uuid> node scripts/seed-subjects.mjs

const API_URL = process.env.SEED_API_URL || 'http://localhost:3000/api';
const TENANT_ID = process.env.SEED_TENANT_ID || '11111111-1111-4111-8111-111111111111';

// Subject name -> department name (resolved to IDs at runtime).
const RECORDS = [
  ["The Holy Qur'an and its Sciences", 'religion education'],
  ['Islamic Studies / Islamic Education', 'religion education'],
  ['Arabic Language', 'Arabic Language'],
  ['English Language', 'English Language'],
  ['Mathematics', 'mathematics'],
  ['Physics', 'physics'],
  ['Chemistry', 'chemistry'],
  ['Biology', 'biology'],
  ['History', 'history'],
  ['Geography', 'geograpghy'], // pre-existing dept typo, kept as-is (out of scope)
  ['Computer Science', 'computer science'],
  ['Fundamentals of Engineering Sciences', 'engineering'],
  ['Military Sciences', 'Military Sciences'],
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

const departments = await api('/departments');
const deptByLower = new Map((departments.data || departments).map((d) => [d.name.toLowerCase(), d]));
for (const [, deptName] of RECORDS) {
  if (!deptByLower.has(deptName.toLowerCase())) {
    throw new Error(`Department not found: ${deptName}`);
  }
}

const subjects = await api('/subjects?page=1&limit=100');
const existingNames = new Set(subjects.data.map((s) => s.name));

const items = [];
for (const [name, deptName] of RECORDS) {
  if (existingNames.has(name)) {
    console.log(`skipped (exists): ${name}`);
    continue;
  }
  items.push({ name, departmentId: deptByLower.get(deptName.toLowerCase()).id });
}

if (items.length === 0) {
  console.log(`done: created=0 skipped=${RECORDS.length} (tenant=${TENANT_ID})`);
} else {
  const created = await api('/subjects/batch', { method: 'POST', body: JSON.stringify({ items }) });
  const rows = created.created || created.data || created;
  for (const row of rows) console.log(`created: ${row.name}`);
  console.log(`done: created=${rows.length} skipped=${RECORDS.length - rows.length} (tenant=${TENANT_ID})`);
}
