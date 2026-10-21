/**
 * Attendance edit-window rules shared by the teacher self-service endpoints
 * and the teacher-scoped guards on the admin attendance endpoints.
 *
 * A teacher may write attendance for the session day itself only
 * (a 1-day window). Future dates are always refused.
 * Staff admins bypass the window on the unscoped admin endpoints.
 */
export const ATTENDANCE_EDIT_WINDOW_DAYS = 1;

/** Local-calendar date key (YYYY-MM-DD). */
export function localDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** `@db.Date` columns read back as UTC midnight; normalize to the YYYY-MM-DD key. */
export function storedDateKey(value: Date | string): string {
  return typeof value === 'string' ? value.slice(0, 10) : value.toISOString().slice(0, 10);
}

/** Editable only while the session date is today. */
export function canEditAttendance(dateKey: string, todayKey: string): boolean {
  return dateKey === todayKey;
}
