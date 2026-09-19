import {
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateMonitorDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(1)
  @MaxLength(100)
  name: string;

  @IsString()
  @IsNotEmpty()
  target: string;

  @IsOptional()
  @IsString()
  check_type?: string = 'http';

  @IsOptional()
  @IsObject()
  check_config?: Record<string, any> = {};

  @IsOptional()
  @IsInt()
  @Min(10, { message: 'frequency must be greater than or equal to 10' })
  frequency?: number = 60;
}
