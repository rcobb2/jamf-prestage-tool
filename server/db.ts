import { Database } from 'bun:sqlite';
import logger from './logger.ts';
import type { ADEDeviceRecord } from './ade-alerts.ts';

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

// Seen-set for the ADE watcher, doubling as the in-app alert feed.
// A row with is_new = 0 is baseline (present when the instance was first seeded, so
// never alerted on); is_new = 1 is a genuine post-baseline addition.
// Keyed on (instance_id, serial_number) rather than serial alone: the seen-set is
// per-instance, so a global key would let an INSERT OR IGNORE silently drop a device that
// migrated between enrollment instances after it had already been alerted on.
db.run(`CREATE TABLE IF NOT EXISTS ade_devices (
  serial_number TEXT NOT NULL,
  instance_id TEXT NOT NULL,
  instance_name TEXT,
  model TEXT,
  description TEXT,
  asset_tag TEXT,
  device_assigned_date TEXT,
  first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  is_new INTEGER NOT NULL DEFAULT 1,
  acknowledged_at TEXT,
  acknowledged_by TEXT,
  PRIMARY KEY (instance_id, serial_number)
)`);

db.run(`CREATE INDEX IF NOT EXISTS idx_ade_devices_feed ON ade_devices (is_new, acknowledged_at)`);

// One row per device-enrollment instance. seeded_at being non-null is what
// distinguishes "first ever poll" (baseline, stay quiet) from "steady state" (alert).
db.run(`CREATE TABLE IF NOT EXISTS ade_watch_state (
  instance_id TEXT PRIMARY KEY,
  instance_name TEXT,
  seeded_at TEXT,
  seeded_count INTEGER,
  last_polled_at TEXT,
  last_error TEXT
)`);

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

// ============================================================================
// ADE watcher persistence
// ============================================================================

export type ADEAlertRow = {
  serial_number: string;
  instance_id: string;
  instance_name: string | null;
  model: string | null;
  description: string | null;
  asset_tag: string | null;
  device_assigned_date: string | null;
  first_seen_at: string;
  acknowledged_at: string | null;
  acknowledged_by: string | null;
};

export function getKnownADESerials(instanceId: string): Set<string> {
  const rows = db.query(`SELECT serial_number FROM ade_devices WHERE instance_id = ?`).all(instanceId) as { serial_number: string }[];
  return new Set(rows.map((r) => r.serial_number));
}

export function isADEInstanceSeeded(instanceId: string): boolean {
  const row = db.query(`SELECT seeded_at FROM ade_watch_state WHERE instance_id = ?`).get(instanceId) as { seeded_at: string | null } | null;
  return !!row?.seeded_at;
}

// Inserts devices into the seen-set. `isNew: false` is the silent baseline path used on
// an instance's first poll; `true` marks rows that surface as alerts. Wrapped in a single
// transaction because a first seed can be thousands of rows.
export function recordADEDevices(
  instanceId: string,
  instanceName: string | null,
  devices: ADEDeviceRecord[],
  isNew: boolean,
): number {
  if (devices.length === 0) return 0;
  const stmt = db.prepare(
    `INSERT OR IGNORE INTO ade_devices
       (serial_number, instance_id, instance_name, model, description, asset_tag, device_assigned_date, is_new)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const insertAll = db.transaction((batch: ADEDeviceRecord[]) => {
    let inserted = 0;
    for (const d of batch) {
      inserted += stmt.run(
        d.serialNumber,
        instanceId,
        instanceName,
        d.model ?? null,
        d.description ?? null,
        d.assetTag ?? null,
        d.deviceAssignedDate ?? null,
        isNew ? 1 : 0,
      ).changes;
    }
    return inserted;
  });
  return insertAll(devices);
}

export function markADEInstanceSeeded(instanceId: string, instanceName: string | null, count: number) {
  db.run(
    `INSERT INTO ade_watch_state (instance_id, instance_name, seeded_at, seeded_count, last_polled_at)
     VALUES (?, ?, datetime('now'), ?, datetime('now'))
     ON CONFLICT(instance_id) DO UPDATE SET
       instance_name = excluded.instance_name,
       seeded_at = COALESCE(ade_watch_state.seeded_at, excluded.seeded_at),
       seeded_count = COALESCE(ade_watch_state.seeded_count, excluded.seeded_count),
       last_polled_at = excluded.last_polled_at`,
    [instanceId, instanceName, count]
  );
}

export function markADEInstancePolled(instanceId: string, instanceName: string | null, error?: string) {
  db.run(
    `INSERT INTO ade_watch_state (instance_id, instance_name, last_polled_at, last_error)
     VALUES (?, ?, datetime('now'), ?)
     ON CONFLICT(instance_id) DO UPDATE SET
       instance_name = excluded.instance_name,
       last_polled_at = excluded.last_polled_at,
       last_error = excluded.last_error`,
    [instanceId, instanceName, error ?? null]
  );
}

export function getADEAlerts(opts: { limit?: number; unacknowledgedOnly?: boolean } = {}): ADEAlertRow[] {
  const limit = opts.limit ?? 100;
  const where = opts.unacknowledgedOnly ? `WHERE is_new = 1 AND acknowledged_at IS NULL` : `WHERE is_new = 1`;
  return db.query(
    `SELECT serial_number, instance_id, instance_name, model, description, asset_tag,
            device_assigned_date, first_seen_at, acknowledged_at, acknowledged_by
     FROM ade_devices ${where}
     ORDER BY first_seen_at DESC, serial_number DESC
     LIMIT ?`
  ).all(limit) as ADEAlertRow[];
}

export function countUnacknowledgedADEAlerts(): number {
  const row = db.query(`SELECT COUNT(*) AS n FROM ade_devices WHERE is_new = 1 AND acknowledged_at IS NULL`).get() as { n: number };
  return row?.n ?? 0;
}

// Acknowledges the given serials, or every outstanding alert when `serials` is empty.
// Acknowledgement is deliberately instance-wide: a serial that appears under two enrollment
// instances (a migrated device) is dismissed everywhere, since the operator has seen the device.
export function acknowledgeADEAlerts(serials: string[], actor: string): number {
  if (serials.length === 0) {
    const result = db.run(
      `UPDATE ade_devices SET acknowledged_at = datetime('now'), acknowledged_by = ?
       WHERE is_new = 1 AND acknowledged_at IS NULL`,
      [actor]
    );
    return result.changes;
  }
  const placeholders = serials.map(() => '?').join(', ');
  const result = db.run(
    `UPDATE ade_devices SET acknowledged_at = datetime('now'), acknowledged_by = ?
     WHERE is_new = 1 AND acknowledged_at IS NULL AND serial_number IN (${placeholders})`,
    [actor, ...serials]
  );
  return result.changes;
}

export function getADEWatchState() {
  return db.query(`SELECT * FROM ade_watch_state ORDER BY instance_id`).all();
}

export default db;
