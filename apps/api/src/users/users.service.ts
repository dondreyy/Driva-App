import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Me, ParsedUpdateMe, UserRole } from '@driva/shared';
import { Pool, PoolClient } from 'pg';
import { PG_POOL } from '../database/database.module';

interface UserRow {
  id: string;
  role: UserRole;
  full_name: string;
  phone: string;
  email: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  created_at: Date;
  deleted_at: Date | null;
}

const COLUMNS = `id, role, full_name, phone, email, emergency_contact_name, emergency_contact_phone,
                 created_at, deleted_at`;

export function toMe(row: UserRow): Me {
  return {
    id: row.id,
    role: row.role,
    fullName: row.full_name,
    phone: row.phone,
    email: row.email,
    emergencyContactName: row.emergency_contact_name,
    emergencyContactPhone: row.emergency_contact_phone,
    createdAt: row.created_at.toISOString(),
  };
}

export interface NewUser {
  role: UserRole;
  phone: string;
  fullName: string;
  emergencyContactName?: string;
  emergencyContactPhone?: string;
}

@Injectable()
export class UsersService {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async findByPhone(db: Pool | PoolClient, phone: string): Promise<UserRow | undefined> {
    const { rows } = await db.query<UserRow>(`SELECT ${COLUMNS} FROM users WHERE phone = $1`, [
      phone,
    ]);
    return rows[0];
  }

  /** Creates the account with consent recorded, or returns undefined if the phone is taken. */
  async create(db: PoolClient, user: NewUser): Promise<UserRow | undefined> {
    const { rows } = await db.query<UserRow>(
      `INSERT INTO users (role, phone, full_name, emergency_contact_name, emergency_contact_phone,
                          phone_verified_at, consent_recorded_at)
       VALUES ($1, $2, $3, $4, $5, now(), now())
       ON CONFLICT (phone) DO NOTHING
       RETURNING ${COLUMNS}`,
      [
        user.role,
        user.phone,
        user.fullName,
        user.emergencyContactName ?? null,
        user.emergencyContactPhone ?? null,
      ],
    );
    return rows[0];
  }

  async markPhoneVerified(db: Pool | PoolClient, id: string): Promise<void> {
    await db.query(`UPDATE users SET phone_verified_at = now() WHERE id = $1`, [id]);
  }

  async getMe(id: string): Promise<Me> {
    const { rows } = await this.pool.query<UserRow>(
      `SELECT ${COLUMNS} FROM users WHERE id = $1 AND deleted_at IS NULL`,
      [id],
    );
    if (!rows[0]) throw new NotFoundException('Account not found');
    return toMe(rows[0]);
  }

  async updateMe(id: string, changes: ParsedUpdateMe): Promise<Me> {
    const columns: Record<keyof ParsedUpdateMe, string> = {
      fullName: 'full_name',
      email: 'email',
      emergencyContactName: 'emergency_contact_name',
      emergencyContactPhone: 'emergency_contact_phone',
    };
    const sets: string[] = [];
    const values: unknown[] = [id];
    for (const key of Object.keys(columns) as (keyof ParsedUpdateMe)[]) {
      if (changes[key] !== undefined) {
        values.push(changes[key]);
        sets.push(`${columns[key]} = $${values.length}`);
      }
    }
    if (sets.length === 0) return this.getMe(id);
    try {
      const { rows } = await this.pool.query<UserRow>(
        `UPDATE users SET ${sets.join(', ')} WHERE id = $1 AND deleted_at IS NULL RETURNING ${COLUMNS}`,
        values,
      );
      if (!rows[0]) throw new NotFoundException('Account not found');
      return toMe(rows[0]);
    } catch (err) {
      if ((err as { code?: string }).code === '23505') {
        throw new ConflictException('That email is already used by another account');
      }
      throw err;
    }
  }
}
