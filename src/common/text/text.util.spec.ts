import { toTitleCase } from './text.util';

describe('toTitleCase', () => {
  it('capitalises the first letter of every word', () => {
    expect(toTitleCase('mazin')).toBe('Mazin');
    expect(toTitleCase('salah alamin')).toBe('Salah Alamin');
    expect(toTitleCase('mohammed abdallah ali')).toBe('Mohammed Abdallah Ali');
  });

  it('leaves the rest of the word untouched', () => {
    expect(toTitleCase('mcDonald')).toBe('McDonald');
    expect(toTitleCase("o'brien")).toBe("O'brien");
    expect(toTitleCase('van der BERG')).toBe('Van Der BERG');
  });

  it('is idempotent, so re-saving a record cannot change it again', () => {
    const once = toTitleCase('salah alamin');
    expect(toTitleCase(once)).toBe(once);
  });

  it('handles messy whitespace and empty input', () => {
    expect(toTitleCase('  salah   alamin  ')).toBe('Salah Alamin');
    expect(toTitleCase('')).toBe('');
    expect(toTitleCase('   ')).toBe('');
  });

  it('does not lowercase an already-capitalised name', () => {
    expect(toTitleCase('MAZIN CBAG')).toBe('MAZIN CBAG');
  });
});
