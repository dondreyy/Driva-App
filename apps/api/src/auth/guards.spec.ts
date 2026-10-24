import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from './guards';

function contextFor(user: unknown): ExecutionContext {
  return {
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

describe('RolesGuard', () => {
  const guardWith = (roles: string[] | undefined) =>
    new RolesGuard({ getAllAndOverride: () => roles } as unknown as Reflector);

  it('lets anyone signed in through when no roles are set', () => {
    expect(guardWith(undefined).canActivate(contextFor({ id: 'u', role: 'client' }))).toBe(true);
  });

  it('allows a listed role', () => {
    expect(guardWith(['admin']).canActivate(contextFor({ id: 'u', role: 'admin' }))).toBe(true);
  });

  it('refuses other roles', () => {
    expect(() => guardWith(['admin']).canActivate(contextFor({ id: 'u', role: 'driver' }))).toThrow(
      ForbiddenException,
    );
  });
});
