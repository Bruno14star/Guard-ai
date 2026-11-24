import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  addDoc,
  collection,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import {
  ShieldCheck,
  MapPin,
  Radio,
  Car,
  Building2,
  Moon,
  Heart,
  Share2,
  MessageCircle,
  Send,
  AlertOctagon,
  Award,
  Flame,
  Sparkles,
  PhoneCall,
  Trophy,
  CheckCircle2,
  Crown,
  X,
  ChevronRight,
  Search,
} from 'lucide-react';
import { db, handleFirestoreError, OperationType } from '../firebase';
import {
  AlertItem,
  HomeVideo,
  HumanLocation,
  PlanType,
  PublicProfile,
  ScannerSubTab,
  StarterGuardsSettings,
  UserProfile,
  UserUsageStat,
} from '../types';
import { FALSE_REPORT_HIDE_THRESHOLD, getDeviceAuditInfo } from '../utils/antiSpam';
import {
  findNearestSafePlaceFree,
  formatCityStateLabel,
  getWatDateKey,
  getWatMonthKey,
} from '../utils/geoPhysics';
import {
  awardGuardScoreEvent,
  buildEndOfMonthWinnerSummary,
  buildTopReportersDisplayList,
  buildTopUsersDisplayList,
  getEffectiveGuardScore,
  getEffectiveSubscription,
  isEndOfMonthFreezeWindowWat,
} from '../utils/guardScore';
import { useGlobalUserProfile } from '../utils/userProfileStore';
import { GuardMap, MapPinItem } from './GuardMap';
import { UserAvatar } from './UserAvatar';
import { AdBanner } from './AdBanner';

interface HomeTabProps {
  user: UserProfile;
  location: HumanLocation | null;
  scansToday: number;
  activePlan: PlanType;
  usageStatDocId: string | null;
  onRefreshLocation: (lat: number, lng: number, accuracy: number) => void;
  onSetMyLocation: () => Promise<boolean>;
  onNavigateScanner: (sub: ScannerSubTab) => void;
  onOpenSubscriptions: () => void;
  onOpenReportModal: () => void;
  onOpenProfile: (uid: string) => void;
  openSosSignal?: number;
}

interface CommentItem {
  id: string;
  videoId: string;
  userId: string;
  userName: string;
  text: string;
}

