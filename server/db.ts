import { Database } from 'bun:sqlite';
import logger from './logger.ts';

const db = new Database(process.env.AUDIT_DB_PATH || '/app/audit.db', { create: true });

db.run(`CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp TEXT NOT NULL DEFAULT (datetime('now')),
  action TEXT NOT NULL,
  actor TEXT,
  ip TEXT,
  device_serial TEXT,
  device_id TEXT,
  details TEXT,
  result TEXT NOT NULL,
  error_detail TEXT
)`);

db.run(`CREATE TABLE IF NOT EXISTS pending_approvals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  action TEXT NOT NULL,
  requester TEXT NOT NULL,
  justification TEXT,
  device_serial TEXT NOT NULL,
  device_id TEXT,
  device_asset_tag TEXT,
  payload TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  approver TEXT,
  approved_at TEXT
)`);

// Add justification column if it doesn't exist (migration for existing DBs)
try { db.run(`ALTER TABLE pending_approvals ADD COLUMN justification TEXT`); } catch { /* already exists */ }

export function writeAudit(entry: {
  action: string;
  actor?: string;
  ip?: string;
  device_serial?: string;
  device_id?: string;
  details?: object;
  result: 'success' | 'error';
  error_detail?: string;
}) {
  db.run(
    `INSERT INTO audit_log (action, actor, ip, device_serial, device_id, details, result, error_detail)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      entry.action,
      entry.actor ?? null,
      entry.ip ?? null,
      entry.device_serial ?? null,
      entry.device_id ?? null,
      entry.details ? JSON.stringify(entry.details) : null,
      entry.result,
      entry.error_detail ?? null,
    ]
  );
  const logFn = entry.result === 'error' ? logger.error.bind(logger) : logger.info.bind(logger);
  logFn({ audit: true, action: entry.action, actor: entry.actor, device_serial: entry.device_serial, device_id: entry.device_id, details: entry.details, error_detail: entry.error_detail }, `AUDIT: ${entry.action} [${entry.result}]`);
}

export function getAuditLog(limit = 100) {
  return db.query(`SELECT * FROM audit_log ORDER BY id DESC LIMIT ?`).all(limit);
}

export function createApproval(row: {
  action: string;
  requester: string;
  justification?: string;
  device_serial: string;
  device_id?: string;
  device_asset_tag?: string;
  payload: object;
}) {
  const result = db.run(
    `INSERT INTO pending_approvals (action, requester, justification, device_serial, device_id, device_asset_tag, payload)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      row.action,
      row.requester,
      row.justification ?? null,
      row.device_serial,
      row.device_id ?? null,
      row.device_asset_tag ?? null,
      JSON.stringify(row.payload),
    ]
  );
  return result.lastInsertRowid;
}

export function getPendingApprovals() {
  return db.query(`SELECT * FROM pending_approvals WHERE status = 'pending' ORDER BY created_at ASC`).all();
}

export function resolveApproval(id: number, approver: string, status: 'approved' | 'rejected') {
  db.run(
    `UPDATE pending_approvals SET status = ?, approver = ?, approved_at = datetime('now') WHERE id = ?`,
    [status, approver, id]
  );
  return db.query(`SELECT * FROM pending_approvals WHERE id = ?`).get(id) as any;
}

export default db;
