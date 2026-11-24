// Security rule verification suite for Guard AI Firestore rules.
// Evaluates all 12 Dirty Dozen payloads against Firestore Rules logic.
export const dirtyDozenPayloads = [
  { name: 'Self-Admin Escalation', collection: 'users', op: 'create', expected: 'PERMISSION_DENIED' },
  { name: 'Shadow Field Injection on User', collection: 'users', op: 'update', expected: 'PERMISSION_DENIED' },
  { name: 'Cross-User PII Read', collection: 'users', op: 'get', expected: 'PERMISSION_DENIED' },
  { name: 'Police Number Leak', collection: 'police_stations', op: 'list', expected: 'PERMISSION_DENIED' },
  { name: 'Unapproved Alert Spoofing', collection: 'alerts', op: 'create', expected: 'PERMISSION_DENIED' },
  { name: 'Unpaid Home Video Spoofing', collection: 'home_videos', op: 'create', expected: 'PERMISSION_DENIED' },
  { name: 'Self-Approving Payment', collection: 'payments', op: 'update', expected: 'PERMISSION_DENIED' },
  { name: 'Self-Approving Subscription', collection: 'subscriptions', op: 'create', expected: 'PERMISSION_DENIED' },
  { name: 'Impersonating Another User Scan', collection: 'road_scanner', op: 'create', expected: 'PERMISSION_DENIED' },
  { name: 'Reading Other Family Circle', collection: 'family_tracking', op: 'list', expected: 'PERMISSION_DENIED' },
  { name: 'ID Poisoning', collection: 'users', op: 'create', expected: 'PERMISSION_DENIED' },
  { name: 'Client Timestamp Backdating', collection: 'incident_reports', op: 'create', expected: 'PERMISSION_DENIED' },
  { name: 'Under-24h / 30m Anti-Spam Report Bypass', collection: 'incident_reports', op: 'create', expected: 'PERMISSION_DENIED' },
  { name: 'Duplicate False Vote & Unbacked Reporter Flag', collection: 'alerts', op: 'update', expected: 'PERMISSION_DENIED' },
  { name: 'Audit Log Modification Attempt', collection: 'report_audit_logs', op: 'update', expected: 'PERMISSION_DENIED' },
];
