import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { AuthApp, AuthTokens, UserRole } from '@driva/shared';
import { Pool, PoolClient } from 'pg';
import { writeAudit } from '../common/audit';
import { inTransaction, PG_POOL } from '../database/database.module';
import { AuthUser } from './decorators';

export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
export const REFRESH_TOKEN_TTL_DAYS = 30;
const SIGNUP_TOKEN_TTL_SECONDS = 15 * 60;

const ACCESS_AUDIENCE = 'driva:access';
const SIGNUP_AUDIENCE = 'driva:signup';

export interface SignupClaims {
  phone: string;
  app: AuthApp;
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

@Injectable()
export class TokensService {
  constructor(
    private readonly jwt: JwtService,
    @Inject(PG_POOL) private readonly pool: Pool,
  ) {}

  /** Issues a short lived access token and a stored, rotating refresh token. */
  async issue(db: Pool | PoolClient, user: AuthUser, device: string): Promise<AuthTokens> {
    const accessToken = await this.jwt.signAsync(
      { role: user.role },
      { subject: user.id, audience: ACCESS_AUDIENCE, expiresIn: ACCESS_TOKEN_TTL_SECONDS },
    );
    const refreshToken = randomBytes(32).toString('base64url');
    await db.query(
      `INSERT INTO refresh_tokens (user_id, token_hash, device, expires_at)
       VALUES ($1, $2, $3, now() + make_interval(days => $4))`,
      [user.id, hashToken(refreshToken), device, REFRESH_TOKEN_TTL_DAYS],
    );
    return { accessToken, refreshToken, expiresIn: ACCESS_TOKEN_TTL_SECONDS };
  }

  async verifyAccessToken(token: string): Promise<AuthUser> {
    try {
      const claims = await this.jwt.verifyAsync<{ sub: string; role: UserRole }>(token, {
        audience: ACCESS_AUDIENCE,
      });
      return { id: claims.sub, role: claims.role };
    } catch {
      throw new UnauthorizedException('Your session has expired. Sign in again.');
    }
  }

  signSignupToken(claims: SignupClaims): Promise<string> {
    return this.jwt.signAsync(claims, {
      audience: SIGNUP_AUDIENCE,
      expiresIn: SIGNUP_TOKEN_TTL_SECONDS,
    });
  }

  async verifySignupToken(token: string): Promise<SignupClaims> {
    try {
      const { phone, app } = await this.jwt.verifyAsync<SignupClaims>(token, {
        audience: SIGNUP_AUDIENCE,
      });
      return { phone, app };
    } catch {
      throw new UnauthorizedException('This sign up has expired. Start again.');
    }
  }

  /**
   * Swaps a refresh token for a new pair. A refresh token works once. If a token that was
   * already used comes back, someone may have copied it, so every session of that user ends.
   */
  async rotate(refreshToken: string): Promise<AuthTokens> {
    const outcome = await inTransaction(this.pool, async (db) => {
      const { rows } = await db.query<{
        id: string;
        user_id: string;
        device: string | null;
        revoked: boolean;
        expired: boolean;
        role: UserRole;
        deleted: boolean;
      }>(
        `SELECT rt.id, rt.user_id, rt.device, rt.revoked_at IS NOT NULL AS revoked,
                rt.expires_at <= now() AS expired, u.role, u.deleted_at IS NOT NULL AS deleted
         FROM refresh_tokens rt JOIN users u ON u.id = rt.user_id
         WHERE rt.token_hash = $1
         FOR UPDATE OF rt`,
        [hashToken(refreshToken)],
      );
      const row = rows[0];
      if (!row) return null;
      if (row.revoked) {
        await db.query(
          `UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`,
          [row.user_id],
        );
        await writeAudit(db, {
          actorId: row.user_id,
          action: 'auth.refresh_token_reused',
          entity: 'user',
          entityId: row.user_id,
        });
        return null;
      }
      if (row.expired || row.deleted) return null;
      await db.query(`UPDATE refresh_tokens SET revoked_at = now() WHERE id = $1`, [row.id]);
      return this.issue(db, { id: row.user_id, role: row.role }, row.device ?? 'unknown');
    });
    if (!outcome) throw new UnauthorizedException('Your session has expired. Sign in again.');
    return outcome;
  }

  async revoke(refreshToken: string): Promise<void> {
    await this.pool.query(
      `UPDATE refresh_tokens SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL`,
      [hashToken(refreshToken)],
    );
  }
}
