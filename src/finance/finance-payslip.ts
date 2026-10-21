import PDFDocument from 'pdfkit';

export type PayslipLine = {
  label: string;
  valueType: 'PERCENTAGE' | 'FIXED_AMOUNT';
  value: number;
  amount: number;
};

export type PayslipData = {
  tenantName: string;
  staffName: string;
  staffNumber: string;
  positionTitle: string;
  payslipNo: string;
  periodStart: Date;
  periodEnd: Date;
  grossAmount: number;
  totalDeductions: number;
  netAmount: number;
  currency: string;
  deductions: PayslipLine[];
};

const MARGIN = 48;

const fmtDate = (d: Date) =>
  d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

/** Renders a one-page payslip. Deliberately plain: no assets, no embedded fonts. */
export function renderPayslip(data: PayslipData): Promise<Buffer> {
  const doc = new PDFDocument({ margin: MARGIN, size: 'A4' });
  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  const money = (n: number) => `${data.currency} ${n.toFixed(2)}`;

  doc.fontSize(18).text(data.tenantName || 'Payslip');
  doc.fontSize(11).fillColor('#555555').text('Salary Payslip');
  doc.moveDown();
  doc.fillColor('#000000').fontSize(11);
  doc.text(`Payslip no: ${data.payslipNo}`);
  doc.text(`Staff: ${data.staffName}${data.staffNumber ? ` (${data.staffNumber})` : ''}`);
  doc.text(`Position: ${data.positionTitle}`);
  doc.text(`Period: ${fmtDate(data.periodStart)} - ${fmtDate(data.periodEnd)}`);
  doc.moveDown();

  const colLabel = MARGIN;
  const colDetail = 300;
  const colAmount = 440;

  const rule = (at: number) =>
    doc.strokeColor('#cccccc').lineWidth(1).moveTo(MARGIN, at).lineTo(595 - MARGIN, at).stroke();

  let y = doc.y;
  doc.fontSize(11).fillColor('#555555');
  doc.text('Item', colLabel, y);
  doc.text('Basis', colDetail, y, { width: 120, align: 'right' });
  doc.text('Amount', colAmount, y, { width: 100, align: 'right' });
  y += 18;
  rule(y - 4);

  doc.fillColor('#000000').fontSize(11);
  doc.text('Gross salary', colLabel, y, { width: 240 });
  doc.text('-', colDetail, y, { width: 120, align: 'right' });
  doc.text(money(data.grossAmount), colAmount, y, { width: 100, align: 'right' });
  y += 18;

  for (const line of data.deductions) {
    const basis = line.valueType === 'PERCENTAGE' ? `${line.value}%` : money(line.value);
    doc.text(line.label, colLabel, y, { width: 240 });
    doc.text(basis, colDetail, y, { width: 120, align: 'right' });
    doc.text(`-${money(line.amount)}`, colAmount, y, { width: 100, align: 'right' });
    y += 18;
  }

  rule(y - 4);
  y += 6;
  doc.fontSize(12);
  doc.text('Total deductions', colLabel, y, { width: 240 });
  doc.text(`-${money(data.totalDeductions)}`, colAmount, y, { width: 100, align: 'right' });
  y += 22;
  doc.fontSize(13);
  doc.text('Net pay', colLabel, y, { width: 240 });
  doc.text(money(data.netAmount), colAmount, y, { width: 100, align: 'right' });

  doc.moveDown(3);
  doc.fontSize(9).fillColor('#777777');
  doc.text(`Generated ${new Date().toLocaleString('en-GB')} · System-generated payslip.`);
  doc.end();
  return done;
}
