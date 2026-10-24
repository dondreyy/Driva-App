import { Body, Controller, Get, Patch } from '@nestjs/common';
import { Me, ParsedUpdateMe, updateMeSchema } from '@driva/shared';
import { AuthUser, CurrentUser } from '../auth/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { UsersService } from './users.service';

@Controller('me')
export class MeController {
  constructor(private readonly users: UsersService) {}

  @Get()
  get(@CurrentUser() user: AuthUser): Promise<Me> {
    return this.users.getMe(user.id);
  }

  @Patch()
  update(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(updateMeSchema)) body: ParsedUpdateMe,
  ): Promise<Me> {
    return this.users.updateMe(user.id, body);
  }
}
