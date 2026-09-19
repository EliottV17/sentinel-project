import {
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class UpdateMonitorDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsString()
  target?: string;

  @IsOptional()
  @IsString()
  check_type?: string;

  @IsOptional()
  @IsObject()
  check_config?: Record<string, any>;

  @IsOptional()
  @IsInt()
  @Min(10, { message: 'frequency must be greater than or equal to 10' })
  frequency?: number;
}
