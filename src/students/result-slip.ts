import PDFDocument from 'pdfkit';

export type ResultSlipRow = {
  subject: string;
  marks: number | null;
  max: number;
  grade: string;
};

export type ResultSlipData = {
  examName: string;
  examType: string;
  examDate: Date | null;
  studentName: string;
  roleNumber: string;
  className: string;
  rows: ResultSlipRow[];
  average: number | null;
};

const MARGIN = 48;
const LINE = 18;
const PAGE_BOTTOM = 760;

/** Renders a one-page result slip. Kept deliberately plain: no assets, no fonts to embed. */
export function renderResultSlip(data: ResultSlipData): Promise<Buffer> {
  const doc = new PDFDocument({ margin: MARGIN, size: 'A4' });
  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  const date = data.examDate
    ? data.examDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
    : '—';

  doc.fontSize(18).text(data.examName);
  doc.fontSize(11).fillColor('#555555').text(`${data.examType} · ${date}`);
  doc.moveDown();
  doc.fillColor('#000000').fontSize(11);
  doc.text(`Student: ${data.studentName}`);
  doc.text(`Admission no: ${data.roleNumber} · Class: ${data.className}`);
  doc.moveDown();

  const colSubject = MARGIN;
  const colScore = 380;
  const colGrade = 470;
  let y = doc.y;

  const rule = (at: number) => {
    doc.strokeColor('#cccccc').lineWidth(1).moveTo(MARGIN, at).lineTo(595 - MARGIN, at).stroke();
  };

  doc.fontSize(11).fillColor('#555555');
  doc.text('Subject', colSubject, y);
  doc.text('Score', colScore, y, { width: 80, align: 'right' });
  doc.text('Grade', colGrade, y, { width: 60, align: 'right' });
  y += LINE;
  rule(y - 4);

  doc.fillColor('#000000');
  for (const row of data.rows) {
    if (y > PAGE_BOTTOM) {
      doc.addPage();
      y = MARGIN;
    }
    const score = row.marks === null ? '—' : `${row.marks}/${row.max}`;
    doc.fontSize(11);
    doc.text(row.subject, colSubject, y, { width: 300 });
    doc.text(score, colScore, y, { width: 80, align: 'right' });
    doc.text(row.grade, colGrade, y, { width: 60, align: 'right' });
    y += LINE;
  }
  rule(y - 4);
  y += 6;

  doc.fontSize(12);
  doc.text(`Average: ${data.average === null ? '—' : `${data.average}%`}`, colSubject, y);
  doc.moveDown(2);
  doc.fontSize(9).fillColor('#777777');
  doc.text(`Generated ${new Date().toLocaleString('en-GB')} · For the student named above only.`);

  doc.end();
  return done;
}
