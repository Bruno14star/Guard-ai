export type AppTab = 'home' | 'family' | 'weapon' | 'alerts' | 'safe_business' | 'me' | 'admin';
export type ScannerSubTab = 'road' | 'vehicle' | 'building' | 'night_watch';
export type MovementMode = 'Walking' | 'In Vehicle' | 'In Building';
export type PlanType = 'Free' | 'Monthly' | 'Yearly';
export type SubscriptionPlanCode = 'FREE' | 'MONTHLY_5000' | 'YEARLY_35000';
export type SubscriptionStatusType = 'active' | 'expired' | 'pending' | 'free';

export interface MonthlyGuardBreakdown {
  verifiedGunshotRobberyKidnapReports: number;
  verifiedOtherReports: number;
  verifiedReportMediaBonusCount: number;
  reportsScoredTodayCount: number;
  reportsScoredDayKey?: string;

  roadScansCount: number;
  roadSafeTripFinishCount: number;
  roadScansTodayCount: number;
  roadScansDayKey?: string;

  buildingScansCount: number;
  buildingDangerAvoidCount: number;
  buildingScansTodayCount: number;
  buildingScansDayKey?: string;

  vehicleScansCount: number;
  vehicleStolenAvoidCount: number;
  vehicleScansTodayCount: number;
  vehicleScansDayKey?: string;

  nightWatchScansCount: number;
  nightWatchThreatFoundCount: number;
  nightWatchNightCount: number;
  nightWatchNightKey?: string;

  familyActiveDaysCount: number;
  familyActiveLastDayKey?: string;
  familyStreakCount: number;
  familySevenDayStreaksCount: number;
  familySafeArrivalsCount: number;
  familyVerifiedMembersCount: number;

  safeRoutesUsedCount: number;
  safeRoutesTodayCount: number;
  safeRoutesDayKey?: string;

  communityVerificationsCorrectCount: number;
  communityUpvotesCount?: number;
  upvotesTodayCount?: number;
  upvotesDayKey?: string;
  dailyCheckInsCount: number;
  lastCheckInDate?: string;

  subscribedReferralsCount: number;
  falseRejectedReportsCount: number;
}

export interface ScoreHistoryEntry {
  action: string;
  delta: number;
  at: string;
}

export interface HumanLocation {
  lat: number;
  lng: number;
  accuracy: number;
  formattedAddress: string;
  streetName: string;
  area: string;
  city: string;
  state: string;
  landmark: string;
  heading: number | null;
  speedMps: number;
  movementMode: MovementMode;
  buildingName?: string;
}

export interface UserProfile {
  uid: string;
  fullName: string;
  username?: string;
  phone?: string;
  email?: string;
  city?: string;
  state?: string;
  userState?: string;
  locationSource?: 'gps' | 'manual';
  locationUpdatedAt?: any;
  locationMigrated?: boolean;
  lastLat?: number;
  lastLng?: number;
  bio?: string;
  photoURL?: string;
  profilePicUrl?: string;
  profilePicUpdatedAt?: any;
  emergencyContact?: string;
  role: 'user' | 'admin' | 'banned';
  safetyScore: number;
  trust_score: number;
  streak: number;
  subscription?: 'free' | 'active' | 'pending' | 'expired';
  subscriptionPlan?: SubscriptionPlanCode;
  subscriptionStatus?: SubscriptionStatusType;
  subscriptionExpiresAt?: any;
  verifiedBadge?: boolean;
  tutorialSeen?: boolean;
  followersCount?: number;
  followingCount?: number;
  walletBalance?: number;
  availableBalanceNaira?: number;
  totalEarnedNaira?: number;
  guardScore?: number;
  guardScoreMonth?: string;
  monthlyBreakdown?: MonthlyGuardBreakdown;
  dailyCheckInDate?: string;
  referralCode?: string;
  referredByCode?: string;
  referredByUid?: string;
  falseReportsThisMonth?: number;
  falseReportMonth?: string;
  reportEarnSuspendedUntil?: any;
  lastStreakDate?: string;
  lastReportAt?: any;
  flaggedReporter?: boolean;
  flaggedReportId?: string;
  flaggedReason?: string;
  flaggedAt?: any;
  lastActive?: any;
  lastActiveAt?: any;
  createdAt?: any;
  isStarter?: boolean;
  isRealUser?: boolean;
  canWinPayout?: boolean;
  authProvider?: string;
  starterRank?: number;
  totalReports?: number;
  verifiedReports?: number;
}

