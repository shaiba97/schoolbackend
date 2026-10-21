import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

export class SetToggleDto {
  @ApiProperty()
  @IsBoolean()
  enabled!: boolean;
}
