const H = { 'Content-Type': 'application/json', 'X-Tenant-Id': '11111111-1111-4111-8111-111111111111' };
const r = await fetch('http://localhost:3000/api/teachers', {
  method: 'POST',
  headers: H,
  body: JSON.stringify({
    firstName: 'Probe',
    lastName: 'Teacher',
    phone: '+24990000001',
    password: 'Comboni@123',
    gender: 'MALE',
    dateOfBirth: '1990-05-05',
    departmentId: '11b89e21-d736-409d-aeb1-bd7971c2c10f',
  }),
});
const t = await r.text();
console.log(r.status + ' ' + t.slice(0, 200));
if (r.status === 201) {
  const j = JSON.parse(t);
  const d = await fetch('http://localhost:3000/api/teachers/' + j.id, { method: 'DELETE', headers: { 'X-Tenant-Id': '11111111-1111-4111-8111-111111111111' } });
  console.log('cleanup -> ' + d.status);
}