export interface PublicProfile {
  userId: string;
  fullName: string;
  username?: string;
  bio?: string;
  city?: string;
  state?: string;
  userState?: string;
  photoURL?: string;
  profilePicUrl?: string;
  verifiedBadge?: boolean;
  trust_score: number;
  safetyScore: number;
  streak: number;
  followersCount: number;
  followingCount: number;
  totalReports: number;
  verifiedReports: number;
  totalScans: number;
  joinedAt?: any;
  isStarter?: boolean;
  isRealUser?: boolean;
  canWinPayout?: boolean;
  guardScore?: number;
}

export interface FamilyMember {
  id: string;
  ownerId: string;
  memberName: string;
  memberPhone: string;
  relationship: string;
  photoURL?: string;
  lastLat?: number;
  lastLng?: number;
  lastAddress?: string;
  isOnline?: boolean;
  status: 'Safe' | 'SOS';
  lastSeen?: any;
}

export interface ScannerLog {
  id: string;
  userId: string;
  lat?: number;
  lng?: number;
  buildingLat?: number;
  buildingLng?: number;
  address?: string;
  vehicleType?: string;
  floorsDetected?: number;
  sensorValue?: number;
  frequency?: number;
  confidence?: number;
  safeScore?: number;
  distance?: number;
  direction?: string;
  status: string;
  createdAt?: any;
}

export interface AlertItem {
  id: string;
  userId?: string;
  userName?: string;
  userProfilePic?: string;
  type: string;
  title?: string;
  description?: string;
  address: string;
  incidentState?: string;
  incidentArea?: string;
  lat?: number;
  lng?: number;
  confidence?: number;
  status: 'New' | 'Seen' | 'Resolved';
  videoUrl?: string;
  photoUrl?: string;
  verifiedByGuardAI: boolean;
  reportId?: string;
  falseCount?: number;
  falseBy?: string[];
  isHidden?: boolean;
  createdAt?: any;
}

export interface SubscriptionDoc {
  id: string;
  userId: string;
  plan: PlanType | SubscriptionPlanCode;
  status: 'active' | 'pending' | 'expired' | 'rejected';
  amount: number;
  createdAt?: any;
  expiresAt?: any;
}

export interface PaymentDoc {
  id: string;
  userId: string;
  userName?: string;
  plan: 'Monthly' | 'Yearly';
  amount: number;
  purpose?: string;
  receiptImage: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  createdAt?: any;
  reviewedAt?: any;
}

export interface IncidentReport {
  id: string;
  reportId?: string;
  userId: string;
  userName?: string;
  userPhone?: string;
  userState?: string;
  userProfilePic?: string;
  incidentState?: string;
  incidentArea?: string;
  incidentAddress: string;
  incidentType: string;
  description?: string;
  videoUrl?: string;
  videoDurationSec?: number;
  photoUrl?: string;
  gpsLat?: number;
  gpsLng?: number;
  videoAuthScore?: number;
  audioMatchScore?: number;
  locationConsistencyScore?: number;
  crossReportScore?: number;
  guardAiScore?: number;
  aiVerdict?: string;
  status: string;
  adminDecision?: string;
  adminName?: string;
  adminReason?: string;
  approvedAt?: any;
  paymentStatus?: 'unpaid' | 'paid';
  forwardedTo?: string;
  forwardedAt?: any;
  forwardedState?: string;
  visibleOnMap?: boolean;
  device?: string;
  falseCount?: number;
  falseBy?: string[];
  isHidden?: boolean;
  createdAt?: any;
}

