import { db } from '../db/index.js'

export const writeAuditLog = ({ actorId, actorUsername, actorRole, action, entityType, entityId, detail }) => {
  const result = db.prepare(`
    INSERT INTO audit_logs (
      actor_id, actor_username, actor_role, action, entity_type, entity_id, detail
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    actorId ?? null,
    actorUsername ?? null,
    actorRole ?? null,
    action,
    entityType ?? null,
    entityId ?? null,
    detail ?? null
  )
  return db.prepare('SELECT * FROM audit_logs WHERE id = ?').get(result.lastInsertRowid)
}
