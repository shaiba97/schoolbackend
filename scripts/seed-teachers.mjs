// Seeds teacher records through POST /teachers (user + TEACHER-role
// membership + teacher row + auto employee number, one atomic call each).
// Tops every department up to 5 teachers (3 MALE + 2 FEMALE), counting
// existing teachers toward the target. Idempotent by headcount: re-runs only
// fill remaining seats.
//
// Usage:
//   node scripts/seed-teachers.mjs
//   SEED_API_URL=http://localhost:3000/api SEED_TENANT_ID=<uuid> node scripts/seed-teachers.mjs

const API_URL = process.env.SEED_API_URL || 'http://localhost:3000/api';
const TENANT_ID = process.env.SEED_TENANT_ID || '11111111-1111-4111-8111-111111111111';
const PASSWORD = 'Comboni@123';
const TARGET_PER_DEPT = 5;
const TARGET_MALE = 3;
const TARGET_FEMALE = 2;

const MALE_FIRST = ['Ahmed', 'Mohamed', 'Ali', 'Hassan', 'Khalid', 'Omar', 'Yusuf', 'Ibrahim', 'Mustafa', 'Tariq', 'Kamal', 'Adil', 'Hisham', 'Mamoun', 'Siddig', 'Faisal', 'Khalil', 'Mahmoud', 'Osman', 'Idris', 'Nadir', 'Sami', 'Rami', 'Waleed', 'Amjad', 'Mazin', 'Haytham', 'Moataz', 'Badr', 'Talha', 'Musab', 'Anas', 'Ayman', 'Omer', 'Shams', 'Mutaz'];
const FEMALE_FIRST = ['Aisha', 'Fatima', 'Sara', 'Maryam', 'Huda', 'Rania', 'Abeer', 'Iman', 'Salma', 'Noura', 'Hiba', 'Reem', 'Dina', 'Ola', 'Maha', 'Walaa', 'Esraa', 'Hanan', 'Mona', 'Sabah', 'Ikram', 'Najla', 'Samah', 'Amna', 'Rayan', 'Wiam'];
const LAST = ['Abdelgadir', 'Eltayeb', 'Hamza', 'Mahjoub', 'Khalifa', 'Saeed', 'Abdallah', 'Farah', 'Babiker', 'Eltahir', 'Aldow', 'Koko', 'Jaber', 'Elmahi', 'Saleh', 'Abbas', 'Yousif', 'Hamad', 'Eltigani', 'Nour', 'Sharif', 'Hamadou', 'Kabbashi', 'Dafaalla', 'Elbadawi', 'Gamar', 'Hajna', 'Ishaq', 'Karrar', 'Lual', 'Mading', 'Nyan', 'Ochieng', 'Pit', 'Riak', 'Suliman', 'Taban', 'Wani', 'Yak', 'Zaki'];

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
const depts = departments.data || departments;
const teachers = await api('/teachers?page=1&limit=100');
const existing = teachers.data || [];

const usedPhones = new Set(existing.map((t) => t.user?.phone).filter(Boolean));
let phoneSeq = 1;
function nextPhone() {
  // +249 followed by 9 digits starting with 9 (regex ^(?:\+249|0)?9\d{8}$).
  let phone;
  do {
    phone = `+2499${String(phoneSeq).padStart(8, '0')}`;
    phoneSeq += 1;
  } while (usedPhones.has(phone));
  usedPhones.add(phone);
  return phone;
}

let maleIdx = 0;
let femaleIdx = 0;
let lastIdx = 0;
let dobIdx = 0;
function nextDob() {
  const year = 1985 + (dobIdx % 14);
  const month = String(((dobIdx * 3) % 12) + 1).padStart(2, '0');
  const day = String(((dobIdx * 7) % 28) + 1).padStart(2, '0');
  dobIdx += 1;
  return `${year}-${month}-${day}`;
}

function nextName(gender) {
  const first = gender === 'MALE' ? MALE_FIRST[maleIdx++ % MALE_FIRST.length] : FEMALE_FIRST[femaleIdx++ % FEMALE_FIRST.length];
  const last = LAST[lastIdx++ % LAST.length];
  return { firstName: first, lastName: last };
}

let created = 0;
const failures = [];
const roster = [];

for (const dept of depts) {
  const inDept = existing.filter((t) => t.departmentId === dept.id || t.department?.id === dept.id);
  const males = inDept.filter((t) => t.gender === 'MALE').length;
  const females = inDept.filter((t) => t.gender === 'FEMALE').length;
  const needMale = Math.max(0, TARGET_MALE - males);
  const needFemale = Math.max(0, TARGET_FEMALE - females);
  const plan = [...Array(needMale).fill('MALE'), ...Array(needFemale).fill('FEMALE')];

  for (const gender of plan) {
    const { firstName, lastName } = nextName(gender);
    const phone = nextPhone();
    const payload = {
      firstName,
      lastName,
      phone,
      password: PASSWORD,
      gender,
      dateOfBirth: nextDob(),
      departmentId: dept.id,
      specialization: dept.name,
    };
    try {
      const row = await api('/teachers', { method: 'POST', body: JSON.stringify(payload) });
      created += 1;
      roster.push({ name: `${firstName} ${lastName}`, phone, employeeNumber: row.employeeNumber, department: dept.name, gender });
      console.log(`created: ${firstName} ${lastName} | ${phone} | ${row.employeeNumber} | ${dept.name}`);
    } catch (cause) {
      failures.push(`${firstName} ${lastName} (${dept.name}): ${cause.message}`);
      console.error(`FAILED: ${firstName} ${lastName} (${dept.name}): ${cause.message}`);
    }
  }
}

console.log(`done: created=${created} failures=${failures.length}`);
if (failures.length > 0) {
  console.error(failures.join('\n'));
  process.exitCode = 1;
}
