import { Injectable } from '@nestjs/common';
import { basename, resolve } from 'node:path';
import { buildStagedKey, buildStudentKey, buildTeacherKey, buildExamKey, moveFile, readFileStats, removeFile, safeJoin, type StorageMetadata, type StorageService, type StoredObject } from '../storage.service';

@Injectable()
export class LocalStorageService implements StorageService {
  private readonly root = resolve(process.env.STORAGE_ROOT || 'storage');

  async saveStagedFile(file: Express.Multer.File, metadata: StorageMetadata): Promise<StoredObject> {
    const objectKey = buildStagedKey(metadata, file.originalname);
    const destination = safeJoin(this.root, objectKey);
    await moveFile(file.path, destination);
    return {
      objectKey,
      originalName: file.originalname,
      contentType: file.mimetype,
      size: file.size,
    };
  }

  async moveToStudent(objectKey: string, metadata: StorageMetadata & { studentId: string }): Promise<StoredObject> {
    const source = safeJoin(this.root, objectKey);
    const studentKey = buildStudentKey(metadata, basename(objectKey));
    const destination = safeJoin(this.root, studentKey);
    await moveFile(source, destination);
    return {
      objectKey: studentKey,
      originalName: basename(objectKey),
      contentType: 'application/octet-stream',
      size: (await readFileStats(destination)).size,
    };
  }

  async moveToTeacher(objectKey: string, metadata: StorageMetadata & { teacherId: string }): Promise<StoredObject> {
    const source = safeJoin(this.root, objectKey);
    const teacherKey = buildTeacherKey(metadata, basename(objectKey));
    const destination = safeJoin(this.root, teacherKey);
    await moveFile(source, destination);
    return {
      objectKey: teacherKey,
      originalName: basename(objectKey),
      contentType: 'application/octet-stream',
      size: (await readFileStats(destination)).size,
    };
  }

  async moveToExam(objectKey: string, metadata: StorageMetadata & { examId: string }): Promise<StoredObject> {
    const source = safeJoin(this.root, objectKey);
    const examKey = buildExamKey(metadata, basename(objectKey));
    const destination = safeJoin(this.root, examKey);
    await moveFile(source, destination);
    return {
      objectKey: examKey,
      originalName: basename(objectKey),
      contentType: 'application/octet-stream',
      size: (await readFileStats(destination)).size,
    };
  }

  async deleteObject(objectKey: string): Promise<void> {
    await removeFile(safeJoin(this.root, objectKey));
  }

  getObjectPath(objectKey: string): string {
    return safeJoin(this.root, objectKey);
  }

  async getObjectMetadata(objectKey: string): Promise<{ size: number; contentType: string }> {
    const filePath = safeJoin(this.root, objectKey);
    const stats = await readFileStats(filePath);
    return { size: stats.size, contentType: 'application/octet-stream' };
  }
}
