/**
 * Creates a staff account for the admin dashboard. Staff cannot sign themselves up.
 *
 *   pnpm --filter @driva/api staff:create --phone 0803 555 0100 --name "Ada Obi" --role vetting_officer
 *
 * Needs DATABASE_URL. Roles: admin, vetting_officer.
 */
import { maskPhone, normalizeNigerianPhone } from '@driva/shared';
import { Pool } from 'pg';
import { writeAudit } from '../common/audit';

const ROLES = ['admin', 'vetting_officer'] as const;

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return undefined;
  // Allow unquoted phone numbers with spaces: take words until the next --flag.
  const words: string[] = [];
  for (const word of process.argv.slice(index + 1)) {
    if (word.startsWith('--')) break;
    words.push(word);
  }
  return words.join(' ');
}

async function main(): Promise<void> {
  const phone = normalizeNigerianPhone(arg('phone') ?? '');
  const fullName = arg('name')?.trim();
  const role = arg('role') as (typeof ROLES)[number] | undefined;
  if (!phone || !fullName || !role || !ROLES.includes(role)) {
    throw new Error(
      'Usage: staff:create --phone <Nigerian mobile> --name "<full name>" --role admin|vetting_officer',
    );
  }
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const existing = await pool.query<{ role: string }>(`SELECT role FROM users WHERE phone = $1`, [
      phone,
    ]);
    if (existing.rows[0]) {
      throw new Error(`That number already has a ${existing.rows[0].role} account`);
    }
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO users (role, phone, full_name) VALUES ($1, $2, $3) RETURNING id`,
      [role, phone, fullName],
    );
    const id = rows[0]!.id;
    await writeAudit(pool, {
      actorId: null,
      action: 'staff.created',
      entity: 'user',
      entityId: id,
      details: { role },
    });
    process.stdout.write(`Created ${role} ${fullName} (${maskPhone(phone)}), id ${id}\n`);
  } finally {
    await pool.end();
  }
}

main().catch((err: Error) => {
  process.stderr.write(`${err.message}\n`);
  process.exit(1);
});
