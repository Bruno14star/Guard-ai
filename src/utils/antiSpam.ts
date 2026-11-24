export const REPORT_MIN_ACCOUNT_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours
export const REPORT_COOLDOWN_MS = 30 * 60 * 1000; // 30 minutes
export const FALSE_REPORT_HIDE_THRESHOLD = 3;

export function toMillisSafe(value: unknown): number {
  if (!value) return 0;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  if (typeof value === 'object') {
    const obj = value as { toMillis?: () => number; seconds?: number };
    if (typeof obj.toMillis === 'function') {
      return obj.toMillis();
    }
    if (typeof obj.seconds === 'number') {
      return obj.seconds * 1000;
    }
  }
  return 0;
}

export function formatRemainingTime(ms: number): string {
  const totalSec = Math.max(1, Math.ceil(ms / 1000));
  const hours = Math.floor(totalSec / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;
  if (hours > 0) {
    return `${hours}h ${mins}m`;
  }
  if (mins > 0) {
    return `${mins}m ${secs}s`;
  }
  return `${secs}s`;
}

export interface ReportEligibilityResult {
  allowed: boolean;
  reason: 'banned' | 'age_24h' | 'cooldown_30m' | null;
  remainingMs: number;
  message: string;
}

export function checkReportEligibility(params: {
  role?: string;
  userCreatedAt?: unknown;
  authCreationTime?: string | null;
  lastReportAt?: unknown;
  recentReportTimesMs?: number[];
  nowMs?: number;
}): ReportEligibilityResult {
  const now = params.nowMs ?? Date.now();

  if (params.role === 'banned') {
    return {
      allowed: false,
      reason: 'banned',
      remainingMs: 0,
      message: 'Your account is currently suspended from submitting reports.',
    };
  }

  const firestoreCreatedMs = toMillisSafe(params.userCreatedAt);
  const authCreatedMs = toMillisSafe(params.authCreationTime);
  const accountCreatedMs =
    firestoreCreatedMs > 0 ? firestoreCreatedMs : authCreatedMs;

  if (!accountCreatedMs) {
    return {
      allowed: false,
      reason: 'age_24h',
      remainingMs: REPORT_MIN_ACCOUNT_AGE_MS,
      message:
        'Verifying account age. Users must be logged in for at least 24 hours before reporting.',
    };
  }

  const ageElapsedMs = Math.max(0, now - accountCreatedMs);
  if (ageElapsedMs < REPORT_MIN_ACCOUNT_AGE_MS) {
    const remaining = REPORT_MIN_ACCOUNT_AGE_MS - ageElapsedMs;
    return {
      allowed: false,
      reason: 'age_24h',
      remainingMs: remaining,
      message: `Anti-spam protection: You must be logged in for at least 24 hours before submitting a report (unlocks in ${formatRemainingTime(
        remaining
      )}).`,
    };
  }

  const lastReportFromProfile = toMillisSafe(params.lastReportAt);
  const latestFromHistory = (params.recentReportTimesMs || []).reduce(
    (max, t) => (t > max ? t : max),
    0
  );
  const latestReportMs = Math.max(lastReportFromProfile, latestFromHistory);

  if (latestReportMs > 0) {
    const elapsedSinceLast = Math.max(0, now - latestReportMs);
    if (elapsedSinceLast < REPORT_COOLDOWN_MS) {
      const remaining = REPORT_COOLDOWN_MS - elapsedSinceLast;
      return {
        allowed: false,
        reason: 'cooldown_30m',
        remainingMs: remaining,
        message: `Rate limit: You can only submit 1 report per 30 minutes (next report available in ${formatRemainingTime(
          remaining
        )}).`,
      };
    }
  }

  return {
    allowed: true,
    reason: null,
    remainingMs: 0,
    message: '',
  };
}

export function getDeviceAuditInfo(): string {
  if (typeof navigator === 'undefined') {
    return 'Server / Node Runtime';
  }
  const ua = navigator.userAgent || 'Unknown Browser';
  const platform =
    (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData
      ?.platform ||
    navigator.platform ||
    'Unknown OS';
  const screenInfo =
    typeof window !== 'undefined' && window.screen
      ? `${window.screen.width}x${window.screen.height}`
      : 'unknown';

  const summary = `${platform} (${screenInfo}) • ${ua}`.replace(/\s+/g, ' ').trim();
  return summary.slice(0, 240);
}
