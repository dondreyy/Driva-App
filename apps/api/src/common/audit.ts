import { Pool, PoolClient } from 'pg';

export interface AuditEntry {
  actorId: string | null;
  action: string;
  entity: string;
  entityId: string;
  /** Never put phone numbers, NINs, addresses or photos in here. */
  details?: Record<string, unknown>;
}

/** Writes to the append only audit_log table. Pass the transaction client when there is one. */
export async function writeAudit(db: Pool | PoolClient, entry: AuditEntry): Promise<void> {
  await db.query(
    `INSERT INTO audit_log (actor_id, action, entity, entity_id, details) VALUES ($1, $2, $3, $4, $5)`,
    [entry.actorId, entry.action, entry.entity, entry.entityId, entry.details ?? {}],
  );
}
