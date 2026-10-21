import { formatGuardianNumber, generateGuardianNumber } from './guardian-number';

function mockTx(numbers: (string | null)[]) {
  return {
    guardian: {
      findMany: jest.fn().mockResolvedValue(numbers.map((guardianNumber) => ({ guardianNumber }))),
    },
  };
}

describe('generateGuardianNumber', () => {
  it('formats the first guardian of the year as 26CPG0001', () => {
    expect(formatGuardianNumber(2026, 1)).toBe('26CPG0001');
    expect(formatGuardianNumber(2026, 9999)).toBe('26CPG9999');
  });

  it('issues 0001 when the tenant has no guardians this year', async () => {
    const result = await generateGuardianNumber(mockTx([]) as any, 'tenant-1', 2026);

    expect(result).toBe('26CPG0001');
  });

  it('walks forward past taken numbers (deletion-safe)', async () => {
    const result = await generateGuardianNumber(
      mockTx(['26CPG0001', '26CPG0003']) as any,
      'tenant-1',
      2026,
    );

    expect(result).toBe('26CPG0002');
  });

  it('ignores other years and non-numeric legacy rows', async () => {
    const result = await generateGuardianNumber(
      mockTx(['25CPG0042', 'legacy-1', null]) as any,
      'tenant-1',
      2026,
    );

    expect(result).toBe('26CPG0001');
  });

  it('refuses when the yearly sequence is exhausted at 9999', async () => {
    const taken = Array.from({ length: 9999 }, (_, i) => `26CPG${String(i + 1).padStart(4, '0')}`);

    await expect(generateGuardianNumber(mockTx(taken) as any, 'tenant-1', 2026)).rejects.toThrow(
      'Guardian numbers for 2026 are exhausted',
    );
  });
});
