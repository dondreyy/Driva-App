import { BadRequestException, PipeTransform } from '@nestjs/common';
import { ZodType, ZodTypeDef } from 'zod';

/** Validates and normalizes a request body with a schema from @driva/shared. */
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T, ZodTypeDef, unknown>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException(result.error.issues.map((issue) => issue.message));
    }
    return result.data;
  }
}
