import { ConflictException, ForbiddenException, Inject, Injectable } from '@nestjs/common';
import type {
  AuthApp,
  ParsedOtpVerify,
  ParsedSignup,
  SignupResult,
  UserRole,
  VerifyResult,
} from '@driva/shared';
import { Pool } from 'pg';
import { writeAudit } from '../common/audit';
import { inTransaction, PG_POOL } from '../database/database.module';
import { toMe, UsersService } from '../users/users.service';
import { OtpService } from './otp.service';
import { TokensService } from './tokens.service';

/** The role an account must have to use each mobile app, and the role a new account gets. */
const APP_ROLE: Record<AuthApp, UserRole> = { client: 'client', driver: 'driver' };

const WRONG_APP: Record<UserRole, string> = {
  client: 'This number has a client account. Use the Driva app to sign in.',
  driver: 'This number has a driver account. Use the Driva Driver app to sign in.',
  admin: 'Staff accounts sign in on the admin dashboard.',
  vetting_officer: 'Staff accounts sign in on the admin dashboard.',
};

@Injectable()
export class AuthService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly otp: OtpService,
    private readonly tokens: TokensService,
    private readonly users: UsersService,
  ) {}

  /**
   * Signs in a known number. For a new number it returns a short lived sign-up token instead,
   * so we only reveal whether a number has an account after its owner has proved they hold it.
   */
  async verify({ phone, code, app }: ParsedOtpVerify): Promise<VerifyResult> {
    await this.otp.verify(phone, code);
    const user = await this.users.findByPhone(this.pool, phone);
    if (!user) {
      return {
        status: 'signup_required',
        signupToken: await this.tokens.signSignupToken({ phone, app }),
      };
    }
    if (user.deleted_at) throw new ForbiddenException('This account has been closed.');
    if (user.role !== APP_ROLE[app]) throw new ForbiddenException(WRONG_APP[user.role]);

    await this.users.markPhoneVerified(this.pool, user.id);
    const tokens = await this.tokens.issue(this.pool, { id: user.id, role: user.role }, app);
    return { status: 'signed_in', user: toMe(user), ...tokens };
  }

  async signup(body: ParsedSignup): Promise<SignupResult> {
    const { phone, app } = await this.tokens.verifySignupToken(body.signupToken);
    return inTransaction(this.pool, async (db) => {
      const user = await this.users.create(db, {
        role: APP_ROLE[app],
        phone,
        fullName: body.fullName,
        emergencyContactName: body.emergencyContactName,
        emergencyContactPhone: body.emergencyContactPhone,
      });
      if (!user)
        throw new ConflictException('This number already has an account. Sign in instead.');
      await writeAudit(db, {
        actorId: user.id,
        action: 'user.signed_up',
        entity: 'user',
        entityId: user.id,
        details: { role: user.role, app, consent: true },
      });
      const tokens = await this.tokens.issue(db, { id: user.id, role: user.role }, app);
      return { user: toMe(user), ...tokens };
    });
  }
}
