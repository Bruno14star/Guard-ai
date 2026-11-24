import { doc, getDoc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';
import {
  MonthlyFrozenWinnerReporter,
  MonthlyFrozenWinnerUser,
  MonthlyGuardBreakdown,
  PlanType,
  ScoreHistoryEntry,
  SubscriptionPlanCode,
  SubscriptionStatusType,
  UserUsageStat,
} from '../types';
import { STARTER_GUARDS_56, getStarterDailyDelta, isStarterUserRecord } from '../data/starterGuardsSeed';
import { toMillisSafe } from './antiSpam';
import {
  getNightWatchKeyWat,
  getWatDateKey,
  getWatMonthKey,
  isNightWatchWindowWat,
} from './geoPhysics';

export const EMPTY_MONTHLY_BREAKDOWN: MonthlyGuardBreakdown = {
  verifiedGunshotRobberyKidnapReports: 0,
  verifiedOtherReports: 0,
  verifiedReportMediaBonusCount: 0,
  reportsScoredTodayCount: 0,
  reportsScoredDayKey: '',

  roadScansCount: 0,
  roadSafeTripFinishCount: 0,
  roadScansTodayCount: 0,
  roadScansDayKey: '',

  buildingScansCount: 0,
  buildingDangerAvoidCount: 0,
  buildingScansTodayCount: 0,
  buildingScansDayKey: '',

  vehicleScansCount: 0,
  vehicleStolenAvoidCount: 0,
  vehicleScansTodayCount: 0,
  vehicleScansDayKey: '',

  nightWatchScansCount: 0,
  nightWatchThreatFoundCount: 0,
  nightWatchNightCount: 0,
  nightWatchNightKey: '',

  familyActiveDaysCount: 0,
  familyActiveLastDayKey: '',
  familyStreakCount: 0,
  familySevenDayStreaksCount: 0,
  familySafeArrivalsCount: 0,
  familyVerifiedMembersCount: 0,

  safeRoutesUsedCount: 0,
  safeRoutesTodayCount: 0,
  safeRoutesDayKey: '',

  communityVerificationsCorrectCount: 0,
  communityUpvotesCount: 0,
  upvotesTodayCount: 0,
  upvotesDayKey: '',
  dailyCheckInsCount: 0,
  lastCheckInDate: '',

  subscribedReferralsCount: 0,
  falseRejectedReportsCount: 0,
};

export function normalizeBreakdown(raw?: Partial<MonthlyGuardBreakdown> | null): MonthlyGuardBreakdown {
  return {
    ...EMPTY_MONTHLY_BREAKDOWN,
    ...(raw || {}),
  };
}

export function isStarterEntity(
  entity?: {
    uid?: string;
    userId?: string;
    isStarter?: boolean;
    isRealUser?: boolean;
    canWinPayout?: boolean;
  } | null
): boolean {
  return isStarterUserRecord(entity);
}

export function getEffectiveSubscription(entity?: {
  subscription?: string;
  subscriptionPlan?: string;
  subscriptionStatus?: string;
  subscriptionExpiresAt?: unknown;
  isStarter?: boolean;
  isRealUser?: boolean;
  canWinPayout?: boolean;
  userId?: string;
  uid?: string;
} | null): {
  plan: SubscriptionPlanCode;
  legacyPlan: PlanType;
  status: SubscriptionStatusType;
  isSubscriber: boolean;
  isExpired: boolean;
  expiresAtMs: number;
} {
  if (!entity || isStarterUserRecord(entity)) {
    return {
      plan: 'FREE',
      legacyPlan: 'Free',
      status: 'free',
      isSubscriber: false,
      isExpired: false,
      expiresAtMs: 0,
    };
  }

  const rawPlan = String(entity.subscriptionPlan || '').toUpperCase();
  let plan: SubscriptionPlanCode = 'FREE';
  if (rawPlan === 'YEARLY_35000' || rawPlan === 'YEARLY') plan = 'YEARLY_35000';
  else if (rawPlan === 'MONTHLY_5000' || rawPlan === 'MONTHLY') plan = 'MONTHLY_5000';

  const rawStatus = String(entity.subscriptionStatus || entity.subscription || 'free').toLowerCase();
  const expiresAtMs = toMillisSafe(entity.subscriptionExpiresAt);
  const now = Date.now();
  const expiredByDate = expiresAtMs > 0 && expiresAtMs <= now;

  // Backward compatibility: if old doc had subscription === 'active' without subscriptionPlan, treat as MONTHLY_5000
  if (plan === 'FREE' && rawStatus === 'active' && entity.subscription === 'active') {
    plan = 'MONTHLY_5000';
  }

  const isPaidPlan = plan === 'MONTHLY_5000' || plan === 'YEARLY_35000';
  const isActiveStatus = rawStatus === 'active';
  const isSubscriber = isPaidPlan && isActiveStatus && !expiredByDate;
  const isExpired = (isPaidPlan && isActiveStatus && expiredByDate) || rawStatus === 'expired';

  const legacyPlan: PlanType =
    !isSubscriber ? 'Free' : plan === 'YEARLY_35000' ? 'Yearly' : 'Monthly';

  const status: SubscriptionStatusType = isSubscriber
    ? 'active'
    : isExpired
    ? 'expired'
    : rawStatus === 'pending'
    ? 'pending'
    : 'free';

  return {
    plan,
    legacyPlan,
    status,
    isSubscriber,
    isExpired,
    expiresAtMs,
  };
}

/**
 * Real users NEVER lose points for inactivity.
 * Tracks inactiveDays for diagnostics only; multiplier is always 1.
 */
export function computeActivityDecay(lastActiveAt: unknown): {
  inactiveDays: number;
  decayPercent: number;
  multiplier: number;
  removedInactive7d: boolean;
} {
  const ms = toMillisSafe(lastActiveAt);
  const inactiveDays = ms ? Math.floor(Math.max(0, (Date.now() - ms) / (24 * 60 * 60 * 1000))) : 0;
  return {
    inactiveDays,
    decayPercent: 0,
    multiplier: 1,
    removedInactive7d: false,
  };
}

export function calculateMonthlyGuardScore(
  breakdownInput?: Partial<MonthlyGuardBreakdown> | null,
  _lastActiveAt?: unknown
): {
  rawScore: number;
  decayPercent: number;
  guardScore: number;
  removedInactive7d: boolean;
} {
  const b = normalizeBreakdown(breakdownInput);

  const reportPts =
    b.verifiedGunshotRobberyKidnapReports * 100 +
    b.verifiedOtherReports * 50 +
    b.verifiedReportMediaBonusCount * 20;

  const roadPts = b.roadScansCount * 30 + b.roadSafeTripFinishCount * 10;
  const buildingPts = b.buildingScansCount * 30 + b.buildingDangerAvoidCount * 20;
  const vehiclePts = b.vehicleScansCount * 30 + b.vehicleStolenAvoidCount * 50;
  const nightWatchPts = b.nightWatchScansCount * 50 + b.nightWatchThreatFoundCount * 50;

  const familyPts =
    b.familyActiveDaysCount * 25 +
    b.familySevenDayStreaksCount * 50 +
    b.familySafeArrivalsCount * 15 +
    Math.min(5, b.familyVerifiedMembersCount) * 100;

  const safeRoutePts = b.safeRoutesUsedCount * 20;
  const verifyPts = b.communityVerificationsCorrectCount * 15;
  const upvotePts = (b.communityUpvotesCount || 0) * 20;
  const checkInPts = b.dailyCheckInsCount * 10;
  const referralPts = b.subscribedReferralsCount * 200;
  const penaltyPts = b.falseRejectedReportsCount * 250;

  const rawScore = Math.max(
    0,
    reportPts +
      roadPts +
      buildingPts +
      vehiclePts +
      nightWatchPts +
      familyPts +
      safeRoutePts +
      verifyPts +
      upvotePts +
      checkInPts +
      referralPts -
      penaltyPts
  );

  return {
    rawScore,
    decayPercent: 0,
    guardScore: rawScore,
    removedInactive7d: false,
  };
}

export function getEffectiveGuardScore(stat: Partial<UserUsageStat>): number {
  if (isStarterEntity(stat)) {
    const seed = STARTER_GUARDS_56.find((s) => s.uid === stat.userId);
    const base = Number(stat.guardScore ?? seed?.baseScore ?? 0);
    // Apply deterministic midnight WAT shift if stat wasn't already shifted today
    const todayKey = getWatDateKey();
    if (stat.lastActiveDate === todayKey && typeof stat.guardScore === 'number') {
      return Math.max(0, Math.round(stat.guardScore));
    }
    const { scoreDelta } = getStarterDailyDelta(String(stat.userId || ''), todayKey);
    return Math.max(100, Math.round((seed?.baseScore ?? base) + scoreDelta));
  }

  if (stat.monthlyBreakdown) {
    return calculateMonthlyGuardScore(stat.monthlyBreakdown, stat.lastActiveAt || stat.lastActive).guardScore;
  }
  return Math.max(0, Math.round(Number(stat.guardScore || 0)));
}

/**
 * STRICT PAYOUT ELIGIBILITY:
 * Real active subscribers ONLY. Starter Guards are ALWAYS excluded.
 */
export function isEligibleForTop10(stat: Partial<UserUsageStat>): boolean {
  if (!stat || stat.cheatingFlagged) return false;
  if (isStarterEntity(stat)) return false;
  const sub = getEffectiveSubscription(stat);
  if (!sub.isSubscriber) return false;
  return true;
}

export function validatePayoutRecipient(
  stat: Partial<UserUsageStat> & { uid?: string }
): { ok: true } | { ok: false; error: string } {
  if (isStarterEntity(stat)) {
    return { ok: false, error: 'Starter Guards are not eligible' };
  }
  if (stat.cheatingFlagged) {
    return { ok: false, error: 'Flagged accounts are not eligible for payout' };
  }
  const sub = getEffectiveSubscription(stat);
  if (!sub.isSubscriber) {
    return { ok: false, error: 'Only active paid subscribers are eligible for payout' };
  }
  return { ok: true };
}

/**
 * Real Top 10 subscribers ONLY (used for payout calculation, Admin Top 10, & End-of-Month Freeze).
 */
export function sortTop10Guardians(stats: UserUsageStat[]): UserUsageStat[] {
  return stats
    .filter((s) => isEligibleForTop10(s))
    .map((s) => ({
      ...s,
      guardScore: getEffectiveGuardScore(s),
    }))
    .sort((a, b) => {
      const diff = (b.guardScore ?? 0) - (a.guardScore ?? 0);
      if (diff !== 0) return diff;
      const tb = toMillisSafe(b.lastActiveAt || b.lastActive);
      const ta = toMillisSafe(a.lastActiveAt || a.lastActive);
      return tb - ta;
    })
    .slice(0, 10);
}

/**
 * Real Top 5 Reporters ONLY (used for End-of-Month Freeze & bonus declaration).
 */
export function sortTop5RealReporters(stats: UserUsageStat[]): UserUsageStat[] {
  return stats
    .filter((s) => isEligibleForTop10(s) && (s.verifiedReports || 0) > 0)
    .map((s) => ({
      ...s,
      guardScore: getEffectiveGuardScore(s),
    }))
    .sort((a, b) => {
      const diffRep = (b.verifiedReports || 0) - (a.verifiedReports || 0);
      if (diffRep !== 0) return diffRep;
      return (b.guardScore ?? 0) - (a.guardScore ?? 0);
    })
    .slice(0, 5);
}

/**
 * Display Top Users Leaderboard:
 * 1. Real ACTIVE subscribers ALWAYS appear FIRST (sorted by guardScore desc).
 * 2. Starter Guards (if showStarterInApp === true) appear AFTER real active subscribers,
 *    with daily midnight WAT shuffle (-20..+30) and auto slide-down score adjustment
 *    so real active subscribers always outrank Starter Guards cleanly.
 */
export function buildTopUsersDisplayList(
  stats: UserUsageStat[],
  showStarterInApp: boolean
): UserUsageStat[] {
  const realSubscribers = stats
    .filter((s) => !isStarterEntity(s) && !s.cheatingFlagged && getEffectiveSubscription(s).isSubscriber)
    .map((s) => ({
      ...s,
      guardScore: getEffectiveGuardScore(s),
      isStarter: false,
      isRealUser: true,
    }))
    .sort((a, b) => {
      const diff = (b.guardScore ?? 0) - (a.guardScore ?? 0);
      if (diff !== 0) return diff;
      return toMillisSafe(b.lastActiveAt || b.lastActive) - toMillisSafe(a.lastActiveAt || a.lastActive);
    });

  if (!showStarterInApp) {
    return realSubscribers;
  }

  const startersRaw = stats
    .filter((s) => isStarterEntity(s) && !s.cheatingFlagged)
    .map((s) => ({
      ...s,
      guardScore: getEffectiveGuardScore(s),
      isStarter: true,
      isRealUser: false,
      canWinPayout: false,
    }))
    .sort((a, b) => (b.guardScore ?? 0) - (a.guardScore ?? 0));

  if (startersRaw.length === 0) {
    return realSubscribers;
  }

  if (realSubscribers.length === 0) {
    return startersRaw;
  }

  const minRealScore = realSubscribers[realSubscribers.length - 1]?.guardScore ?? 0;
  const maxStarterScore = startersRaw[0]?.guardScore ?? 0;

  let adjustedStarters = startersRaw;
  if (minRealScore <= maxStarterScore) {
    // Auto Slide-Down: scale starter scores cleanly below the lowest real active subscriber
    if (minRealScore <= 10) {
      adjustedStarters = startersRaw.map((s) => ({
        ...s,
        guardScore: Math.max(0, minRealScore - 1),
      }));
    } else {
      const capTop = minRealScore - 5;
      const capFloor = Math.max(1, Math.floor(capTop * 0.25));
      const span = Math.max(1, startersRaw.length - 1);
      adjustedStarters = startersRaw.map((s, idx) => ({
        ...s,
        guardScore: Math.max(
          1,
          Math.round(capTop - ((capTop - capFloor) * idx) / span)
        ),
      }));
    }
  }

  return [...realSubscribers, ...adjustedStarters];
}

/**
 * Display Top Reporters Leaderboard:
 * Real active subscribers appear FIRST sorted by verifiedReports desc,
 * followed by Starter Guards (if showStarterInApp) with daily WAT report shift (-1..+2).
 */
export function buildTopReportersDisplayList(
  stats: UserUsageStat[],
  showStarterInApp: boolean
): UserUsageStat[] {
  const todayKey = getWatDateKey();

  const realSubscribers = stats
    .filter(
      (s) =>
        !isStarterEntity(s) &&
        !s.cheatingFlagged &&
        getEffectiveSubscription(s).isSubscriber &&
        (s.verifiedReports || 0) > 0
    )
    .map((s) => ({
      ...s,
      guardScore: getEffectiveGuardScore(s),
      isStarter: false,
      isRealUser: true,
    }))
    .sort((a, b) => {
      const diff = (b.verifiedReports || 0) - (a.verifiedReports || 0);
      if (diff !== 0) return diff;
      return (b.guardScore ?? 0) - (a.guardScore ?? 0);
    });

  if (!showStarterInApp) {
    return realSubscribers;
  }

  const startersRaw = stats
    .filter((s) => isStarterEntity(s) && !s.cheatingFlagged)
    .map((s) => {
      const seed = STARTER_GUARDS_56.find((x) => x.uid === s.userId);
      const { reportDelta } = getStarterDailyDelta(s.userId, todayKey);
      const verified =
        s.lastActiveDate === todayKey && typeof s.verifiedReports === 'number'
          ? Math.max(1, s.verifiedReports)
          : Math.max(1, (seed?.baseReports ?? s.verifiedReports ?? 1) + reportDelta);
      const total = Math.max(verified, Number(s.totalReports || seed?.totalReports || verified));
      return {
        ...s,
        verifiedReports: verified,
        totalReports: total,
        guardScore: getEffectiveGuardScore(s),
        isStarter: true,
        isRealUser: false,
        canWinPayout: false,
      };
    })
    .sort((a, b) => {
      const diff = (b.verifiedReports || 0) - (a.verifiedReports || 0);
      if (diff !== 0) return diff;
      return (b.guardScore ?? 0) - (a.guardScore ?? 0);
    });

  return [...realSubscribers, ...startersRaw];
}

export function buildEndOfMonthWinnerSummary(
  stats: UserUsageStat[],
  monthKey: string = getWatMonthKey()
): {
  month: string;
  monthName: string;
  topUsers: MonthlyFrozenWinnerUser[];
  topReporters: MonthlyFrozenWinnerReporter[];
  frozenAt: string;
} {
  const realTopUsers = sortTop10Guardians(stats).map((w, idx) => ({
    rank: idx + 1,
    userId: w.userId,
    name: w.name,
    city: w.city || w.state || 'Nigeria',
    state: w.state || w.city || 'Nigeria',
    guardScore: getEffectiveGuardScore(w),
    prize: 10000,
    photoURL: w.profilePicUrl || w.avatar || '',
  }));

  const realTopReporters = sortTop5RealReporters(stats).map((r, idx) => ({
    rank: idx + 1,
    userId: r.userId,
    name: r.name,
    state: r.state || r.city || 'Nigeria',
    totalReports: r.totalReports || r.verifiedReports || 0,
    verifiedReports: r.verifiedReports || 0,
    guardScore: getEffectiveGuardScore(r),
    photoURL: r.profilePicUrl || r.avatar || '',
  }));

  const monthName = new Date().toLocaleDateString('en-US', {
    month: 'long',
    timeZone: 'Africa/Lagos',
  });

  return {
    month: monthKey,
    monthName,
    topUsers: realTopUsers,
    topReporters: realTopReporters,
    frozenAt: new Date().toISOString(),
  };
}

export function isEndOfMonthFreezeWindowWat(nowMs: number = Date.now()): boolean {
  const watMs = nowMs + 60 * 60 * 1000;
  const d = new Date(watMs);
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth();
  const day = d.getUTCDate();
  const lastDayOfMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const hour = d.getUTCHours();
  const minute = d.getUTCMinutes();
  return day === lastDayOfMonth && hour === 23 && minute >= 59;
}

export function generateReferralCode(fullName: string, uid: string): string {
  const prefix =
    (fullName || 'GRD')
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
      .slice(0, 3)
      .padEnd(3, 'G');
  const suffix = (uid || '000')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(-3)
    .padStart(3, 'X');
  return `${prefix}${suffix}`;
}

export function applyVerifiedReportBreakdown(
  existing: MonthlyGuardBreakdown | null | undefined,
  incidentType: string,
  hasMedia: boolean
): { nextBreakdown: MonthlyGuardBreakdown; delta: number; capped: boolean } {
  const b = normalizeBreakdown(existing);
  const todayKey = getWatDateKey();
  const reportsToday = b.reportsScoredDayKey === todayKey ? b.reportsScoredTodayCount : 0;

  if (reportsToday >= 3) {
    return { nextBreakdown: b, delta: 0, capped: true };
  }

  const upper = (incidentType || '').toUpperCase();
  const isCritical =
    upper.includes('GUNSHOT') || upper.includes('ROBBERY') || upper.includes('KIDNAP');

  const next: MonthlyGuardBreakdown = {
    ...b,
    reportsScoredDayKey: todayKey,
    reportsScoredTodayCount: reportsToday + 1,
    verifiedGunshotRobberyKidnapReports:
      b.verifiedGunshotRobberyKidnapReports + (isCritical ? 1 : 0),
    verifiedOtherReports: b.verifiedOtherReports + (isCritical ? 0 : 1),
    verifiedReportMediaBonusCount: b.verifiedReportMediaBonusCount + (hasMedia ? 1 : 0),
  };

  const delta = (isCritical ? 100 : 50) + (hasMedia ? 20 : 0);
  return { nextBreakdown: next, delta, capped: false };
}

export function applyFalseReportPenaltyBreakdown(
  existing: MonthlyGuardBreakdown | null | undefined
): { nextBreakdown: MonthlyGuardBreakdown; delta: number } {
  const b = normalizeBreakdown(existing);
  return {
    nextBreakdown: {
      ...b,
      falseRejectedReportsCount: b.falseRejectedReportsCount + 1,
    },
    delta: -250,
  };
}

export function applySubscribedReferralBreakdown(
  existing: MonthlyGuardBreakdown | null | undefined
): { nextBreakdown: MonthlyGuardBreakdown; delta: number } {
  const b = normalizeBreakdown(existing);
  return {
    nextBreakdown: {
      ...b,
      subscribedReferralsCount: b.subscribedReferralsCount + 1,
    },
    delta: 200,
  };
}

export type GuardScoreAction =
  | 'road_scan'
  | 'road_safe_finish'
  | 'building_scan'
  | 'building_danger_avoid'
  | 'vehicle_scan'
  | 'vehicle_stolen_avoid'
  | 'night_watch_scan'
  | 'night_watch_threat'
  | 'family_active_day'
  | 'family_safe_arrival'
  | 'family_member_added'
  | 'safe_route'
  | 'community_verification'
  | 'community_upvote'
  | 'daily_checkin';

export interface GuardScoreResult {
  awarded: boolean;
  delta: number;
  guardScore: number;
  reason?: string;
}

export async function awardGuardScoreEvent(params: {
  uid: string;
  action: GuardScoreAction;
  userName: string;
  userAvatar?: string;
  city?: string;
  state?: string;
}): Promise<GuardScoreResult> {
  const { uid, action, userName, userAvatar, city, state } = params;
  if (!uid || uid.startsWith('starter_guard_')) {
    return { awarded: false, delta: 0, guardScore: 0, reason: 'Invalid UID' };
  }

  const month = getWatMonthKey();
  const todayKey = getWatDateKey();
  const nightKey = getNightWatchKeyWat();
  const statId = `${uid}_${month}`;
  const statRef = doc(db, 'user_usage_stats', statId);
  const userRef = doc(db, 'users', uid);

  try {
    const [statSnap, userSnap] = await Promise.all([getDoc(statRef), getDoc(userRef)]);
    const statData = statSnap.exists() ? (statSnap.data() as Partial<UserUsageStat>) : null;
    const userData = userSnap.exists() ? userSnap.data() : null;

    const b = normalizeBreakdown(statData?.monthlyBreakdown || userData?.monthlyBreakdown);
    let delta = 0;
    let label = '';
    const next = { ...b };

    switch (action) {
      case 'road_scan': {
        const count = b.roadScansDayKey === todayKey ? b.roadScansTodayCount : 0;
        if (count >= 3) return { awarded: false, delta: 0, guardScore: calculateMonthlyGuardScore(b).guardScore, reason: 'Daily limit (3/day) reached' };
        next.roadScansDayKey = todayKey;
        next.roadScansTodayCount = count + 1;
        next.roadScansCount += 1;
        delta = 30;
        label = 'Road Scanner (+30)';
        break;
      }
      case 'road_safe_finish': {
        const count = b.roadScansDayKey === todayKey ? b.roadScansTodayCount : 0;
        if (count > 3) return { awarded: false, delta: 0, guardScore: calculateMonthlyGuardScore(b).guardScore, reason: 'Daily limit reached' };
        next.roadSafeTripFinishCount += 1;
        delta = 10;
        label = 'Road Scan Safe Finish (+10)';
        break;
      }
      case 'building_scan': {
        const count = b.buildingScansDayKey === todayKey ? b.buildingScansTodayCount : 0;
        if (count >= 3) return { awarded: false, delta: 0, guardScore: calculateMonthlyGuardScore(b).guardScore, reason: 'Daily limit (3/day) reached' };
        next.buildingScansDayKey = todayKey;
        next.buildingScansTodayCount = count + 1;
        next.buildingScansCount += 1;
        delta = 30;
        label = 'Building Scanner (+30)';
        break;
      }
      case 'building_danger_avoid': {
        next.buildingDangerAvoidCount += 1;
        delta = 20;
        label = 'Building Danger Avoided (+20)';
        break;
      }
      case 'vehicle_scan': {
        const count = b.vehicleScansDayKey === todayKey ? b.vehicleScansTodayCount : 0;
        if (count >= 3) return { awarded: false, delta: 0, guardScore: calculateMonthlyGuardScore(b).guardScore, reason: 'Daily limit (3/day) reached' };
        next.vehicleScansDayKey = todayKey;
        next.vehicleScansTodayCount = count + 1;
        next.vehicleScansCount += 1;
        delta = 30;
        label = 'Vehicle Scanner (+30)';
        break;
      }
      case 'vehicle_stolen_avoid': {
        next.vehicleStolenAvoidCount += 1;
        delta = 50;
        label = 'Suspicious/Stolen Vehicle Avoided (+50)';
        break;
      }
      case 'night_watch_scan': {
        if (!isNightWatchWindowWat()) {
          return {
            awarded: false,
            delta: 0,
            guardScore: calculateMonthlyGuardScore(b).guardScore,
            reason: 'Night Watch Guard Score only applies between 7:00 PM and 6:00 AM WAT.',
          };
        }
        const count = b.nightWatchNightKey === nightKey ? b.nightWatchNightCount : 0;
        if (count >= 2) {
          return {
            awarded: false,
            delta: 0,
            guardScore: calculateMonthlyGuardScore(b).guardScore,
            reason: 'Night Watch cap (2/night) reached',
          };
        }
        next.nightWatchNightKey = nightKey;
        next.nightWatchNightCount = count + 1;
        next.nightWatchScansCount += 1;
        delta = 50;
        label = 'Night Watch Session (+50)';
        break;
      }
      case 'night_watch_threat': {
        if (!isNightWatchWindowWat()) {
          return {
            awarded: false,
            delta: 0,
            guardScore: calculateMonthlyGuardScore(b).guardScore,
            reason: 'Outside 7pm–6am WAT Night Watch window',
          };
        }
        next.nightWatchThreatFoundCount += 1;
        delta = 50;
        label = 'Night Watch Threat Detected (+50)';
        break;
      }
      case 'family_active_day': {
        if (b.familyActiveLastDayKey === todayKey) {
          return { awarded: false, delta: 0, guardScore: calculateMonthlyGuardScore(b).guardScore };
        }
        next.familyActiveLastDayKey = todayKey;
        next.familyActiveDaysCount += 1;
        next.familyStreakCount += 1;
        delta = 25;
        label = 'Family Tracking Active Day (+25)';
        if (next.familyStreakCount > 0 && next.familyStreakCount % 7 === 0) {
          next.familySevenDayStreaksCount += 1;
          delta += 50;
          label = 'Family Active Day + 7-Day Streak (+75)';
        }
        break;
      }
      case 'family_safe_arrival': {
        next.familySafeArrivalsCount += 1;
        delta = 15;
        label = 'Family Safe Arrival (+15)';
        break;
      }
      case 'family_member_added': {
        if (b.familyVerifiedMembersCount >= 5) {
          return { awarded: false, delta: 0, guardScore: calculateMonthlyGuardScore(b).guardScore, reason: 'Max 5 verified family members scored' };
        }
        next.familyVerifiedMembersCount += 1;
        delta = 100;
        label = 'Verified Family Member Added (+100)';
        break;
      }
      case 'safe_route': {
        const count = b.safeRoutesDayKey === todayKey ? b.safeRoutesTodayCount : 0;
        if (count >= 2) return { awarded: false, delta: 0, guardScore: calculateMonthlyGuardScore(b).guardScore, reason: 'Daily limit (2/day) reached' };
        next.safeRoutesDayKey = todayKey;
        next.safeRoutesTodayCount = count + 1;
        next.safeRoutesUsedCount += 1;
        delta = 20;
        label = 'Safe Route Used (+20)';
        break;
      }
      case 'community_verification': {
        next.communityVerificationsCorrectCount += 1;
        delta = 15;
        label = 'Community Verification (+15)';
        break;
      }
      case 'community_upvote': {
        const count = b.upvotesDayKey === todayKey ? (b.upvotesTodayCount || 0) : 0;
        if (count >= 10) {
          return {
            awarded: false,
            delta: 0,
            guardScore: calculateMonthlyGuardScore(b).guardScore,
            reason: 'Daily upvote score cap reached',
          };
        }
        next.upvotesDayKey = todayKey;
        next.upvotesTodayCount = count + 1;
        next.communityUpvotesCount = (b.communityUpvotesCount || 0) + 1;
        delta = 20;
        label = 'Verified Alert Upvote (+20)';
        break;
      }
      case 'daily_checkin': {
        if (b.lastCheckInDate === todayKey || userData?.dailyCheckInDate === todayKey) {
          return {
            awarded: false,
            delta: 0,
            guardScore: calculateMonthlyGuardScore(b).guardScore,
            reason: 'Already checked in today!',
          };
        }
        next.lastCheckInDate = todayKey;
        next.dailyCheckInsCount += 1;
        delta = 10;
        label = 'Daily Check-in "I Am Safe" (+10)';
        break;
      }
    }

    const { guardScore } = calculateMonthlyGuardScore(next, Date.now());
    const prevHistory: ScoreHistoryEntry[] = Array.isArray(statData?.scoreHistory)
      ? statData.scoreHistory
      : [];
    const nextHistory: ScoreHistoryEntry[] = [
      { action: label, delta, at: new Date().toISOString() },
      ...prevHistory,
    ].slice(0, 30);

    if (statSnap.exists()) {
      await updateDoc(statRef, {
        name: userName || statData?.name || 'Guard AI Member',
        ...(userAvatar ? { avatar: userAvatar, profilePicUrl: userAvatar } : {}),
        ...(city !== undefined ? { city } : {}),
        ...(state !== undefined ? { state } : {}),
        guardScore,
        monthlyBreakdown: next,
        scoreHistory: nextHistory,
        lastActive: serverTimestamp(),
        lastActiveAt: serverTimestamp(),
      });
    } else {
      await setDoc(statRef, {
        userId: uid,
        name: userName || 'Guard AI Member',
        avatar: userAvatar || '',
        profilePicUrl: userAvatar || '',
        city: city || '',
        state: state || '',
        subscriptionPlan: 'FREE',
        subscriptionStatus: 'free',
        totalScans: 0,
        totalReports: 0,
        verifiedReports: 0,
        totalUsageDays: 1,
        lastActiveDate: todayKey,
        totalUsageMinutes: 0,
        totalPoints: 20,
        guardScore,
        monthlyBreakdown: next,
        scoreHistory: nextHistory,
        month,
        cheatingFlagged: false,
        isStarter: false,
        isRealUser: true,
        lastActive: serverTimestamp(),
        lastActiveAt: serverTimestamp(),
      });
    }

    const userUpdate: Record<string, unknown> = {
      guardScore,
      guardScoreMonth: month,
      monthlyBreakdown: next,
      lastActive: serverTimestamp(),
      lastActiveAt: serverTimestamp(),
    };
    if (action === 'daily_checkin') {
      userUpdate.dailyCheckInDate = todayKey;
    }
    await updateDoc(userRef, userUpdate).catch(() => {});

    return { awarded: true, delta, guardScore };
  } catch (err) {
    console.warn('Guard score update non-blocking warning:', err);
    return { awarded: false, delta: 0, guardScore: 0 };
  }
}
