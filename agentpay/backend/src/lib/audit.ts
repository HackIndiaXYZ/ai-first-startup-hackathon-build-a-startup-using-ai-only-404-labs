import { ulid } from 'ulid';
import { db } from '../db';

interface AuditParams {
  organizationId: string;
  actorType: 'user' | 'agent' | 'system';
  actorId?: string;
  action: string;
  resourceType?: string;
  resourceId?: string;
  previousState?: Record<string, unknown>;
  newState?: Record<string, unknown>;
  requestId?: string;
  policyVersionId?: string;
  decision?: string;
  ipAddress?: string;
}

export async function createAuditEvent(params: AuditParams): Promise<void> {
  try {
    await db.query(
      `INSERT INTO audit_events (
        id, organization_id, actor_type, actor_id, action,
        resource_type, resource_id, previous_state, new_state,
        request_id, policy_version_id, decision, ip_address, occurred_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NOW())`,
      [
        ulid(),
        params.organizationId,
        params.actorType,
        params.actorId || null,
        params.action,
        params.resourceType || null,
        params.resourceId || null,
        params.previousState ? JSON.stringify(params.previousState) : null,
        params.newState ? JSON.stringify(params.newState) : null,
        params.requestId || null,
        params.policyVersionId || null,
        params.decision || null,
        params.ipAddress || null,
      ]
    );
  } catch (err) {
    // Audit failures should not crash the main flow but must be logged
    console.error('AUDIT WRITE FAILURE:', err);
  }
}
