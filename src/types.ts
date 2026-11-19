export type AppTab = 'home' | 'family' | 'weapon' | 'alerts' | 'safe_business' | 'me' | 'admin';
export type ScannerSubTab = 'road' | 'vehicle' | 'building' | 'night_watch';
export type MovementMode = 'Walking' | 'In Vehicle' | 'In Building';
export type PlanType = 'Free' | 'Monthly' | 'Yearly';

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
  userState?: string;
  bio?: string;
  photoURL?: string;
  profilePicUrl?: string;
  emergencyContact?: string;
  role: 'user' | 'admin' | 'banned';
  safetyScore: number;
  trust_score: number;
  streak: number;
  subscription?: 'free' | 'active' | 'pending' | 'expired';
  verifiedBadge?: boolean;
  followersCount?: number;
  followingCount?: number;
  walletBalance?: number;
  lastStreakDate?: string;
  lastActive?: any;
  createdAt?: any;
}

export interface PublicProfile {
  userId: string;
  fullName: string;
  username?: string;
  bio?: string;
  city?: string;
  userState?: string;
  photoURL?: string;
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
  createdAt?: any;
}

export interface SubscriptionDoc {
  id: string;
  userId: string;
  plan: PlanType;
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
  createdAt?: any;
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
  totalScans: number;
  totalReports: number;
  verifiedReports: number;
  totalUsageDays: number;
  lastActiveDate?: string;
  totalUsageMinutes: number;
  totalPoints: number;
  month: string;
  cheatingFlagged?: boolean;
  lastActive?: any;
}

export interface OPaySettings {
  bankName: string;
  accountName: string;
  accountNumber: string;
}
