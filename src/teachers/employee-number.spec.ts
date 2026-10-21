import {
  DEFAULT_SCHOOL_CODE,
  departmentCodeLetters,
  formatEmployeeNumber,
  generateTeacherEmployeeNumber,
  schoolCode,
} from './employee-number';

const tenantId = '11111111-1111-4111-8111-111111111111';
const year = String(new Date().getFullYear()).slice(-2);

describe('schoolCode', () => {
  const original = process.env.TEACHER_ID_SCHOOL_CODE;

  afterEach(() => {
    if (original === undefined) delete process.env.TEACHER_ID_SCHOOL_CODE;
    else process.env.TEACHER_ID_SCHOOL_CODE = original;
  });

  it('defaults to the Comboni Portsudan code', () => {
    delete process.env.TEACHER_ID_SCHOOL_CODE;
    expect(schoolCode()).toBe(DEFAULT_SCHOOL_CODE);
    expect(schoolCode()).toBe('CP');
  });

  it('accepts an override and strips anything but letters', () => {
    process.env.TEACHER_ID_SCHOOL_CODE = 'c.p.s.';
    expect(schoolCode()).toBe('CPS');
  });

  it('falls back to the default when the override has no letters', () => {
    process.env.TEACHER_ID_SCHOOL_CODE = '123';
    expect(schoolCode()).toBe(DEFAULT_SCHOOL_CODE);
  });
});

describe('departmentCodeLetters', () => {
  it('takes the first letter of the first word', () => {
    expect(departmentCodeLetters('Mathematics')).toBe('M');
    expect(departmentCodeLetters('Arabic Language')).toBe('A');
    expect(departmentCodeLetters('Comboni Portsudan Memorial')).toBe('C');
  });

  it('takes the first letter it finds inside the first word', () => {
    expect(departmentCodeLetters('2nd Chance Academy')).toBe('N');
  });

  it('falls back to X when there is no usable name', () => {
    expect(departmentCodeLetters('  ')).toBe('X');
    expect(departmentCodeLetters('123 456')).toBe('X');
    expect(departmentCodeLetters(undefined)).toBe('X');
  });
});

describe('formatEmployeeNumber', () => {
  it('joins year, school code, department letter and a three-digit sequence', () => {
    expect(formatEmployeeNumber(2026, 'CP', 'M', 1)).toBe('26CPM001');
    expect(formatEmployeeNumber(2026, 'CP', 'A', 1)).toBe('26CPA001');
    expect(formatEmployeeNumber(2026, 'CP', 'M', 42)).toBe('26CPM042');
  });

  it('does not cap the sequence at 100', () => {
    expect(formatEmployeeNumber(2026, 'CP', 'M', 101)).toBe('26CPM101');
    expect(formatEmployeeNumber(2026, 'CP', 'M', 1234)).toBe('26CPM1234');
  });
});


describe('generateTeacherEmployeeNumber', () => {
  function teacherRows(employeeNumbers: string[]) {
    return employeeNumbers.map((employeeNumber) => ({ employeeNumber }));
  }

  function txFor(
    departmentName: string | null,
    employeeNumbers: string[],
    options: { honourPrefixFilter?: boolean } = {},
  ) {
    return {
      department: {
        findFirst: jest.fn().mockResolvedValue(departmentName ? { name: departmentName } : null),
      },
      teacher: {
        findMany: options.honourPrefixFilter
          ? jest.fn().mockImplementation(({ where }: { where: { employeeNumber: { startsWith: string } } }) =>
              Promise.resolve(
                teacherRows(employeeNumbers).filter((row) =>
                  row.employeeNumber.startsWith(where.employeeNumber.startsWith),
                ),
              ),
            )
          : jest.fn().mockResolvedValue(teacherRows(employeeNumbers)),
      },
    };
  }

  it('uses the school code, department letter and the next sequence', async () => {
    const tx = txFor('Mathematics', [`${year}CPM001`]);

    await expect(generateTeacherEmployeeNumber(tx, tenantId, 'dept-1')).resolves.toBe(
      `${year}CPM002`,
    );
    expect(tx.teacher.findMany).toHaveBeenCalledWith({
      where: { tenantId, employeeNumber: { startsWith: `${year}CPM` } },
      select: { employeeNumber: true },
    });
  });

  it('numbers sequentially by how many IDs are already issued', async () => {
    const cases: Array<[string[], string]> = [
      [[], '001'],
      [[`${year}CPM001`], '002'],
      [[`${year}CPM001`, `${year}CPM002`], '003'],
      [[`${year}CPM001`, `${year}CPM002`, `${year}CPM003`], '004'],
    ];
    for (const [issued, expected] of cases) {
      await expect(
        generateTeacherEmployeeNumber(txFor('Mathematics', issued), tenantId, 'dept-1'),
      ).resolves.toBe(`${year}CPM${expected}`);
    }
  });

  it('numbers two-word departments by the first word only', async () => {
    const tx = txFor('Arabic Language', []);

    await expect(generateTeacherEmployeeNumber(tx, tenantId, 'dept-1')).resolves.toBe(
      `${year}CPA001`,
    );
    expect(tx.teacher.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId, employeeNumber: { startsWith: `${year}CPA` } },
      }),
    );
  });

  it('shares one sequence between departments with the same initial', async () => {
    await expect(
      generateTeacherEmployeeNumber(txFor('Art', [`${year}CPA001`]), tenantId, 'dept-1'),
    ).resolves.toBe(`${year}CPA002`);
  });

  it('marks a teacher with no department as X and starts at 001', async () => {
    const tx = txFor(null, []);

    await expect(generateTeacherEmployeeNumber(tx, tenantId, null)).resolves.toBe(
      `${year}CPX001`,
    );
    expect(tx.department.findFirst).not.toHaveBeenCalled();
  });

  it('never reissues a number after a teacher is deleted', async () => {
    // 002 is gone, so the count is 2 and a plain "count + 1" would reissue
    // 003 — which is still in use.
    await expect(
      generateTeacherEmployeeNumber(
        txFor('Mathematics', [`${year}CPM001`, `${year}CPM003`]),
        tenantId,
        'dept-1',
      ),
    ).resolves.toBe(`${year}CPM004`);
  });

  it('counts only rows the prefix filter would return', async () => {
    const tx = txFor(
      'Art Language',
      [`${year}CPAXYZ`, `${year}CPMA003`, `${year}CPA001`],
      { honourPrefixFilter: true },
    );

    // CPMA003 belongs to a different department letter, so two rows match the
    // prefix and 003 is the next free number.
    await expect(generateTeacherEmployeeNumber(tx, tenantId, 'dept-1')).resolves.toBe(
      `${year}CPA003`,
    );
  });

  it('carries the sequence past 100 rather than capping it', async () => {
    const issued = Array.from({ length: 100 }, (_v, i) => `${year}CPM${String(i + 1).padStart(3, '0')}`);

    await expect(
      generateTeacherEmployeeNumber(txFor('Mathematics', issued), tenantId, 'dept-1'),
    ).resolves.toBe(`${year}CPM101`);
  });
});
