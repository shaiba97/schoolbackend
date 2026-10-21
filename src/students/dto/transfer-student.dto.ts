import { IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class TransferStudentDto {
  @ApiProperty()
  @IsUUID()
  classId: string;
}
