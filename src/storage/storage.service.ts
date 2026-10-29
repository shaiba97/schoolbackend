import { randomUUID } from 'node:crypto';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import { dirname, isAbsolute, join, posix, relative, resolve } from 'node:path';

export type StorageMetadata = {
  tenantId: string;
  draftId: string;
  documentType: string;
  studentId?: string;
  teacherId?: string;
  examId?: string;
};

export type StoredObject = {
  objectKey: string;
  originalName: string;
  contentType: string;
  size: number;
};

export abstract class StorageService {
  abstract saveStagedFile(
    file: Express.Multer.File,
    metadata: StorageMetadata,
  ): Promise<StoredObject>;
  abstract moveToStudent(
    objectKey: string,
    metadata: StorageMetadata & { studentId: string },
  ): Promise<StoredObject>;
  abstract moveToTeacher(
    objectKey: string,
    metadata: StorageMetadata & { teacherId: string },
  ): Promise<StoredObject>;
  abstract moveToExam(
    objectKey: string,
    metadata: StorageMetadata & { examId: string },
  ): Promise<StoredObject>;
  abstract deleteObject(objectKey: string): Promise<void>;
  abstract getObjectPath(objectKey: string): string;
  abstract getObjectMetadata(
    objectKey: string,
  ): Promise<{ size: number; contentType: string }>;
}

export function isStorageKey(value: string): boolean {
  return (
    Boolean(value) &&
    !isAbsolute(value) &&
    !posix.isAbsolute(value) &&
    !value.includes('..') &&
    !value.includes('\\') &&
    posix.normalize(value) === value
  );
}

/**
 * A human basename can already carry UUID prefixes left over from an earlier
 * staging row (each staging save leans on one). Strip all of them before
 * adding the fresh per-area prefix, so stored keys never double-stack UUIDs.
 */
export function stripKeyUuidPrefixes(name: string): string {
  return name.replace(/^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-)+/i, '');
}

export function buildStagedKey(
  metadata: StorageMetadata,
  fileName: string,
): string {
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
  return `staging/${metadata.tenantId}/${metadata.draftId}/${metadata.documentType}/${randomUUID()}-${safeName}`;
}

export function buildStudentKey(
  metadata: StorageMetadata & { studentId: string },
  fileName: string,
): string {
  const safeName = stripKeyUuidPrefixes(fileName).replace(/[^a-zA-Z0-9._-]/g, '_');
  return `students/${metadata.tenantId}/${metadata.studentId}/${metadata.documentType}/${randomUUID()}-${safeName}`;
}

export function buildTeacherKey(
  metadata: StorageMetadata & { teacherId: string },
  fileName: string,
): string {
  const safeName = stripKeyUuidPrefixes(fileName).replace(/[^a-zA-Z0-9._-]/g, '_');
  return `teachers/${metadata.tenantId}/${metadata.teacherId}/${metadata.documentType}/${randomUUID()}-${safeName}`;
}

export function buildExamKey(
  metadata: StorageMetadata & { examId: string },
  fileName: string,
): string {
  const safeName = stripKeyUuidPrefixes(fileName).replace(/[^a-zA-Z0-9._-]/g, '_');
  return `exams/${metadata.tenantId}/${metadata.examId}/${metadata.documentType}/${randomUUID()}-${safeName}`;
}

export async function ensureParentDir(filePath: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
}

export async function moveFile(
  fromPath: string,
  toPath: string,
): Promise<void> {
  await ensureParentDir(toPath);
  await rename(fromPath, toPath);
}

export async function removeFile(filePath: string): Promise<void> {
  await rm(filePath, { force: true });
}

export async function readFileStats(filePath: string) {
  return stat(filePath);
}

export function safeJoin(root: string, objectKey: string): string {
  if (!isStorageKey(objectKey)) {
    throw new Error('Invalid storage key');
  }
  const path = resolve(join(root, objectKey));
  const rel = relative(root, path);
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error('Storage key escapes storage root');
  }
  return path;
}
