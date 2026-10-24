import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { UserRole } from '@driva/shared';

export const IS_PUBLIC = 'isPublic';
/** Lets a route through without an access token. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const ROLES = 'roles';
/** Limits a route to these roles. */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES, roles);

export interface AuthUser {
  id: string;
  role: UserRole;
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser => ctx.switchToHttp().getRequest().user,
);
