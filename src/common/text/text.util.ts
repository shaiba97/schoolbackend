// Person names are stored and displayed in title case: the first letter of
// each word capitalised, the rest left alone so existing capitals and
// internal punctuation (O'Brien, McDonald) survive. Kept in the backend so the
// data is clean at rest, and mirrored by `toTitleCase` in the academic
// frontend for display of rows written before this existed.

export function toTitleCase(value: string): string {
  return value
    .trim()
    .replace(/\s+/g, ' ')
    .split(' ')
    .map((word) => (word ? word.charAt(0).toUpperCase() + word.slice(1) : word))
    .join(' ');
}
