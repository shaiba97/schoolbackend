import { BadRequestException, Body, Controller, ForbiddenException, Get, Post, Query, Res, StreamableFile, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { diskStorage } from 'multer';
import { createReadStream } from 'node:fs';
import { mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { isUUID } from 'class-validator';
import type { Response } from 'express';
import { DeleteStagedFileDto, UploadFileDto } from './dto/upload-file.dto';
import { isStorageKey, StorageService, stripKeyUuidPrefixes } from './storage.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../common/tenant/tenant.guard';
import { CurrentTenant } from '../common/tenant/current-tenant.decorator';

const allowedMimeTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);

function stagingRoot(): string {
  const root = process.env.STORAGE_ROOT || 'storage';
  const destination = `${root}/staging`;
  mkdirSync(destination, { recursive: true });
  return destination;
}

@ApiTags('Storage')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard)
@ApiSecurity('X-Tenant-Id')
@Controller('storage')
export class StorageController {
  constructor(private readonly storage: StorageService) {}

  /**
   * Every object key this module issues is namespaced
   * `{area}/{tenantId}/...` (staging included). Reads and deletes must
   * stay inside the caller's tenant — key shape alone is not enough.
   */
  private assertTenantKey(tenantId: string, objectKey: string) {
    const segment = objectKey.split('/')[1];
    if (!segment || segment !== tenantId) {
      throw new ForbiddenException('Object does not belong to this tenant');
    }
  }

  @Post('upload')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: (_req, _file, callback) => callback(null, stagingRoot()),
        filename: (_req, file, callback) => callback(null, `${randomUUID()}-${file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')}`),
      }),
      limits: { fileSize: Number(process.env.MAX_UPLOAD_MB || 10) * 1024 * 1024 },
      fileFilter: (_req, file, callback) => {
        if (!allowedMimeTypes.has(file.mimetype)) {
          return callback(new BadRequestException(`Unsupported file type: ${file.mimetype}`), false);
        }
        // Exam samples are PDF-only; the generic allowlist above also
        // permits images for profile/ID documents.
        const documentType = (_req.body as { documentType?: string } | undefined)?.documentType;
        if (documentType === 'EXAM_SAMPLE' && file.mimetype !== 'application/pdf') {
          return callback(new BadRequestException('Exam sample must be a PDF file'), false);
        }
        return callback(null, true);
      },
    }),
  )
  async upload(
    @CurrentTenant('tenantId') tenantId: string,
    @Body() body: UploadFileDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!tenantId || !isUUID(tenantId)) throw new BadRequestException('X-Tenant-Id must be a valid UUID');
    if (!file) throw new BadRequestException('file is required');
    return this.storage.saveStagedFile(file, {
      tenantId,
      draftId: body.draftId,
      documentType: body.documentType,
      studentId: body.studentId,
      teacherId: body.teacherId,
    });
  }

  @Post('staging/delete')
  async deleteStaged(
    @CurrentTenant('tenantId') tenantId: string,
    @Body() body: DeleteStagedFileDto,
  ) {
    if (!isStorageKey(body.objectKey)) throw new BadRequestException('Invalid object key');
    this.assertTenantKey(tenantId, body.objectKey);
    await this.storage.deleteObject(body.objectKey);
    return { deleted: true };
  }

  @Get('download')
  async download(
    @CurrentTenant('tenantId') tenantId: string,
    @Query('objectKey') objectKey: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    if (!objectKey || !isStorageKey(objectKey)) throw new BadRequestException('Invalid object key');
    this.assertTenantKey(tenantId, objectKey);
    const filePath = this.storage.getObjectPath(objectKey);
    // Never expose internal UUID-prefixed key names to users: strip the
    // machine prefix so the downloaded file keeps its human-readable name.
    const downloadName =
      stripKeyUuidPrefixes(objectKey.split('/').pop() ?? 'download') || 'download';
    response.setHeader('Content-Disposition', `attachment; filename="${downloadName}"`);
    return new StreamableFile(createReadStream(filePath));
  }
}