export interface ReportAuditLog {
  id: string;
  reportId: string;
  userId: string;
  incidentType: string;
  device: string;
  status: string;
  action: string;
  timestamp?: any;
}

export interface PoliceStation {
  id: string;
  state: string;
  area: string;
  stationName: string;
  phone1: string;
  phone2: string;
  isVerified: boolean;
  isActive: boolean;
}

export interface SafeBusiness {
  id: string;
  businessName: string;
  type: 'Church' | 'School' | 'Mall' | 'Hospital' | 'Office' | 'Market';
  lat?: number;
  lng?: number;
  address: string;
  rating?: number;
  verified: boolean;
  safeScore?: number;
  ownerId: string;
  createdAt?: any;
}

export interface HomeVideo {
  id: string;
  reportId: string;
  userId: string;
  userName: string;
  userProfilePic?: string;
  videoUrl: string;
  incidentType: string;
  incidentState?: string;
  incidentArea?: string;
  incidentAddress: string;
  views: number;
  likes: number;
  likedBy?: string[];
  verifiedAt?: any;
}

export interface UserUsageStat {
  id: string;
  userId: string;
  name: string;
  avatar?: string;
  profilePicUrl?: string;
  city?: string;
  state?: string;
  subscriptionPlan?: SubscriptionPlanCode;
  subscriptionStatus?: SubscriptionStatusType;
  subscriptionExpiresAt?: any;
  totalScans: number;
  totalReports: number;
  verifiedReports: number;
  totalUsageDays: number;
  lastActiveDate?: string;
  totalUsageMinutes: number;
  totalPoints: number;
  guardScore?: number;
  monthlyBreakdown?: MonthlyGuardBreakdown;
  scoreHistory?: ScoreHistoryEntry[];
  month: string;
  cheatingFlagged?: boolean;
  lastActive?: any;
  lastActiveAt?: any;
  isStarter?: boolean;
  isRealUser?: boolean;
  canWinPayout?: boolean;
  starterRank?: number;
  authProvider?: string;
  createdAt?: any;
}

export interface ReferralDoc {
  id: string;
  referredUid: string;
  referredName?: string;
  referrerUid?: string;
  referrerCode: string;
  status: 'PENDING' | 'SUBSCRIBED' | 'Reward Paid';
  subscriptionStatus?: string;
  subscribedPlan?: string;
  rewardPaid: boolean;
  rewardAmount: number;
  rewardNote?: string;
  createdAt?: any;
  subscribedAt?: any;
}

export interface LeaderboardHistoryDoc {
  id: string;
  month: string;
  totalPaid: number;
  winners: {
    rank: number;
    userId: string;
    name: string;
    city: string;
    guardScore: number;
    prize: number;
  }[];
  paidByAdminId?: string;
  paidAt?: any;
}

export interface OPaySettings {
  bankName: string;
  accountName: string;
  accountNumber: string;
}

export interface MonthlyFrozenWinnerUser {
  rank: number;
  userId: string;
  name: string;
  city: string;
  state: string;
  guardScore: number;
  prize: number;
  photoURL?: string;
}

export interface MonthlyFrozenWinnerReporter {
  rank: number;
  userId: string;
  name: string;
  state: string;
  totalReports: number;
  verifiedReports: number;
  guardScore: number;
  photoURL?: string;
}

export interface StarterGuardsSettings {
  showInApp: boolean;
  starterRemoved: boolean;
  lastShuffleDate?: string;
  frozenMonth?: string;
  monthlyWinnerSummary?: {
    month: string;
    monthName: string;
    topUsers: MonthlyFrozenWinnerUser[];
    topReporters: MonthlyFrozenWinnerReporter[];
    frozenAt: string;
  };
}