export const HomeTab: React.FC<HomeTabProps> = ({
  user,
  location,
  scansToday,
  activePlan,
  onRefreshLocation,
  onSetMyLocation,
  onNavigateScanner,
  onOpenSubscriptions,
  onOpenReportModal,
  onOpenProfile,
  openSosSignal,
}) => {
  const userPhoto = user.profilePicUrl || user.photoURL || '';
  const globalProfile = useGlobalUserProfile(user.fullName, userPhoto);
  const displayName = globalProfile.name || user.fullName;
  const displayPhoto = globalProfile.photo || userPhoto;

  const [sansaTips, setSansaTips] = useState<{ id: string; message: string; title?: string }[]>([]);
  const [goodWishBanner, setGoodWishBanner] = useState<string | null>(null);
  const [homeVideos, setHomeVideos] = useState<HomeVideo[]>([]);
  const [topTrusted, setTopTrusted] = useState<PublicProfile[]>([]);
  const [monthlyStats, setMonthlyStats] = useState<UserUsageStat[]>([]);
  const [openCommentsFor, setOpenCommentsFor] = useState<string | null>(null);
  const [comments, setComments] = useState<CommentItem[]>([]);
  const [commentInput, setCommentInput] = useState('');
  const [sosOpen, setSosOpen] = useState(false);
  const [sosDispatching, setSosDispatching] = useState(false);
  const [sosSafePlaceName, setSosSafePlaceName] = useState<string>('Nearest Public Safe Place');
  const [sosSentConfirmation, setSosSentConfirmation] = useState(false);
  const [verifiedMapAlerts, setVerifiedMapAlerts] = useState<AlertItem[]>([]);
  const [settingLoc, setSettingLoc] = useState(false);
  const [checkInMsg, setCheckInMsg] = useState<string | null>(null);
  const [checkingIn, setCheckingIn] = useState(false);
  const [starterSettings, setStarterSettings] = useState<StarterGuardsSettings>({
    showInApp: true,
    starterRemoved: false,
  });
  const [showAllUsersModal, setShowAllUsersModal] = useState(false);
  const [showAllReportersModal, setShowAllReportersModal] = useState(false);
  const [winnerModalOpen, setWinnerModalOpen] = useState(false);
  const [allListSearch, setAllListSearch] = useState('');
  const viewIncrementedRef = useRef<Set<string>>(new Set());

  const subInfo = useMemo(() => getEffectiveSubscription(user), [user]);
  const currentMonthYearLabel = useMemo(
    () => new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
    []
  );
  const currentMonthKey = getWatMonthKey();
  const todayKey = getWatDateKey();
  const alreadyCheckedInToday = user.dailyCheckInDate === todayKey;

  // 1. Live Daily Tip from Sansa
  useEffect(() => {
    const q = query(collection(db, 'sansa_memory'), where('isPublicTip', '==', true), limit(5));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const list = snap.docs.map((d) => ({
          id: d.id,
          message: String(d.data().message || d.data().tip || ''),
          title: d.data().title ? String(d.data().title) : undefined,
        }));
        setSansaTips(list.filter((t) => t.message));
      },
      (err) => {
        console.warn('Sansa tip listener:', err.message);
      }
    );
    return () => unsub();
  }, []);

  // 2. Live Broadcast / Good Wish notification
  useEffect(() => {
    const q = query(collection(db, 'notifications'), where('targetAll', '==', true), limit(5));
    const unsub = onSnapshot(
      q,
      (snap) => {
        if (snap.empty) {
          setGoodWishBanner(null);
          return;
        }
        const sorted = [...snap.docs].sort((a, b) => {
          const ta = a.data().createdAt?.toMillis ? a.data().createdAt.toMillis() : 0;
          const tb = b.data().createdAt?.toMillis ? b.data().createdAt.toMillis() : 0;
          return tb - ta;
        });
        const top = sorted[0]?.data();
        setGoodWishBanner(top?.message ? String(top.message) : null);
      },
      () => {}
    );
    return () => unsub();
  }, []);

  // 3. Verified By Guard AI - Real Videos
  useEffect(() => {
    const q = query(collection(db, 'home_videos'), orderBy('verifiedAt', 'desc'), limit(20));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const list: HomeVideo[] = snap.docs.map((d) => {
          const data = d.data();
          return {
            id: d.id,
            reportId: data.reportId || d.id,
            userId: data.userId || '',
            userName: data.userName || 'Verified User',
            userProfilePic: data.userProfilePic || '',
            videoUrl: data.videoUrl || '',
            incidentType: data.incidentType || 'Incident',
            incidentState: data.incidentState || '',
            incidentArea: data.incidentArea || '',
            incidentAddress: data.incidentAddress || '',
            views: Number(data.views || 0),
            likes: Number(data.likes || 0),
            likedBy: Array.isArray(data.likedBy) ? data.likedBy : [],
            verifiedAt: data.verifiedAt,
          };
        });
        setHomeVideos(list);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'home_videos')
    );
    return () => unsub();
  }, []);

  // 4. Top 5 Users - Most Trusted
  useEffect(() => {
    const q = query(collection(db, 'public_profiles'), orderBy('trust_score', 'desc'), limit(5));
    const unsub = onSnapshot(
      q,
      (snap) => {
        setTopTrusted(snap.docs.map((d) => d.data() as PublicProfile));
      },
      () => {}
    );
    return () => unsub();
  }, []);

  // 5. Monthly user_usage_stats listener (for Top 10 Guardians & Top 5 Reporters)
  useEffect(() => {
    const currentMonth = getWatMonthKey();
    const q = query(
      collection(db, 'user_usage_stats'),
      where('month', '==', currentMonth)
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const list = snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<UserUsageStat, 'id'>),
        }));
        setMonthlyStats(list);
      },
      () => {}
    );
    return () => unsub();
  }, []);

  // 5a. Starter Guards global toggle & monthly freeze settings
  useEffect(() => {
    const unsub = onSnapshot(
      doc(db, 'app_settings', 'starter_guards'),
      (snap) => {
        if (snap.exists()) {
          const d = snap.data() as Partial<StarterGuardsSettings>;
          setStarterSettings({
            showInApp: d.showInApp !== false && !d.starterRemoved,
            starterRemoved: Boolean(d.starterRemoved),
            lastShuffleDate: d.lastShuffleDate,
            frozenMonth: d.frozenMonth,
            monthlyWinnerSummary: d.monthlyWinnerSummary,
          });
        }
      },
      () => {}
    );
    return () => unsub();
  }, []);

  // 5b. Admin-verified, non-hidden alerts ONLY show on Home Map
  useEffect(() => {
    const q = query(collection(db, 'alerts'), where('verifiedByGuardAI', '==', true));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const list: AlertItem[] = snap.docs
          .map((d) => {
            const data = d.data();
            return {
              id: d.id,
              userId: data.userId,
              userName: data.userName,
              userProfilePic: data.userProfilePic || '',
              type: data.type || 'Alert',
              title: data.title,
              description: data.description,
              address: data.address || 'Verified Alert',
              incidentState: data.incidentState,
              incidentArea: data.incidentArea,
              lat: typeof data.lat === 'number' ? data.lat : undefined,
              lng: typeof data.lng === 'number' ? data.lng : undefined,
              status: data.status || 'New',
              verifiedByGuardAI: Boolean(data.verifiedByGuardAI),
              falseCount: Number(data.falseCount || 0),
              isHidden: Boolean(data.isHidden),
              createdAt: data.createdAt,
            };
          })
          .filter((a) => !a.isHidden && (a.falseCount || 0) < FALSE_REPORT_HIDE_THRESHOLD);
        setVerifiedMapAlerts(list);
      },
      () => {}
    );
    return () => unsub();
  }, []);

  // 6. Live comments for opened video
  useEffect(() => {
    if (!openCommentsFor) return;
    const q = query(
      collection(db, 'report_comments'),
      where('videoId', '==', openCommentsFor)
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const sorted = [...snap.docs].sort((a, b) => {
          const ta = a.data().createdAt?.toMillis ? a.data().createdAt.toMillis() : 0;
          const tb = b.data().createdAt?.toMillis ? b.data().createdAt.toMillis() : 0;
          return ta - tb;
        });
        setComments(
          sorted.map((d) => ({
            id: d.id,
            videoId: String(d.data().videoId || ''),
            userId: String(d.data().userId || ''),
            userName: String(d.data().userName || 'User'),
            text: String(d.data().text || ''),
          }))
        );
      },
      () => {}
    );
    return () => unsub();
  }, [openCommentsFor]);

  const isMonthFrozen =
    starterSettings.frozenMonth === currentMonthKey || isEndOfMonthFreezeWindowWat();
  const showStarterInApp =
    starterSettings.showInApp && !starterSettings.starterRemoved && !isMonthFrozen;

  const frozenWinnerSummary = useMemo(() => {
    if (!isMonthFrozen) return null;
    if (
      starterSettings.monthlyWinnerSummary &&
      starterSettings.monthlyWinnerSummary.month === currentMonthKey
    ) {
      return starterSettings.monthlyWinnerSummary;
    }
    return buildEndOfMonthWinnerSummary(monthlyStats, currentMonthKey);
  }, [isMonthFrozen, starterSettings.monthlyWinnerSummary, currentMonthKey, monthlyStats]);

  // All Display Top Users (Real active subscribers FIRST -> Starter Guards AFTER with auto slide-down)
  const allTopUsersDisplay = useMemo(() => {
    if (frozenWinnerSummary) {
      return frozenWinnerSummary.topUsers.map((w) => ({
        id: w.userId,
        userId: w.userId,
        name: w.name,
        profilePicUrl: w.photoURL || '',
        avatar: w.photoURL || '',
        city: w.city,
        state: w.state,
        totalScans: 0,
        totalReports: 0,
        verifiedReports: 0,
        totalUsageDays: 1,
        totalUsageMinutes: 0,
        totalPoints: w.guardScore,
        guardScore: w.guardScore,
        month: currentMonthKey,
        isStarter: false,
        isRealUser: true,
      })) as UserUsageStat[];
    }
    return buildTopUsersDisplayList(monthlyStats, showStarterInApp);
  }, [frozenWinnerSummary, monthlyStats, showStarterInApp, currentMonthKey]);

  const top10Guardians = useMemo(() => allTopUsersDisplay.slice(0, 10), [allTopUsersDisplay]);

  // All Display Top Reporters (Real active subscribers FIRST -> Starter Guards AFTER)
  const allTopReportersDisplay = useMemo(() => {
    if (frozenWinnerSummary) {
      return frozenWinnerSummary.topReporters.map((r) => ({
        id: r.userId,
        userId: r.userId,
        name: r.name,
        profilePicUrl: r.photoURL || '',
        avatar: r.photoURL || '',
        city: r.state,
        state: r.state,
        totalScans: 0,
        totalReports: r.totalReports,
        verifiedReports: r.verifiedReports,
        totalUsageDays: 1,
        totalUsageMinutes: 0,
        totalPoints: r.guardScore,
        guardScore: r.guardScore,
        month: currentMonthKey,
        isStarter: false,
        isRealUser: true,
      })) as UserUsageStat[];
    }
    return buildTopReportersDisplayList(monthlyStats, showStarterInApp);
  }, [frozenWinnerSummary, monthlyStats, showStarterInApp, currentMonthKey]);

  const topReporters = useMemo(() => allTopReportersDisplay.slice(0, 5), [allTopReportersDisplay]);

  const myStatRow = useMemo(
    () => monthlyStats.find((s) => s.userId === user.uid) || null,
    [monthlyStats, user.uid]
  );
  const myGuardScore = myStatRow ? getEffectiveGuardScore(myStatRow) : user.guardScore ?? 0;

  const handleDailyCheckIn = async () => {
    if (checkingIn || alreadyCheckedInToday) return;
    setCheckingIn(true);
    const res = await awardGuardScoreEvent({
      uid: user.uid,
      action: 'daily_checkin',
      userName: displayName,
      userAvatar: displayPhoto,
      city: location?.city || user.city || '',
      state: location?.state || user.state || user.userState || '',
    });
    if (res.awarded) {
      setCheckInMsg(`Checked in! +${res.delta} Guard Score`);
    } else if (res.reason) {
      setCheckInMsg(res.reason);
    }
    setCheckingIn(false);
    window.setTimeout(() => setCheckInMsg(null), 3500);
  };

  const handleToggleLike = async (vid: HomeVideo) => {
    const likedBy = Array.isArray(vid.likedBy) ? vid.likedBy : [];
    const already = likedBy.includes(user.uid);
    const nextLikedBy = already
      ? likedBy.filter((id) => id !== user.uid)
      : [...likedBy, user.uid];
    try {
      await updateDoc(doc(db, 'home_videos', vid.id), {
        likedBy: nextLikedBy,
        likes: nextLikedBy.length,
      });
      if (!already) {
        const res = await awardGuardScoreEvent({
          uid: user.uid,
          action: 'community_upvote',
          userName: displayName,
          userAvatar: displayPhoto,
          city: location?.city || user.city || '',
          state: location?.state || user.state || user.userState || '',
        });
        if (res.awarded) {
          setCheckInMsg(`Upvoted alert! +${res.delta} Guard Score`);
          window.setTimeout(() => setCheckInMsg(null), 3000);
        }
      }
    } catch (err) {
      console.error('Like update failed:', err);
    }
  };

  const handleVideoPlay = async (vid: HomeVideo) => {
    if (viewIncrementedRef.current.has(vid.id)) return;
    viewIncrementedRef.current.add(vid.id);
    try {
      await updateDoc(doc(db, 'home_videos', vid.id), {
        views: (vid.views || 0) + 1,
      });
    } catch {
      // ignore non-critical view count failure
    }
  };

  const handleShareVideo = async (vid: HomeVideo) => {
    const text = `Guard AI Verified Alert (${vid.incidentType}) at ${vid.incidentAddress}. Stay safe!`;
    if (navigator.share) {
      await navigator.share({ title: 'Guard AI Verified Video', text }).catch(() => {});
    } else if (navigator.clipboard) {
      await navigator.clipboard.writeText(text).catch(() => {});
    }
  };

  const handleAddComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!openCommentsFor || !commentInput.trim()) return;
    try {
      await addDoc(collection(db, 'report_comments'), {
        videoId: openCommentsFor,
        userId: user.uid,
        userName: user.fullName,
        text: commentInput.trim().slice(0, 500),
        createdAt: serverTimestamp(),
      });
      setCommentInput('');
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'report_comments');
    }
  };

  const handleTriggerSos = async () => {
    setSosOpen(true);
    setSosDispatching(true);
    setSosSentConfirmation(false);

    if (location) {
      const placeName = await findNearestSafePlaceFree(location.lat, location.lng);
      setSosSafePlaceName(placeName);
    }

    if (location) {
      try {
        const reportId = `SOS-${Date.now().toString(36).toUpperCase()}`;
        const deviceInfo = getDeviceAuditInfo();
        const batch = writeBatch(db);
        const reportRef = doc(collection(db, 'incident_reports'));
        const auditRef = doc(collection(db, 'report_audit_logs'));
        const resolvedState = location.state || user.state || user.userState || '';

        batch.set(reportRef, {
          reportId,
          userId: user.uid,
          userName: displayName,
          userPhone: user.phone || '',
          userState: resolvedState,
          userProfilePic: displayPhoto,
          incidentState: resolvedState,
          incidentArea: location.area || location.city || '',
          incidentAddress: location.formattedAddress,
          incidentType: 'SOS Emergency',
          description: `LIVE SOS triggered by ${displayName} while ${location.movementMode} at ${location.formattedAddress}`,
          gpsLat: location.lat,
          gpsLng: location.lng,
          guardAiScore: 0.9,
          aiVerdict: 'LIKELY TRUE',
          status: 'pending',
          adminDecision: 'pending',
          visibleOnMap: false,
          falseCount: 0,
          falseBy: [],
          isHidden: false,
          device: deviceInfo,
          paymentStatus: 'unpaid',
          createdAt: serverTimestamp(),
        });

        batch.set(auditRef, {
          reportId,
          userId: user.uid,
          incidentType: 'SOS Emergency',
          device: deviceInfo,
          status: 'pending',
          action: 'SOS_REPORT_SUBMITTED',
          timestamp: serverTimestamp(),
        });

        await batch.commit();
        setSosSentConfirmation(true);
      } catch (err) {
        console.error('SOS write failed:', err);
      }
    }
    setSosDispatching(false);
  };

  useEffect(() => {
    if (openSosSignal && openSosSignal > 0) {
      void handleTriggerSos();
    }
  }, [openSosSignal]);

  const scanCapLabel = activePlan === 'Free' ? `${scansToday} / 2` : `${scansToday} / Unlimited`;
  const cityStateText = formatCityStateLabel(
    location?.city || user.city,
    location?.state || user.state || user.userState
  );
  const locationMissing = !location && cityStateText === 'Location Not Set';

  return (
    <div className="flex flex-col min-h-full">
      <div className="flex-1 px-4 py-4 space-y-4 max-w-2xl mx-auto w-full">
        {/* Good Wish / Admin Broadcast */}
        {goodWishBanner && (
          <div className="p-3 rounded-2xl bg-[#00E67A]/10 border border-[#00E67A]/35 flex items-center gap-2.5">
            <Sparkles className="w-4 h-4 text-[#00E67A] shrink-0" />
            <p className="text-xs font-medium text-slate-100">{goodWishBanner}</p>
          </div>
        )}

        {/* Top Welcome Header: 40px Round Global Picture + "Hello, [Name]" */}
        <div className="flex items-center justify-between gap-3 px-1">
          <button
            type="button"
            onClick={() => onOpenProfile(user.uid)}
            className="flex items-center gap-3 min-w-0 text-left cursor-pointer"
          >
            <UserAvatar
              photoURL={displayPhoto}
              name={displayName}
              size="40"
              borderVariant="purple"
              fallbackVariant="purple"
            />
            <div className="min-w-0">
              <p className="text-base font-extrabold text-white truncate">
                Hello, {displayName}
              </p>
              <p className="text-[11px] text-[#00E67A] font-semibold truncate">
                {cityStateText} • {activePlan} Plan
              </p>
            </div>
          </button>

          <button
            type="button"
            disabled={alreadyCheckedInToday || checkingIn}
            onClick={handleDailyCheckIn}
            className={`px-3 py-1.5 rounded-xl text-[11px] font-extrabold flex items-center gap-1 shrink-0 cursor-pointer ${
              alreadyCheckedInToday
                ? 'bg-[#00E67A]/15 border border-[#00E67A]/40 text-[#00E67A]'
                : 'bg-[#00E67A] text-slate-950 hover:bg-[#00cf6d]'
            }`}
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>{alreadyCheckedInToday ? 'Safe Today' : 'I Am Safe (+10)'}</span>
          </button>
        </div>

        {checkInMsg && (
          <div className="p-2.5 rounded-xl bg-[#00E67A]/15 border border-[#00E67A]/40 text-xs font-bold text-[#00E67A]">
            {checkInMsg}
          </div>
        )}

        {/* End-of-Month Freeze & Real Winners Banner */}
        {frozenWinnerSummary && (
          <div className="bg-[#0C1626] border-2 border-[#00E67A] rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <Crown className="w-6 h-6 text-[#FFC400] shrink-0" />
              <div className="min-w-0">
                <p className="text-xs font-extrabold text-[#00E67A] uppercase tracking-wide">
                  {frozenWinnerSummary.monthName} Leaderboard Frozen — Real Subscribers Only
                </p>
                <p className="text-sm font-extrabold text-white truncate">
                  {frozenWinnerSummary.topUsers[0]
                    ? `Top User of ${frozenWinnerSummary.monthName}: ${frozenWinnerSummary.topUsers[0].name} - ₦10,000`
                    : `Top User of ${frozenWinnerSummary.monthName}: Real Subscribers Only`}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setWinnerModalOpen(true)}
              className="px-3.5 py-2 rounded-xl bg-[#00E67A] text-slate-950 font-extrabold text-xs shrink-0 cursor-pointer"
            >
              View Winners
            </button>
          </div>
        )}

        {/* FIXED TOP 10 USERS BOX AT TOP OF HOME DASHBOARD */}
        <div className="bg-[#0C1626] border-2 border-[#FFC400]/50 rounded-2xl p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <Trophy className="w-5 h-5 text-[#FFC400] shrink-0" />
              <div className="min-w-0">
                <h2 className="text-sm font-extrabold text-white truncate">
                  Top 10 Users - {currentMonthYearLabel}
                </h2>
                <p className="text-[11px] text-[#00E67A] font-semibold">
                  Top 10 Users of the Month Win ₦10,000 - Real Subscribers Only.
                </p>
              </div>
            </div>
            <span className="px-2 py-1 rounded-lg bg-[#FFC400]/15 border border-[#FFC400]/40 text-[10px] font-extrabold text-[#FFC400] shrink-0">
              ₦100,000 Pool
            </span>
          </div>

          {!subInfo.isSubscriber && (
            <div className="p-3 rounded-xl bg-[#FF2D55]/10 border border-[#FF2D55]/40 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <p className="text-xs font-semibold text-white">
                Top 10 is for subscribers only. Subscribe to ₦5,000 to compete for ₦10,000
              </p>
              <button
                type="button"
                onClick={onOpenSubscriptions}
                className="px-3 py-1.5 rounded-lg bg-[#2E9BFF] text-white text-xs font-extrabold shrink-0 cursor-pointer flex items-center gap-1 self-start sm:self-auto"
              >
                <Crown className="w-3.5 h-3.5" />
                <span>Subscribe ₦5,000</span>
              </button>
            </div>
          )}

          {top10Guardians.length === 0 ? (
            <div className="p-4 rounded-xl bg-[#050B14] border border-slate-800 text-center text-xs text-slate-400">
              No active subscribers ranked yet for {currentMonthYearLabel}. Scan &amp; verify incidents to lead!
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="text-[10px] uppercase text-slate-400 border-b border-slate-800">
                  <tr>
                    <th className="py-2 pr-2">Rank</th>
                    <th className="py-2 pr-2">User</th>
                    <th className="py-2 pr-2">State</th>
                    <th className="py-2 pr-2 text-right">Guard Score</th>
                    <th className="py-2 pl-2 text-right">Prize</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/70">
                  {top10Guardians.map((row, idx) => {
                    const isMe = row.userId === user.uid;
                    const rowAvatar = isMe
                      ? displayPhoto
                      : row.profilePicUrl || row.avatar || '';
                    return (
                      <tr
                        key={row.id}
                        onClick={() => onOpenProfile(row.userId)}
                        className={`cursor-pointer ${
                          isMe ? 'bg-[#FFC400]/15' : 'hover:bg-slate-800/40'
                        }`}
                      >
                        <td className="py-2 pr-2 font-mono font-extrabold text-[#FFC400] whitespace-nowrap">
                          {idx === 0 ? (
                            <span className="inline-flex items-center gap-1">
                              <Crown className="w-3.5 h-3.5 text-[#FFC400] fill-[#FFC400]/30" />
                              #1
                            </span>
                          ) : (
                            `#${idx + 1}`
                          )}
                        </td>
                        <td className="py-2 pr-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <UserAvatar
                              photoURL={rowAvatar}
                              name={isMe ? displayName : row.name}
                              size="xs"
                              borderVariant={isMe ? 'purple' : 'green'}
                              fallbackVariant={isMe ? 'purple' : 'letter'}
                            />
                            <span className="font-bold text-white truncate max-w-[115px]">
                              {isMe ? displayName : row.name}
                            </span>
                          </div>
                        </td>
                        <td className="py-2 pr-2 text-slate-300 truncate max-w-[85px]">
                          {row.state || row.city || 'Nigeria'}
                        </td>
                        <td className="py-2 pr-2 text-right font-mono font-extrabold text-[#2E9BFF] tabular-nums">
                          {(row.guardScore ?? 0).toLocaleString()}
                        </td>
                        <td className="py-2 pl-2 text-right font-mono font-extrabold text-[#00E67A] tabular-nums">
                          ₦10,000
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {allTopUsersDisplay.length > 10 && (
            <button
              type="button"
              onClick={() => {
                setAllListSearch('');
                setShowAllUsersModal(true);
              }}
              className="w-full min-h-[44px] py-2.5 px-4 rounded-xl bg-[#050B14] hover:bg-slate-900 border border-slate-700 text-xs font-extrabold text-[#2E9BFF] flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <span>See All Users ({allTopUsersDisplay.length})</span>
              <ChevronRight className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Report & Earn Subscribers-Only Banner */}
        <div className="p-3 rounded-2xl bg-orange-500/10 border border-orange-500/40 flex items-center justify-between gap-2 text-xs">
          <span className="font-bold text-orange-300">
            Report &amp; Earn: ₦5,000 per verified report - Subscribers Only
          </span>
          {!subInfo.isSubscriber && (
            <button
              type="button"
              onClick={onOpenSubscriptions}
              className="px-2.5 py-1 rounded-lg bg-orange-500 text-white font-extrabold text-[11px] shrink-0 cursor-pointer"
            >
              Upgrade
            </button>
          )}
        </div>

        {/* Top Safety Score, Guard Score & Streak Card */}
        <div
          data-tutorial-target="safety-score-card"
          className="bg-[#0C1626] border border-slate-800 rounded-2xl p-4 space-y-3"
        >
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <UserAvatar
                photoURL={displayPhoto}
                name={displayName}
                size="md"
                borderVariant="purple"
                fallbackVariant="purple"
              />
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4 text-[#00E67A] shrink-0" />
                  <h1 className="text-base font-extrabold text-white truncate">
                    You Are Protected
                  </h1>
                </div>
                <p className="text-xs text-slate-400 truncate">
                  {displayName} • {activePlan} Plan
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <div className="px-2.5 py-1.5 rounded-xl bg-[#050B14] border border-slate-800 text-center">
                <p className="text-xs font-bold font-mono text-[#2E9BFF] tabular-nums">
                  {myGuardScore}
                </p>
                <p className="text-[10px] text-slate-400">Guard Score</p>
              </div>
              <div className="px-2.5 py-1.5 rounded-xl bg-[#050B14] border border-slate-800 text-center">
                <p className="text-xs font-bold font-mono text-[#FFC400] tabular-nums flex items-center justify-center gap-0.5">
                  <Flame className="w-3 h-3" />
                  {user.streak ?? 1}
                </p>
                <p className="text-[10px] text-slate-400">Streak</p>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between text-xs pt-2 border-t border-slate-800/80">
            <span className="text-slate-400">Scans Today</span>
            <span
              className={`font-mono font-bold tabular-nums ${
                activePlan === 'Free' && scansToday >= 2 ? 'text-[#FF2D55]' : 'text-[#2E9BFF]'
              }`}
            >
              {scanCapLabel}
            </span>
          </div>
        </div>

        {/* Live Location Card: Real Nominatim Street Name OR Location Not Set + Set My Location button */}
        <div className="bg-[#0C1626] border border-slate-800 rounded-2xl p-4 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-[#2E9BFF] flex items-center gap-1.5">
              <MapPin className="w-3.5 h-3.5" />
              Live Location
            </span>
            <span className="text-[11px] font-semibold px-2 py-0.5 rounded-md bg-slate-800 text-slate-200">
              {location?.movementMode || 'Walking'}
            </span>
          </div>

          {location ? (
            <>
              <p className="text-sm font-bold text-white">
                You are at: {location.formattedAddress}
              </p>
              <p className="text-xs font-mono text-slate-400">
                Lat: {location.lat.toFixed(5)}, Lng: {location.lng.toFixed(5)} • Accuracy:{' '}
                {location.accuracy} meters
              </p>
            </>
          ) : (
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-bold text-[#FFC400]">
                  {locationMissing ? 'Location Not Set' : cityStateText}
                </p>
                <p className="text-xs text-slate-400">
                  Enable GPS to detect your real street and city (never guessed from IP).
                </p>
              </div>
              <button
                type="button"
                disabled={settingLoc}
                onClick={async () => {
                  setSettingLoc(true);
                  await onSetMyLocation();
                  setSettingLoc(false);
                }}
                className="px-3.5 py-2 rounded-xl bg-[#2E9BFF] text-white font-extrabold text-xs shrink-0 cursor-pointer"
              >
                {settingLoc ? 'Locating...' : 'Set My Location'}
              </button>
            </div>
          )}
        </div>

        {/* Tall Map with Profile Photo, Verified Alert Pins (never pending), & Refresh Map Button */}
        <GuardMap
          userLat={location?.lat ?? null}
          userLng={location?.lng ?? null}
          userName={displayName}
          userPhotoURL={displayPhoto}
          addressLabel={location?.formattedAddress || null}
          movementMode={location?.movementMode || 'Walking'}
          pins={verifiedMapAlerts
            .filter(
              (a): a is AlertItem & { lat: number; lng: number } =>
                typeof a.lat === 'number' &&
                Number.isFinite(a.lat) &&
                typeof a.lng === 'number' &&
                Number.isFinite(a.lng) &&
                (a.lat !== 0 || a.lng !== 0)
            )
            .map((a): MapPinItem => ({
              id: a.id,
              lat: a.lat,
              lng: a.lng,
              label: `${a.type}: ${a.incidentArea || a.address}`,
              kind: 'alert',
            }))}
          onRefreshLocation={onRefreshLocation}
          heightClassName="h-[360px]"
        />

        {/* Big Red SOS Button */}
        <button
          type="button"
          data-tutorial-target="sos-button"
          onClick={handleTriggerSos}
          className="w-full min-h-[56px] rounded-2xl bg-[#FF2D55] hover:bg-[#e6254b] text-white font-extrabold text-base shadow-lg shadow-[#FF2D55]/25 flex items-center justify-center gap-2.5 transition-transform active:scale-[0.98] cursor-pointer"
        >
          <AlertOctagon className="w-6 h-6" />
          <span>SOS EMERGENCY</span>
        </button>

        {/* Quick 4 Scanner Buttons */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          <button
            type="button"
            onClick={() => onNavigateScanner('road')}
            className="p-3 rounded-2xl bg-[#0C1626] border border-slate-800 hover:border-[#00E67A]/50 flex flex-col items-center gap-1.5 text-xs font-bold text-white cursor-pointer"
          >
            <Radio className="w-5 h-5 text-[#00E67A]" />
            <span>Scan Road</span>
          </button>
          <button
            type="button"
            onClick={() => onNavigateScanner('vehicle')}
            className="p-3 rounded-2xl bg-[#0C1626] border border-slate-800 hover:border-[#2E9BFF]/50 flex flex-col items-center gap-1.5 text-xs font-bold text-white cursor-pointer"
          >
            <Car className="w-5 h-5 text-[#2E9BFF]" />
            <span>Scan Vehicle</span>
          </button>
          <button
            type="button"
            onClick={() => onNavigateScanner('building')}
            className="p-3 rounded-2xl bg-[#0C1626] border border-slate-800 hover:border-[#FFC400]/50 flex flex-col items-center gap-1.5 text-xs font-bold text-white cursor-pointer"
          >
            <Building2 className="w-5 h-5 text-[#FFC400]" />
            <span>Scan Building</span>
          </button>
          <button
            type="button"
            onClick={() => onNavigateScanner('night_watch')}
            className="p-3 rounded-2xl bg-[#0C1626] border border-slate-800 hover:border-[#FF2D55]/50 flex flex-col items-center gap-1.5 text-xs font-bold text-white cursor-pointer"
          >
            <Moon className="w-5 h-5 text-[#FF2D55]" />
            <span>Night Watch</span>
          </button>
        </div>

        {/* Report & Earn ₦5,000 Button */}
        <button
          type="button"
          onClick={onOpenReportModal}
          className="w-full min-h-[48px] py-3 px-4 rounded-2xl bg-orange-500 hover:bg-orange-600 text-white font-extrabold text-sm shadow-lg cursor-pointer"
        >
          Report &amp; Earn ₦5,000
        </button>

        {/* Daily Tip from Sansa */}
        <div className="bg-[#0C1626] border border-slate-800 rounded-2xl p-4 space-y-2">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-[#00E67A]" />
            <h2 className="text-sm font-bold text-white">Daily Tip from Sansa</h2>
          </div>
          {sansaTips.length === 0 ? (
            <p className="text-xs text-slate-400">
              No live tips published yet. Stay alert on busy roads and verify drivers before boarding.
            </p>
          ) : (
            <div className="space-y-2">
              {sansaTips.slice(0, 2).map((t) => (
                <div key={t.id} className="p-3 rounded-xl bg-[#050B14] border border-slate-800/80">
                  {t.title && <p className="text-xs font-bold text-[#00E67A] mb-0.5">{t.title}</p>}
                  <p className="text-xs text-slate-200 leading-relaxed">{t.message}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Verified By Guard AI - Real Videos */}
        <div className="bg-[#0C1626] border border-slate-800 rounded-2xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-extrabold text-white">
              Verified By Guard AI - Real Videos
            </h2>
            <span className="text-[11px] font-semibold text-[#00E67A]">Subscribers Earn ₦5,000</span>
          </div>

          {homeVideos.length === 0 ? (
            <p className="text-xs text-slate-400 py-4 text-center">
              No verified incident videos yet. Submit a live video report to earn ₦5,000.
            </p>
          ) : (
            <div className="space-y-4">
              {homeVideos.map((vid) => {
                const liked = (vid.likedBy || []).includes(user.uid);
                return (
                  <div
                    key={vid.id}
                    className="bg-[#050B14] border border-slate-800 rounded-2xl p-3.5 space-y-2.5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => vid.userId && onOpenProfile(vid.userId)}
                        className="flex items-center gap-2.5 text-left cursor-pointer min-w-0"
                      >
                        <UserAvatar
                          photoURL={vid.userId === user.uid ? displayPhoto : vid.userProfilePic}
                          name={vid.userId === user.uid ? displayName : vid.userName}
                          size="sm"
                          borderVariant={vid.userId === user.uid ? 'purple' : 'green'}
                          fallbackVariant={vid.userId === user.uid ? 'purple' : 'grey'}
                        />
                        <div className="min-w-0">
                          <p className="text-xs font-bold text-white truncate">
                            {vid.userId === user.uid ? displayName : vid.userName}
                          </p>
                          <p className="text-[11px] text-slate-400 truncate">
                            {vid.incidentArea || vid.incidentState || vid.incidentAddress}
                          </p>
                        </div>
                      </button>
                      <span className="px-2 py-1 rounded-lg bg-[#00E67A]/15 border border-[#00E67A]/40 text-[10px] font-bold text-[#00E67A] shrink-0">
                        Verified Video
                      </span>
                    </div>

                    <div className="text-xs font-semibold text-[#FF2D55]">{vid.incidentType}</div>

                    {vid.videoUrl && (vid.videoUrl.startsWith('http') || vid.videoUrl.startsWith('data:video')) ? (
                      <video
                        src={vid.videoUrl}
                        controls
                        onPlay={() => handleVideoPlay(vid)}
                        className="w-full h-52 rounded-xl bg-black object-cover"
                      />
                    ) : (
                      <div className="w-full h-36 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-center text-xs text-slate-400">
                        Verified In-App Incident Video ({vid.incidentAddress})
                      </div>
                    )}

                    <div className="flex items-center justify-between pt-1 text-xs text-slate-400">
                      <button
                        type="button"
                        onClick={() => handleToggleLike(vid)}
                        className={`flex items-center gap-1.5 cursor-pointer ${
                          liked ? 'text-[#FF2D55] font-bold' : 'hover:text-white'
                        }`}
                      >
                        <Heart className={`w-4 h-4 ${liked ? 'fill-current' : ''}`} />
                        <span>{vid.likes}</span>
                      </button>

                      <button
                        type="button"
                        onClick={() =>
                          setOpenCommentsFor(openCommentsFor === vid.id ? null : vid.id)
                        }
                        className="flex items-center gap-1.5 hover:text-white cursor-pointer"
                      >
                        <MessageCircle className="w-4 h-4" />
                        <span>Comments</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => handleShareVideo(vid)}
                        className="flex items-center gap-1.5 hover:text-white cursor-pointer"
                      >
                        <Share2 className="w-4 h-4" />
                        <span>Share</span>
                      </button>
                    </div>

                    {openCommentsFor === vid.id && (
                      <div className="pt-2 border-t border-slate-800 space-y-2">
                        {comments.length === 0 ? (
                          <p className="text-[11px] text-slate-500">No comments yet.</p>
                        ) : (
                          <div className="space-y-1.5 max-h-36 overflow-y-auto">
                            {comments.map((c) => (
                              <div key={c.id} className="text-xs text-slate-300">
                                <span className="font-bold text-white">{c.userName}: </span>
                                <span>{c.text}</span>
                              </div>
                            ))}
                          </div>
                        )}
                        <form onSubmit={handleAddComment} className="flex gap-2">
                          <input
                            type="text"
                            value={commentInput}
                            onChange={(e) => setCommentInput(e.target.value)}
                            placeholder="Write a comment..."
                            className="flex-1 px-3 py-1.5 rounded-xl bg-[#0C1626] border border-slate-800 text-xs text-white focus:outline-none focus:border-[#2E9BFF]"
                          />
                          <button
                            type="submit"
                            className="px-3 py-1.5 rounded-xl bg-[#2E9BFF] text-white text-xs font-bold cursor-pointer"
                          >
                            <Send className="w-3.5 h-3.5" />
                          </button>
                        </form>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Two Real Top 5 Home Boxes */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {/* Top 5 Trusted */}
          <div className="bg-[#0C1626] border border-slate-800 rounded-2xl p-4 space-y-2.5">
            <h3 className="text-xs font-extrabold text-white flex items-center gap-1.5">
              <ShieldCheck className="w-4 h-4 text-[#00E67A]" />
              Top 5 Users - Most Trusted
            </h3>
            {topTrusted.length === 0 ? (
              <p className="text-xs text-slate-500 py-3">No live data yet.</p>
            ) : (
              <div className="space-y-2">
                {topTrusted.map((u, idx) => (
                  <button
                    key={u.userId}
                    type="button"
                    onClick={() => onOpenProfile(u.userId)}
                    className="w-full flex items-center justify-between gap-2 p-2 rounded-xl bg-[#050B14] hover:border-slate-700 border border-slate-800/80 text-left cursor-pointer"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-xs font-mono font-bold text-slate-400 w-4">
                        #{idx + 1}
                      </span>
                      <UserAvatar
                        photoURL={
                          u.userId === user.uid
                            ? displayPhoto
                            : u.profilePicUrl || u.photoURL
                        }
                        name={u.userId === user.uid ? displayName : u.fullName}
                        size="xs"
                        borderVariant={u.userId === user.uid ? 'purple' : 'green'}
                        fallbackVariant={u.userId === user.uid ? 'purple' : 'grey'}
                      />
                      <span className="text-xs font-semibold text-white truncate">
                        {u.userId === user.uid ? displayName : u.fullName}
                      </span>
                    </div>
                    <span className="text-xs font-mono font-bold text-[#00E67A] shrink-0">
                      {u.trust_score ?? 100}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Top 5 Reporters (+ See All) */}
          <div className="bg-[#0C1626] border border-slate-800 rounded-2xl p-4 space-y-2.5">
            <div>
              <h3 className="text-xs font-extrabold text-white flex items-center gap-1.5">
                <Award className="w-4 h-4 text-[#FFC400]" />
                <span>Top 5 Reporters</span>
              </h3>
              <p className="text-[11px] text-[#FFC400] font-semibold mt-0.5">
                Top 5 Reporters Win Recognition + Bonus. Real Subscribers Only.
              </p>
            </div>
            {topReporters.length === 0 ? (
              <p className="text-xs text-slate-500 py-3">No verified reports yet this month.</p>
            ) : (
              <div className="space-y-2">
                {topReporters.map((u, idx) => {
                  const isMe = u.userId === user.uid;
                  const repPhoto = isMe ? displayPhoto : u.profilePicUrl || u.avatar || '';
                  return (
                    <button
                      key={u.id}
                      type="button"
                      onClick={() => onOpenProfile(u.userId)}
                      className="w-full flex items-center justify-between gap-2 p-2.5 rounded-xl bg-[#050B14] hover:border-slate-700 border border-slate-800/80 text-left cursor-pointer"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-xs font-mono font-extrabold text-[#FFC400] w-5 shrink-0">
                          #{idx + 1}
                        </span>
                        <UserAvatar
                          photoURL={repPhoto}
                          name={isMe ? displayName : u.name}
                          size="xs"
                          borderVariant={isMe ? 'purple' : 'green'}
                          fallbackVariant={isMe ? 'purple' : 'letter'}
                        />
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-xs font-bold text-white truncate max-w-[110px]">
                              {isMe ? displayName : u.name}
                            </span>
                            {idx === 0 && (
                              <span className="px-1.5 py-0.5 rounded bg-[#FFC400]/15 border border-[#FFC400]/40 text-[9px] font-extrabold text-[#FFC400]">
                                Top Reporter of the Month
                              </span>
                            )}
                          </div>
                          <p className="text-[10px] text-slate-400 truncate">
                            {u.state || u.city || 'Nigeria'} • Total: {u.totalReports || u.verifiedReports} • Score: {(u.guardScore ?? 0).toLocaleString()}
                          </p>
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <span className="text-xs font-mono font-extrabold text-[#00E67A] block">
                          {u.verifiedReports} verified
                        </span>
                        <span className="text-[9px] text-slate-400 font-semibold">
                          {idx === 0 ? 'Bonus + Crown' : 'Verified'}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}

            {allTopReportersDisplay.length > 5 && (
              <button
                type="button"
                onClick={() => {
                  setAllListSearch('');
                  setShowAllReportersModal(true);
                }}
                className="w-full min-h-[44px] py-2 px-3 rounded-xl bg-[#050B14] hover:bg-slate-900 border border-slate-700 text-xs font-extrabold text-[#FFC400] flex items-center justify-center gap-1 cursor-pointer"
              >
                <span>See All Reporters ({allTopReportersDisplay.length})</span>
                <ChevronRight className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </div>

      <AdBanner />

      {/* Plain-Language SOS Emergency Sheet */}
      {sosOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="w-full max-w-md bg-[#0C1626] border-2 border-[#FF2D55] rounded-t-3xl sm:rounded-3xl p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-[#FF2D55]">
                <AlertOctagon className="w-6 h-6" />
                <h2 className="text-lg font-extrabold text-white">Emergency Dispatch</h2>
              </div>
              <button
                type="button"
                onClick={() => setSosOpen(false)}
                className="w-9 h-9 rounded-full bg-slate-800 text-slate-300 flex items-center justify-center cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex items-center gap-3 p-3.5 rounded-2xl bg-[#050B14] border border-slate-800">
              <UserAvatar
                photoURL={displayPhoto}
                name={displayName}
                size="md"
                borderVariant="purple"
                fallbackVariant="purple"
              />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-bold text-[#FF2D55] uppercase tracking-wide">
                  SOS From
                </p>
                <p className="text-sm font-extrabold text-white truncate">{displayName}</p>
                <p className="text-xs font-mono text-slate-300 truncate">
                  {user.phone || user.emergencyContact || user.email || 'Phone Verified'}
                </p>
              </div>
            </div>

            <div className="p-3.5 rounded-2xl bg-[#FF2D55]/15 border border-[#FF2D55]/40">
              <p className="text-sm font-bold text-white">
                You are at: {location ? location.formattedAddress : 'Location Not Set'} - Help is coming
              </p>
              {sosDispatching ? (
                <p className="text-xs text-slate-300 mt-1">Sending SOS alert...</p>
              ) : sosSentConfirmation ? (
                <p className="text-xs text-[#00E67A] mt-1 font-semibold">
                  SOS received by Guard AI Admin for dispatch.
                </p>
              ) : null}
            </div>

            <div className="space-y-2.5 bg-[#050B14] border border-slate-800 rounded-2xl p-4 text-sm text-slate-200">
              <p className="font-semibold">1. Stay inside or move away from open threat.</p>
              <p className="font-semibold">2. Go to {sosSafePlaceName}.</p>
              <p className="font-semibold">
                3. Call {user.emergencyContact || '112 / Your Emergency Contact'}.
              </p>
            </div>

            {user.emergencyContact && (
              <a
                href={`tel:${user.emergencyContact.replace(/[^0-9+]/g, '')}`}
                className="w-full py-3.5 px-4 rounded-xl bg-[#00E67A] text-slate-950 font-extrabold text-sm flex items-center justify-center gap-2"
              >
                <PhoneCall className="w-4 h-4" />
                <span>Call Emergency Contact ({user.emergencyContact})</span>
              </a>
            )}
          </div>
        </div>
      )}
      {/* See All Users Modal (Positions 11 to 56+ & Full List) */}
      {showAllUsersModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="w-full max-w-lg max-h-[88vh] flex flex-col bg-[#0C1626] border border-slate-800 rounded-t-3xl sm:rounded-3xl p-5 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <h2 className="text-base font-extrabold text-white flex items-center gap-2">
                  <Trophy className="w-4 h-4 text-[#FFC400]" />
                  <span>All Ranked Users ({allTopUsersDisplay.length})</span>
                </h2>
                <p className="text-[11px] text-[#00E67A]">
                  Top 10 Users of the Month Win ₦10,000 - Real Subscribers Only.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowAllUsersModal(false)}
                className="w-10 h-10 rounded-full bg-slate-800 text-slate-300 flex items-center justify-center cursor-pointer"
                aria-label="Close All Users"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
              <input
                type="text"
                value={allListSearch}
                onChange={(e) => setAllListSearch(e.target.value)}
                placeholder="Search by name or state..."
                className="w-full min-h-[40px] pl-9 pr-3 py-2 rounded-xl bg-[#050B14] border border-slate-800 text-xs text-white focus:outline-none focus:border-[#2E9BFF]"
              />
            </div>

            <div className="flex-1 overflow-y-auto space-y-1.5 pr-1">
              {allTopUsersDisplay
                .map((row, index) => ({ row, rank: index + 1 }))
                .filter(({ row }) => {
                  const q = allListSearch.trim().toLowerCase();
                  if (!q) return true;
                  return (
                    row.name.toLowerCase().includes(q) ||
                    (row.state || '').toLowerCase().includes(q) ||
                    (row.city || '').toLowerCase().includes(q)
                  );
                })
                .map(({ row, rank }) => {
                  const isMe = row.userId === user.uid;
                  const rowAvatar = isMe ? displayPhoto : row.profilePicUrl || row.avatar || '';
                  return (
                    <button
                      key={row.id}
                      type="button"
                      onClick={() => {
                        setShowAllUsersModal(false);
                        onOpenProfile(row.userId);
                      }}
                      className={`w-full flex items-center justify-between gap-2 p-2.5 rounded-xl border text-left cursor-pointer ${
                        isMe
                          ? 'bg-[#FFC400]/15 border-[#FFC400]/50'
                          : rank <= 10
                          ? 'bg-[#050B14] border-[#00E67A]/30'
                          : 'bg-[#050B14] border-slate-800/80'
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span className="w-7 text-xs font-mono font-extrabold text-[#FFC400] shrink-0">
                          {rank === 1 ? '👑 #1' : `#${rank}`}
                        </span>
                        <UserAvatar
                          photoURL={rowAvatar}
                          name={isMe ? displayName : row.name}
                          size="xs"
                          borderVariant={isMe ? 'purple' : 'green'}
                          fallbackVariant={isMe ? 'purple' : 'letter'}
                        />
                        <div className="min-w-0">
                          <p className="text-xs font-bold text-white truncate">
                            {isMe ? displayName : row.name}
                          </p>
                          <p className="text-[10px] text-slate-400 truncate">
                            {row.state || row.city || 'Nigeria'}
                          </p>
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-xs font-mono font-extrabold text-[#2E9BFF] tabular-nums">
                          {(row.guardScore ?? 0).toLocaleString()} pts
                        </p>
                        {rank <= 10 && (
                          <p className="text-[10px] font-bold text-[#00E67A]">₦10,000</p>
                        )}
                      </div>
                    </button>
                  );
                })}
            </div>
          </div>
        </div>
      )}

      {/* See All Reporters Modal (Positions 6 to 56+ & Full List) */}
      {showAllReportersModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="w-full max-w-lg max-h-[88vh] flex flex-col bg-[#0C1626] border border-slate-800 rounded-t-3xl sm:rounded-3xl p-5 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <h2 className="text-base font-extrabold text-white flex items-center gap-2">
                  <Award className="w-4 h-4 text-[#FFC400]" />
                  <span>All Top Reporters ({allTopReportersDisplay.length})</span>
                </h2>
                <p className="text-[11px] text-[#FFC400]">
                  Top 5 Reporters Win Recognition + Bonus. Real Subscribers Only.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowAllReportersModal(false)}
                className="w-10 h-10 rounded-full bg-slate-800 text-slate-300 flex items-center justify-center cursor-pointer"
                aria-label="Close All Reporters"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
              <input
                type="text"
                value={allListSearch}
                onChange={(e) => setAllListSearch(e.target.value)}
                placeholder="Search reporter by name or state..."
                className="w-full min-h-[40px] pl-9 pr-3 py-2 rounded-xl bg-[#050B14] border border-slate-800 text-xs text-white focus:outline-none focus:border-[#2E9BFF]"
              />
            </div>

            <div className="flex-1 overflow-y-auto space-y-1.5 pr-1">
              {allTopReportersDisplay
                .map((u, index) => ({ u, rank: index + 1 }))
                .filter(({ u }) => {
                  const q = allListSearch.trim().toLowerCase();
                  if (!q) return true;
                  return (
                    u.name.toLowerCase().includes(q) ||
                    (u.state || '').toLowerCase().includes(q) ||
                    (u.city || '').toLowerCase().includes(q)
                  );
                })
                .map(({ u, rank }) => {
                  const isMe = u.userId === user.uid;
                  const repPhoto = isMe ? displayPhoto : u.profilePicUrl || u.avatar || '';
                  return (
                    <button
                      key={u.id}
                      type="button"
                      onClick={() => {
                        setShowAllReportersModal(false);
                        onOpenProfile(u.userId);
                      }}
                      className={`w-full flex items-center justify-between gap-2 p-2.5 rounded-xl border text-left cursor-pointer ${
                        isMe
                          ? 'bg-[#FFC400]/15 border-[#FFC400]/50'
                          : rank <= 5
                          ? 'bg-[#050B14] border-[#FFC400]/40'
                          : 'bg-[#050B14] border-slate-800/80'
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span className="w-7 text-xs font-mono font-extrabold text-[#FFC400] shrink-0">
                          #{rank}
                        </span>
                        <UserAvatar
                          photoURL={repPhoto}
                          name={isMe ? displayName : u.name}
                          size="xs"
                          borderVariant={isMe ? 'purple' : 'green'}
                          fallbackVariant={isMe ? 'purple' : 'letter'}
                        />
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-xs font-bold text-white truncate">
                              {isMe ? displayName : u.name}
                            </span>
                            {rank === 1 && (
                              <span className="px-1.5 py-0.5 rounded bg-[#FFC400]/15 border border-[#FFC400]/40 text-[9px] font-extrabold text-[#FFC400]">
                                Top Reporter of the Month
                              </span>
                            )}
                          </div>
                          <p className="text-[10px] text-slate-400 truncate">
                            {u.state || u.city || 'Nigeria'} • Total Reports: {u.totalReports || u.verifiedReports} • Guard Score: {(u.guardScore ?? 0).toLocaleString()}
                          </p>
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <span className="text-xs font-mono font-extrabold text-[#00E67A] block">
                          {u.verifiedReports} verified
                        </span>
                        <span className="text-[9px] text-slate-400 font-semibold">
                          {rank === 1 ? 'Top Reporter' : rank <= 5 ? 'Bonus Eligible' : 'Community'}
                        </span>
                      </div>
                    </button>
                  );
                })}
            </div>
          </div>
        </div>
      )}

      {/* End-of-Month Real Subscribers Winner Modal */}
      {winnerModalOpen && frozenWinnerSummary && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="w-full max-w-md max-h-[88vh] overflow-y-auto bg-[#0C1626] border-2 border-[#00E67A] rounded-t-3xl sm:rounded-3xl p-5 space-y-4">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Crown className="w-5 h-5 text-[#FFC400]" />
                <h2 className="text-base font-extrabold text-white">
                  {frozenWinnerSummary.monthName} Official Winners
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setWinnerModalOpen(false)}
                className="w-9 h-9 rounded-full bg-slate-800 text-slate-300 flex items-center justify-center cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-3.5 rounded-2xl bg-[#00E67A]/15 border border-[#00E67A]/50">
              <p className="text-sm font-extrabold text-white">
                {frozenWinnerSummary.topUsers[0]
                  ? `Top User of ${frozenWinnerSummary.monthName}: ${frozenWinnerSummary.topUsers[0].name} - ₦10,000`
                  : `Top User of ${frozenWinnerSummary.monthName}: Real Subscribers Only`}
              </p>
              <p className="text-[11px] text-slate-300 mt-1">
                Starter Guards excluded automatically. Winners verified from active paid subscribers only.
              </p>
            </div>

            <div className="space-y-2">
              <h3 className="text-xs font-extrabold text-[#FFC400]">Top 10 Users (₦10,000 Each)</h3>
              {frozenWinnerSummary.topUsers.length === 0 ? (
                <p className="text-xs text-slate-400">No active paid subscriber winners this month.</p>
              ) : (
                frozenWinnerSummary.topUsers.map((w) => (
                  <div
                    key={w.userId}
                    className="p-2.5 rounded-xl bg-[#050B14] border border-slate-800 flex items-center justify-between text-xs"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="font-mono font-bold text-[#FFC400]">#{w.rank}</span>
                      <UserAvatar
                        photoURL={w.photoURL}
                        name={w.name}
                        size="xs"
                        fallbackVariant="letter"
                      />
                      <span className="font-bold text-white truncate">{w.name}</span>
                    </div>
                    <span className="font-mono font-extrabold text-[#00E67A] shrink-0">₦10,000</span>
                  </div>
                ))
              )}
            </div>

            <div className="space-y-2">
              <h3 className="text-xs font-extrabold text-[#2E9BFF]">Top 5 Reporters (Recognition + Bonus)</h3>
              {frozenWinnerSummary.topReporters.length === 0 ? (
                <p className="text-xs text-slate-400">No verified real-subscriber reporters this month.</p>
              ) : (
                frozenWinnerSummary.topReporters.map((r) => (
                  <div
                    key={r.userId}
                    className="p-2.5 rounded-xl bg-[#050B14] border border-slate-800 flex items-center justify-between text-xs"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="font-mono font-bold text-[#2E9BFF]">#{r.rank}</span>
                      <UserAvatar
                        photoURL={r.photoURL}
                        name={r.name}
                        size="xs"
                        fallbackVariant="letter"
                      />
                      <span className="font-bold text-white truncate">{r.name}</span>
                    </div>
                    <span className="font-mono font-bold text-[#FFC400] shrink-0">
                      {r.verifiedReports} verified
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
