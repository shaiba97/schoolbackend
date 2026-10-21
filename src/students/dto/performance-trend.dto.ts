import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';

export const TREND_METRICS = ['results', 'attendance'] as const;
export type TrendMetric = (typeof TREND_METRICS)[number];

export const TREND_WINDOWS = ['week', 'month', '3m', '6m', '1y'] as const;
export type TrendWindow = (typeof TREND_WINDOWS)[number];

/**
 * Query contract for the performance-trend aggregation.
 *
 * Both fields are allow-listed enums rather than free strings: an unvalidated
 * `window` would index into the window->days map, and an unvalidated date
 * range would let a caller reach arbitrary history.
 */
export class PerformanceTrendQueryDto {
  @ApiProperty({ enum: TREND_METRICS, description: 'results = average score %, attendance = attended %' })
  @IsEnum(TREND_METRICS)
  metric!: TrendMetric;

  @ApiPropertyOptional({ enum: TREND_WINDOWS, default: '3m' })
  @IsOptional()
  @IsEnum(TREND_WINDOWS)
  window: TrendWindow = '3m';
}