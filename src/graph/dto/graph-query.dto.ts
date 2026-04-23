import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

// Query strings arrive as plain strings — @IsBoolean() rejects them without a
// transform. Unrecognised values are passed through unchanged so validation
// fails downstream rather than silently coercing garbage to false.
const toBoolean = ({ value }: { value: unknown }): unknown => {
  if (value === 'true' || value === '1' || value === true) return true;
  if (value === 'false' || value === '0' || value === false) return false;
  return value;
};

export class GraphQueryDto {
  @ApiPropertyOptional({ description: 'Only paths originating from a node with publicExposed: true' })
  @IsOptional()
  @IsBoolean()
  @Transform(toBoolean)
  startsFromPublic?: boolean;

  @ApiPropertyOptional({ description: 'Only paths terminating at a node with kind rds or sqs' })
  @IsOptional()
  @IsBoolean()
  @Transform(toBoolean)
  endsAtSink?: boolean;

  @ApiPropertyOptional({ description: 'Only paths where at least one node has non-empty vulnerabilities' })
  @IsOptional()
  @IsBoolean()
  @Transform(toBoolean)
  hasVulnerability?: boolean;
}
