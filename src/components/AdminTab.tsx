import React, { useEffect, useState } from 'react';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  increment,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import {
  ShieldAlert,
  Users,
  CheckCircle2,
  XCircle,
  Phone,
  MessageSquare,
  Send,
  Flag,
  Sparkles,
  Building2,
  CreditCard,
  Shield,
  Database,
  Trash2,
  Trophy,
  X,
  Gift,
  MapPin,
  Eye,
  EyeOff,
  RefreshCw,
  Crown,
} from 'lucide-react';
import { db, handleFirestoreError, OperationType } from '../firebase';
import {
  IncidentReport,
  LeaderboardHistoryDoc,
  OPaySettings,
  PaymentDoc,
  PoliceStation,
  ReferralDoc,
  ReportAuditLog,
  SafeBusiness,
  ScoreHistoryEntry,
  StarterGuardsSettings,
  SubscriptionPlanCode,
  UserProfile,
  UserUsageStat,
} from '../types';
import { toMillisSafe } from '../utils/antiSpam';
import { NIGERIA_POLICE_SEED } from '../data/nigeriaPoliceSeed';
import {
  isStarterUserRecord,
  removeAllStarterGuardsFromFirestore,
  runMidnightStarterShuffleInFirestore,
  seedAllStarterGuardsToFirestore,
} from '../data/starterGuardsSeed';
import {
  computeLeaderboardPoints,
  formatCityStateLabel,
  getWatDateKey,
  getWatMonthKey,
  isTimestampTodayWat,
} from '../utils/geoPhysics';
import {
  applyFalseReportPenaltyBreakdown,
  applySubscribedReferralBreakdown,
  applyVerifiedReportBreakdown,
  buildEndOfMonthWinnerSummary,
  calculateMonthlyGuardScore,
  EMPTY_MONTHLY_BREAKDOWN,
  getEffectiveGuardScore,
  getEffectiveSubscription,
  normalizeBreakdown,
  sortTop10Guardians,
  validatePayoutRecipient,
} from '../utils/guardScore';
import { useGlobalUserProfile } from '../utils/userProfileStore';
import { UserAvatar } from './UserAvatar';
import { AdBanner } from './AdBanner';

interface AdminTabProps {
  adminUser: UserProfile;
}

interface LiveUserCoord {
  userId: string;
  lat?: number;
  lng?: number;
  address?: string;
}

export const AdminTab: React.FC<AdminTabProps> = ({ adminUser }) => {
  const adminPhoto = adminUser.profilePicUrl || adminUser.photoURL || '';
  const globalProfile = useGlobalUserProfile(adminUser.fullName, adminPhoto);
  const [subSection, setSubSection] = useState<
    'reports' | 'top10' | 'police' | 'payments' | 'overview' | 'leaderboard' | 'audit' | 'broadcast'
  >('reports');

  const [allUsers, setAllUsers] = useState<UserProfile[]>([]);
  const [liveCoords, setLiveCoords] = useState<Record<string, LiveUserCoord>>({});
  const [sessions, setSessions] = useState<{ userId: string; minutes: number; createdAt?: any }[]>(
    []
  );
  const [screenTimes, setScreenTimes] = useState<{ userId: string; screen: string; seconds: number }[]>(
    []
  );
  const [reports, setReports] = useState<IncidentReport[]>([]);
  const [auditLogs, setAuditLogs] = useState<ReportAuditLog[]>([]);
  const [stations, setStations] = useState<PoliceStation[]>([]);
  const [payments, setPayments] = useState<PaymentDoc[]>([]);
  const [pendingBusinesses, setPendingBusinesses] = useState<SafeBusiness[]>([]);
  const [usageStats, setUsageStats] = useState<UserUsageStat[]>([]);
  const [alertsTodayCount, setAlertsTodayCount] = useState(0);
  const [scansTodayCount, setScansTodayCount] = useState(0);

  // OPay Settings form
  const [bankName, setBankName] = useState('OPay Digital Services');
  const [accountName, setAccountName] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [opaySavedMsg, setOpaySavedMsg] = useState<string | null>(null);

  // Police Add Form
  const [newState, setNewState] = useState('Rivers');
  const [newArea, setNewArea] = useState('');
  const [newStationName, setNewStationName] = useState('');
  const [newPhone1, setNewPhone1] = useState('');
  const [newPhone2, setNewPhone2] = useState('');

  // Police Dispatch Drawer
  const [dispatchInfo, setDispatchInfo] = useState<{
    report: IncidentReport;
    station: PoliceStation | null;
  } | null>(null);

  // Free user report verification confirmation modal
  const [freeConfirmReport, setFreeConfirmReport] = useState<{
    report: IncidentReport;
    reason: 'free' | 'suspended';
  } | null>(null);

  // Top 10 Payout & Starter Guards states
  const [leaderboardHistory, setLeaderboardHistory] = useState<LeaderboardHistoryDoc[]>([]);
  const [payoutConfirmOpen, setPayoutConfirmOpen] = useState(false);
  const [payoutBusy, setPayoutBusy] = useState(false);
  const [adminToast, setAdminToast] = useState<string | null>(null);
  const [expandedTop10Id, setExpandedTop10Id] = useState<string | null>(null);
  const [payoutSubTab, setPayoutSubTab] = useState<'real' | 'starter'>('real');
  const [usersFilter, setUsersFilter] = useState<'all' | 'real' | 'starter'>('all');
  const [starterSettings, setStarterSettings] = useState<StarterGuardsSettings>({
    showInApp: true,
    starterRemoved: false,
  });
  const [starterBusy, setStarterBusy] = useState(false);
  const [removeStartersModalOpen, setRemoveStartersModalOpen] = useState(false);
  const autoShuffleCheckedRef = React.useRef<string>('');

  // User Detail Modal (Profile & Referrals)
  const [selectedUserDetail, setSelectedUserDetail] = useState<UserProfile | null>(null);
  const [userDetailTab, setUserDetailTab] = useState<'profile' | 'referrals'>('profile');
  const [selectedUserReferrals, setSelectedUserReferrals] = useState<ReferralDoc[]>([]);

  // Broadcast / Sansa Tip Form
  const [tipTitle, setTipTitle] = useState('');
  const [tipBody, setTipBody] = useState('');
  const [wishText, setWishText] = useState('');
  const [seedingPolice, setSeedingPolice] = useState(false);

  const showToast = (msg: string) => {
    setAdminToast(msg);
    window.setTimeout(() => setAdminToast(null), 5000);
  };

  // 1. Live Admin Listeners
  useEffect(() => {
    const onErr = (label: string) => (err: Error) => console.warn(`Admin ${label} listener:`, err.message);
    const u1 = onSnapshot(collection(db, 'users'), (snap) => {
      setAllUsers(snap.docs.map((d) => d.data() as UserProfile));
    }, onErr('users'));
    const u2 = onSnapshot(collection(db, 'guard_users_live'), (snap) => {
      const map: Record<string, LiveUserCoord> = {};
      snap.docs.forEach((d) => {
        map[d.id] = {
          userId: d.id,
          lat: d.data().lat,
          lng: d.data().lng,
          address: d.data().address,
        };
      });
      setLiveCoords(map);
    }, onErr('guard_users_live'));
    const u3 = onSnapshot(collection(db, 'user_sessions'), (snap) => {
      setSessions(
        snap.docs.map((d) => ({
          userId: String(d.data().userId || ''),
          minutes: Number(d.data().durationMinutes || 0),
          createdAt: d.data().startedAt || d.data().updatedAt,
        }))
      );
    }, onErr('user_sessions'));
    const u4 = onSnapshot(collection(db, 'screen_time'), (snap) => {
      setScreenTimes(
        snap.docs.map((d) => ({
          userId: String(d.data().userId || ''),
          screen: String(d.data().screen || 'home'),
          seconds: Number(d.data().seconds || 0),
        }))
      );
    }, onErr('screen_time'));
    const u5 = onSnapshot(
      query(collection(db, 'incident_reports'), orderBy('createdAt', 'desc')),
      (snap) => {
        setReports(
          snap.docs.map((d) => ({
            id: d.id,
            ...(d.data() as Omit<IncidentReport, 'id'>),
          }))
        );
      },
      onErr('incident_reports')
    );
    const u6 = onSnapshot(collection(db, 'police_stations'), (snap) => {
      setStations(
        snap.docs
          .map((d) => ({
            id: d.id,
            ...(d.data() as Omit<PoliceStation, 'id'>),
          }))
          .sort((a, b) => a.state.localeCompare(b.state))
      );
    }, onErr('police_stations'));
    const u7 = onSnapshot(
      query(collection(db, 'payments'), orderBy('createdAt', 'desc')),
      (snap) => {
        setPayments(
          snap.docs.map((d) => ({
            id: d.id,
            ...(d.data() as Omit<PaymentDoc, 'id'>),
          }))
        );
      },
      onErr('payments')
    );
    const u8 = onSnapshot(
      query(collection(db, 'safe_business'), where('verified', '==', false)),
      (snap) => {
        setPendingBusinesses(
          snap.docs.map((d) => ({
            id: d.id,
            ...(d.data() as Omit<SafeBusiness, 'id'>),
          }))
        );
      },
      onErr('safe_business')
    );
    const u9 = onSnapshot(
      query(collection(db, 'user_usage_stats'), where('month', '==', getWatMonthKey())),
      (snap) => {
        setUsageStats(
          snap.docs.map((d) => ({
            id: d.id,
            ...(d.data() as Omit<UserUsageStat, 'id'>),
          }))
        );
      },
      onErr('user_usage_stats')
    );
    const u10 = onSnapshot(collection(db, 'alerts'), (snap) => {
      setAlertsTodayCount(snap.docs.filter((d) => isTimestampTodayWat(d.data().createdAt)).length);
    }, onErr('alerts'));
    const u11 = onSnapshot(collection(db, 'road_scanner'), (snap) => {
      setScansTodayCount(snap.docs.filter((d) => isTimestampTodayWat(d.data().createdAt)).length);
    }, onErr('road_scanner'));
    const u12 = onSnapshot(doc(db, 'app_settings', 'opay'), (snap) => {
      if (snap.exists()) {
        const d = snap.data() as OPaySettings;
        setBankName(d.bankName || 'OPay Digital Services');
        setAccountName(d.accountName || '');
        setAccountNumber(d.accountNumber || '');
      }
    }, onErr('app_settings'));
    const u13 = onSnapshot(
      query(collection(db, 'report_audit_logs'), orderBy('timestamp', 'desc')),
      (snap) => {
        setAuditLogs(
          snap.docs.map((d) => ({
            id: d.id,
            ...(d.data() as Omit<ReportAuditLog, 'id'>),
          }))
        );
      },
      onErr('report_audit_logs')
    );

    const u14 = onSnapshot(
      query(collection(db, 'leaderboardHistory'), orderBy('paidAt', 'desc')),
      (snap) => {
        setLeaderboardHistory(
          snap.docs.map((d) => ({
            id: d.id,
            ...(d.data() as Omit<LeaderboardHistoryDoc, 'id'>),
          }))
        );
      },
      onErr('leaderboardHistory')
    );

    const u15 = onSnapshot(
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
      onErr('starter_guards')
    );

    return () => {
      u1();
      u2();
      u3();
      u4();
      u5();
      u6();
      u7();
      u8();
      u9();
      u10();
      u11();
      u12();
      u13();
      u14();
      u15();
    };
  }, []);

  // Auto-run midnight WAT Starter Guard daily shuffle (-20..+30 pts, -1..+2 reports) once per new day
  useEffect(() => {
    const todayKey = getWatDateKey();
    if (starterSettings.starterRemoved) return;
    if (starterSettings.lastShuffleDate === todayKey) return;
    const starterStats = usageStats.filter((st) => isStarterUserRecord(st));
    if (starterStats.length === 0) return;
    if (autoShuffleCheckedRef.current === todayKey) return;
    autoShuffleCheckedRef.current = todayKey;
    void runMidnightStarterShuffleInFirestore(usageStats).catch((err) => {
      console.warn('Auto midnight starter shuffle warning:', err);
    });
  }, [usageStats, starterSettings.starterRemoved, starterSettings.lastShuffleDate]);

  // Load referrals when inspecting a user in detail modal
  useEffect(() => {
    if (!selectedUserDetail) {
      setSelectedUserReferrals([]);
      return;
    }
    const q = query(
      collection(db, 'referrals'),
      where('referrerUid', '==', selectedUserDetail.uid)
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        setSelectedUserReferrals(
          snap.docs.map((d) => ({
            id: d.id,
            ...(d.data() as Omit<ReferralDoc, 'id'>),
          }))
        );
      },
      () => {}
    );
    return () => unsub();
  }, [selectedUserDetail?.uid]);

  const pendingReportsCount = reports.filter(
    (r) =>
      r.adminDecision === 'pending' ||
      r.status === 'pending' ||
      r.status === 'PENDING VERIFICATION'
  ).length;
  const pendingPaymentsCount = payments.filter((p) => p.status === 'PENDING').length;
  const flaggedReportersCount = allUsers.filter((u) => Boolean(u.flaggedReporter)).length;

  // Publish Alert + Home Video helper, optional ₦5,000 payout & Guard Score for subscribers
  const finalizeVerifiedReport = async (rep: IncidentReport, paySubscriber: boolean) => {
    const targetState = (rep.incidentState || rep.userState || '').trim();
    const matchedStation =
      (targetState
        ? stations.find(
            (s) =>
              s.state.toLowerCase() === targetState.toLowerCase() && s.isVerified && s.isActive
          )
        : undefined) ||
      stations.find((s) => s.isVerified && s.isActive) ||
      null;

    const repAuthor = allUsers.find((u) => u.uid === rep.userId);
    const authorPhoto =
      repAuthor?.profilePicUrl || repAuthor?.photoURL || rep.userProfilePic || '';
    const month = getWatMonthKey();
    const statDoc = usageStats.find((u) => u.userId === rep.userId);

    try {
      // 1. Publish verified alert to Alerts Tab & Map
      await addDoc(collection(db, 'alerts'), {
        userId: rep.userId,
        userName: rep.userName || repAuthor?.fullName || 'Verified Reporter',
        userProfilePic: authorPhoto,
        type: rep.incidentType,
        title: `${rep.incidentType} Verified Alert`,
        description: rep.description || '',
        address: rep.incidentAddress,
        incidentState: targetState,
        incidentArea: rep.incidentArea || '',
        lat: rep.gpsLat ?? 0,
        lng: rep.gpsLng ?? 0,
        confidence: rep.guardAiScore ?? 0.85,
        status: 'New',
        videoUrl: rep.videoUrl || '',
        photoUrl: rep.photoUrl || '',
        verifiedByGuardAI: true,
        reportId: rep.id,
        falseCount: 0,
        falseBy: [],
        isHidden: false,
        createdAt: serverTimestamp(),
      });

      // 2. Promote video to Home feed when verified
      if (rep.videoUrl) {
        await addDoc(collection(db, 'home_videos'), {
          reportId: rep.reportId || rep.id,
          userId: rep.userId,
          userName: rep.userName || repAuthor?.fullName || 'Verified User',
          userProfilePic: authorPhoto,
          videoUrl: rep.videoUrl || '',
          incidentType: rep.incidentType,
          incidentState: rep.incidentState || '',
          incidentArea: rep.incidentArea || '',
          incidentAddress: rep.incidentAddress,
          views: 0,
          likes: 0,
          likedBy: [],
          verifiedAt: serverTimestamp(),
        });
      }

      if (paySubscriber) {
        await updateDoc(doc(db, 'incident_reports', rep.id), {
          paymentStatus: 'paid',
          status: 'VERIFIED & PAID ₦5,000',
          adminDecision: 'approved',
          visibleOnMap: true,
          adminName: adminUser.fullName,
          approvedAt: serverTimestamp(),
          forwardedTo: matchedStation?.phone1 || '112',
          forwardedState: targetState,
          forwardedAt: serverTimestamp(),
        });

        // Calculate Monthly Guard Score delta (+100 gunshot/robbery/kidnapping, +60 others, +20 media, max 3/day)
        const hasMedia = Boolean(rep.videoUrl || rep.photoUrl);
        const { nextBreakdown, delta, capped } = applyVerifiedReportBreakdown(
          statDoc?.monthlyBreakdown || repAuthor?.monthlyBreakdown,
          rep.incidentType,
          hasMedia
        );
        const { guardScore } = calculateMonthlyGuardScore(nextBreakdown, Date.now());

        await updateDoc(doc(db, 'users', rep.userId), {
          walletBalance: increment(5000),
          availableBalanceNaira: increment(5000),
          totalEarnedNaira: increment(5000),
          verifiedBadge: true,
          guardScore,
          guardScoreMonth: month,
          monthlyBreakdown: nextBreakdown,
          lastActive: serverTimestamp(),
          lastActiveAt: serverTimestamp(),
        });

        await addDoc(collection(db, 'wallet_transactions'), {
          userId: rep.userId,
          amount: 5000,
          type: 'REPORT_EARN',
          status: 'paid',
          description: `Verified Report Reward (${rep.incidentType})`,
          reportId: rep.id,
          createdAt: serverTimestamp(),
        });

        const statRef = doc(db, 'user_usage_stats', statDoc?.id || `${rep.userId}_${month}`);
        const nextVerified = (statDoc?.verifiedReports || 0) + 1;
        const nextPts = computeLeaderboardPoints({
          verifiedReports: nextVerified,
          totalScans: statDoc?.totalScans || 0,
          totalUsageDays: statDoc?.totalUsageDays || 1,
          totalUsageMinutes: statDoc?.totalUsageMinutes || 0,
        });
        const prevHist: ScoreHistoryEntry[] = Array.isArray(statDoc?.scoreHistory)
          ? statDoc.scoreHistory
          : [];
        const nextHist: ScoreHistoryEntry[] = capped
          ? prevHist
          : [
              {
                action: `Verified Report: ${rep.incidentType} (+${delta})`,
                delta,
                at: new Date().toISOString(),
              },
              ...prevHist,
            ].slice(0, 30);

        if (statDoc) {
          await updateDoc(statRef, {
            verifiedReports: nextVerified,
            totalPoints: nextPts,
            guardScore,
            monthlyBreakdown: nextBreakdown,
            scoreHistory: nextHist,
            lastActive: serverTimestamp(),
            lastActiveAt: serverTimestamp(),
          });
        } else {
          const effSub = getEffectiveSubscription(repAuthor);
          await setDoc(statRef, {
            userId: rep.userId,
            name: repAuthor?.fullName || rep.userName || 'Guard AI Member',
            avatar: authorPhoto,
            profilePicUrl: authorPhoto,
            city: repAuthor?.city || '',
            state: repAuthor?.state || repAuthor?.userState || targetState,
            subscriptionPlan: effSub.plan,
            subscriptionStatus: effSub.status,
            ...(repAuthor?.subscriptionExpiresAt
              ? { subscriptionExpiresAt: repAuthor.subscriptionExpiresAt }
              : {}),
            totalScans: 0,
            totalReports: 1,
            verifiedReports: 1,
            totalUsageDays: 1,
            lastActiveDate: getWatDateKey(),
            totalUsageMinutes: 0,
            totalPoints: nextPts,
            guardScore,
            monthlyBreakdown: nextBreakdown,
            scoreHistory: nextHist,
            month,
            cheatingFlagged: false,
            lastActive: serverTimestamp(),
            lastActiveAt: serverTimestamp(),
          });
        }
        showToast(`Report verified & ₦5,000 credited (+${delta} Guard Score).`);
      } else {
        await updateDoc(doc(db, 'incident_reports', rep.id), {
          paymentStatus: 'unpaid',
          status: 'APPROVED (FREE - NO PAYMENT)',
          adminDecision: 'approved',
          visibleOnMap: true,
          adminName: adminUser.fullName,
          approvedAt: serverTimestamp(),
          forwardedTo: matchedStation?.phone1 || '112',
          forwardedState: targetState,
          forwardedAt: serverTimestamp(),
        });
        showToast('Report published to map & alerts (₦0 / 0 Guard Score — Free or Suspended user).');
      }

      // 3. Update public_profiles
      await updateDoc(doc(db, 'public_profiles', rep.userId), {
        verifiedReports: increment(1),
        ...(paySubscriber ? { verifiedBadge: true } : {}),
      }).catch(() => {});

      // 4. Log in sansa_memory & admin
      await addDoc(collection(db, 'sansa_memory'), {
        type: 'police_dispatch',
        reportId: rep.reportId || rep.id,
        state: targetState,
        stationName: matchedStation?.stationName || 'Emergency 112',
        isPublicTip: false,
        createdAt: serverTimestamp(),
      });
      await addDoc(collection(db, 'admin'), {
        action: paySubscriber ? 'VERIFY_AND_PAY_5000' : 'VERIFY_FREE_NO_PAY',
        adminId: adminUser.uid,
        reportId: rep.id,
        targetState,
        createdAt: serverTimestamp(),
      });

      setDispatchInfo({ report: rep, station: matchedStation });
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'incident_reports');
    }
  };

  // Single Verify Report entry point (Subscribers auto-pay ₦5,000; Free users require confirmation)
  const handleVerifyReportClick = async (rep: IncidentReport) => {
    const repAuthor = allUsers.find((u) => u.uid === rep.userId);
    const effSub = getEffectiveSubscription(repAuthor);
    const suspendedUntilMs = toMillisSafe(repAuthor?.reportEarnSuspendedUntil);
    const isRewardSuspended = suspendedUntilMs > Date.now();

    if (effSub.isSubscriber && !isRewardSuspended) {
      await finalizeVerifiedReport(rep, true);
    } else {
      setFreeConfirmReport({
        report: rep,
        reason: isRewardSuspended ? 'suspended' : 'free',
      });
    }
  };

  const handleRejectReport = async (rep: IncidentReport) => {
    try {
      await updateDoc(doc(db, 'incident_reports', rep.id), {
        status: 'REJECTED',
        adminDecision: 'rejected',
        visibleOnMap: false,
        isHidden: true,
        adminReason: 'Did not meet Guard AI verification criteria (-250 Guard Score penalty)',
      });

      const repAuthor = allUsers.find((u) => u.uid === rep.userId);
      const month = getWatMonthKey();
      const statDoc = usageStats.find((u) => u.userId === rep.userId);
      const { nextBreakdown } = applyFalseReportPenaltyBreakdown(
        statDoc?.monthlyBreakdown || repAuthor?.monthlyBreakdown
      );
      const { guardScore } = calculateMonthlyGuardScore(
        nextBreakdown,
        statDoc?.lastActiveAt || repAuthor?.lastActiveAt || Date.now()
      );

      const prevFalseCount =
        repAuthor?.falseReportMonth === month ? repAuthor?.falseReportsThisMonth || 0 : 0;
      const nextFalseCount = prevFalseCount + 1;
      const isSuspendedNow = nextFalseCount >= 3;

      await updateDoc(doc(db, 'users', rep.userId), {
        guardScore,
        guardScoreMonth: month,
        monthlyBreakdown: nextBreakdown,
        falseReportsThisMonth: nextFalseCount,
        falseReportMonth: month,
        flaggedReporter: true,
        flaggedAt: serverTimestamp(),
        ...(isSuspendedNow
          ? {
              reportEarnSuspendedUntil: Timestamp.fromMillis(
                Date.now() + 30 * 24 * 60 * 60 * 1000
              ),
              flaggedReason:
                '3+ false/rejected reports this month — suspended from Report & Earn for 30 days',
            }
          : {
              flaggedReason: `Rejected report #${nextFalseCount} this month (-250 Guard Score)`,
            }),
      }).catch(() => {});

      const statRef = doc(db, 'user_usage_stats', statDoc?.id || `${rep.userId}_${month}`);
      const prevHist: ScoreHistoryEntry[] = Array.isArray(statDoc?.scoreHistory)
        ? statDoc.scoreHistory
        : [];
      const nextHist: ScoreHistoryEntry[] = [
        {
          action: 'False / Rejected Report Penalty (-250)',
          delta: -250,
          at: new Date().toISOString(),
        },
        ...prevHist,
      ].slice(0, 30);

      if (statDoc) {
        await updateDoc(statRef, {
          guardScore,
          monthlyBreakdown: nextBreakdown,
          scoreHistory: nextHist,
        }).catch(() => {});
      }

      showToast(
        isSuspendedNow
          ? 'Report rejected (-250 Guard Score). Reporter hit 3 false reports and is suspended from Report & Earn for 30 days.'
          : 'Report rejected and -250 Guard Score penalty applied.'
      );
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `incident_reports/${rep.id}`);
    }
  };

  const handleSeedAll37StatesPolice = async () => {
    setSeedingPolice(true);
    try {
      const batch = writeBatch(db);
      NIGERIA_POLICE_SEED.forEach((st) => {
        const ref = doc(collection(db, 'police_stations'));
        batch.set(ref, st);
      });
      await batch.commit();
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'police_stations');
    } finally {
      setSeedingPolice(false);
    }
  };

  const handleAddPoliceStation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newStationName.trim() || !newPhone1.trim()) return;
    await addDoc(collection(db, 'police_stations'), {
      state: newState,
      area: newArea.trim() || `${newState} Command`,
      stationName: newStationName.trim(),
      phone1: newPhone1.trim(),
      phone2: newPhone2.trim() || newPhone1.trim(),
      isVerified: true,
      isActive: true,
    });
    setNewArea('');
    setNewStationName('');
    setNewPhone1('');
    setNewPhone2('');
  };

  const handleSaveOPaySettings = async (e: React.FormEvent) => {
    e.preventDefault();
    await setDoc(doc(db, 'app_settings', 'opay'), {
      bankName: bankName.trim(),
      accountName: accountName.trim(),
      accountNumber: accountNumber.trim(),
      updatedAt: serverTimestamp(),
    });
    setOpaySavedMsg('OPay bank details saved live.');
    window.setTimeout(() => setOpaySavedMsg(null), 3000);
  };

  const handleReviewPayment = async (p: PaymentDoc, approve: boolean) => {
    try {
      await updateDoc(doc(db, 'payments', p.id), {
        status: approve ? 'APPROVED' : 'REJECTED',
        reviewedAt: serverTimestamp(),
      });
      if (approve) {
        const subPlan: SubscriptionPlanCode =
          p.plan === 'Yearly' ? 'YEARLY_35000' : 'MONTHLY_5000';
        const days = p.plan === 'Yearly' ? 365 : 30;
        const expiresAtTs = Timestamp.fromMillis(Date.now() + days * 24 * 60 * 60 * 1000);
        const targetUser = allUsers.find((u) => u.uid === p.userId);
        const month = getWatMonthKey();

        await updateDoc(doc(db, 'users', p.userId), {
          subscription: 'active',
          subscriptionPlan: subPlan,
          subscriptionStatus: 'active',
          subscriptionExpiresAt: expiresAtTs,
        });

        await addDoc(collection(db, 'subscriptions'), {
          userId: p.userId,
          plan: subPlan,
          status: 'active',
          amount: p.amount,
          createdAt: serverTimestamp(),
          expiresAt: expiresAtTs,
        });

        // Sync subscription onto current month user_usage_stats so Top 10 eligibility updates instantly
        const statId = `${p.userId}_${month}`;
        const existingStat = usageStats.find((s) => s.userId === p.userId);
        if (existingStat) {
          await updateDoc(doc(db, 'user_usage_stats', existingStat.id), {
            subscriptionPlan: subPlan,
            subscriptionStatus: 'active',
            subscriptionExpiresAt: expiresAtTs,
          });
        } else {
          const targetPhoto = targetUser?.profilePicUrl || targetUser?.photoURL || '';
          const eff = calculateMonthlyGuardScore(targetUser?.monthlyBreakdown, Date.now());
          await setDoc(doc(db, 'user_usage_stats', statId), {
            userId: p.userId,
            name: targetUser?.fullName || p.userName || 'Guard AI Member',
            avatar: targetPhoto,
            profilePicUrl: targetPhoto,
            city: targetUser?.city || '',
            state: targetUser?.state || targetUser?.userState || '',
            subscriptionPlan: subPlan,
            subscriptionStatus: 'active',
            subscriptionExpiresAt: expiresAtTs,
            totalScans: 0,
            totalReports: 0,
            verifiedReports: 0,
            totalUsageDays: 1,
            lastActiveDate: getWatDateKey(),
            totalUsageMinutes: 0,
            totalPoints: 20,
            guardScore: eff.guardScore,
            monthlyBreakdown: normalizeBreakdown(targetUser?.monthlyBreakdown),
            scoreHistory: [],
            month,
            cheatingFlagged: false,
            lastActive: serverTimestamp(),
            lastActiveAt: serverTimestamp(),
          });
        }

        // Check referrals/{p.userId} and reward referrer ONLY IF referrer is active subscriber
        try {
          const refSnap = await getDoc(doc(db, 'referrals', p.userId));
          if (refSnap.exists()) {
            const refData = refSnap.data() as Partial<ReferralDoc>;
            if (!refData.rewardPaid && refData.referrerUid) {
              const referrer = allUsers.find((u) => u.uid === refData.referrerUid);
              const referrerSub = getEffectiveSubscription(referrer);
              if (referrer && referrerSub.isSubscriber) {
                const refStat = usageStats.find((s) => s.userId === referrer.uid);
                const { nextBreakdown } = applySubscribedReferralBreakdown(
                  refStat?.monthlyBreakdown || referrer.monthlyBreakdown
                );
                const { guardScore: refGuardScore } = calculateMonthlyGuardScore(
                  nextBreakdown,
                  Date.now()
                );

                await updateDoc(doc(db, 'users', referrer.uid), {
                  walletBalance: increment(1000),
                  availableBalanceNaira: increment(1000),
                  totalEarnedNaira: increment(1000),
                  guardScore: refGuardScore,
                  guardScoreMonth: month,
                  monthlyBreakdown: nextBreakdown,
                });

                await addDoc(collection(db, 'wallet_transactions'), {
                  userId: referrer.uid,
                  amount: 1000,
                  type: 'REFERRAL_BONUS',
                  status: 'paid',
                  description: `Referral Bonus — ${p.userName || targetUser?.fullName || 'Subscribed Friend'}`,
                  createdAt: serverTimestamp(),
                });

                const refStatRef = doc(db, 'user_usage_stats', refStat?.id || `${referrer.uid}_${month}`);
                const prevHist: ScoreHistoryEntry[] = Array.isArray(refStat?.scoreHistory)
                  ? refStat.scoreHistory
                  : [];
                const nextHist: ScoreHistoryEntry[] = [
                  {
                    action: `Subscribed Referral Bonus (+200)`,
                    delta: 200,
                    at: new Date().toISOString(),
                  },
                  ...prevHist,
                ].slice(0, 30);

                if (refStat) {
                  await updateDoc(refStatRef, {
                    guardScore: refGuardScore,
                    monthlyBreakdown: nextBreakdown,
                    scoreHistory: nextHist,
                  });
                }

                await updateDoc(doc(db, 'referrals', p.userId), {
                  status: 'Reward Paid',
                  rewardPaid: true,
                  rewardAmount: 1000,
                  subscribedPlan: subPlan,
                  subscriptionStatus: 'active',
                  subscribedAt: serverTimestamp(),
                });
                showToast(
                  `Approved ${subPlan}. Credited referrer ${referrer.fullName} +₦1,000 & +200 Guard Score.`
                );
              } else {
                await updateDoc(doc(db, 'referrals', p.userId), {
                  status: 'SUBSCRIBED',
                  rewardPaid: false,
                  rewardAmount: 0,
                  subscribedPlan: subPlan,
                  subscriptionStatus: 'active',
                  rewardNote: 'Referrer was not subscribed when friend activated',
                  subscribedAt: serverTimestamp(),
                });
                showToast(`Approved ${subPlan}. Referrer is FREE so no ₦1,000 bonus paid.`);
              }
            } else {
              showToast(`Approved ${subPlan} subscription.`);
            }
          } else {
            showToast(`Approved ${subPlan} subscription.`);
          }
        } catch (refErr) {
          console.warn('Referral payout check warning:', refErr);
        }
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `payments/${p.id}`);
    }
  };

  // Top 10 Monthly Payout + Archive to leaderboardHistory + Reset Scores to 0
  const top10Guardians = sortTop10Guardians(usageStats);
  const starterUsageStats = usageStats
    .filter((s) => isStarterUserRecord(s))
    .map((s) => ({ ...s, guardScore: getEffectiveGuardScore(s) }))
    .sort((a, b) => (b.guardScore ?? 0) - (a.guardScore ?? 0));
  const currentMonthKey = getWatMonthKey();

  const handleToggleShowStarters = async () => {
    setStarterBusy(true);
    try {
      const nextShow = !starterSettings.showInApp;
      await setDoc(
        doc(db, 'app_settings', 'starter_guards'),
        {
          showInApp: nextShow,
          ...(nextShow ? { starterRemoved: false } : {}),
        },
        { merge: true }
      );
      showToast(
        nextShow
          ? 'Starter Guards are now VISIBLE in the app.'
          : 'Starter Guards are now HIDDEN from users in the app.'
      );
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'app_settings/starter_guards');
    } finally {
      setStarterBusy(false);
    }
  };

  const handleSeedStarters = async () => {
    setStarterBusy(true);
    try {
      const count = await seedAllStarterGuardsToFirestore();
      showToast(`Seeded ${count} Starter Guards into database (STARTER - DEMO, no payout).`);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'user_usage_stats');
    } finally {
      setStarterBusy(false);
    }
  };

  const handleManualStarterShuffle = async () => {
    setStarterBusy(true);
    try {
      const count = await runMidnightStarterShuffleInFirestore(usageStats);
      showToast(
        count > 0
          ? `Shuffled ${count} Starter Guards for today (-20 to +30 pts, -1 to +2 reports).`
          : 'No Starter Guards found in this month. Seed 56 Starter Guards first.'
      );
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'user_usage_stats');
    } finally {
      setStarterBusy(false);
    }
  };

  const handleFreezeMonthAndDeclareWinners = async () => {
    setStarterBusy(true);
    try {
      const summary = buildEndOfMonthWinnerSummary(usageStats, currentMonthKey);
      await setDoc(
        doc(db, 'app_settings', 'starter_guards'),
        {
          frozenMonth: currentMonthKey,
          monthlyWinnerSummary: summary,
          frozenAt: serverTimestamp(),
        },
        { merge: true }
      );
      const topName = summary.topUsers[0]?.name || 'No Real Subscribers Yet';
      showToast(
        `Frozen ${summary.monthName} leaderboard! Top User of ${summary.monthName}: ${topName} - ₦10,000.`
      );
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'app_settings/starter_guards');
    } finally {
      setStarterBusy(false);
    }
  };

  const handleConfirmRemoveAllStarters = async () => {
    setStarterBusy(true);
    try {
      const deletedCount = await removeAllStarterGuardsFromFirestore();
      setRemoveStartersModalOpen(false);
      showToast(`Removed all Starter Guards cleanly (${deletedCount} records deleted).`);
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, 'user_usage_stats');
    } finally {
      setStarterBusy(false);
    }
  };

  const handlePayTop10Monthly = async () => {
    if (top10Guardians.length === 0) return;

    // Hard Payout Safety Check: NEVER pay a Starter Guard or inactive/free account
    for (const candidate of top10Guardians) {
      const check = validatePayoutRecipient(candidate);
      if (!check.ok) {
        setPayoutConfirmOpen(false);
        showToast(check.error);
        return;
      }
    }

    setPayoutBusy(true);
    try {
      const winners = top10Guardians.map((w, idx) => ({
        rank: idx + 1,
        userId: w.userId,
        name: w.name,
        city: w.city || w.state || 'Nigeria',
        guardScore: getEffectiveGuardScore(w),
        prize: 10000,
      }));

      for (const w of winners) {
        await updateDoc(doc(db, 'users', w.userId), {
          walletBalance: increment(10000),
          availableBalanceNaira: increment(10000),
          totalEarnedNaira: increment(10000),
        });
        await addDoc(collection(db, 'wallet_transactions'), {
          userId: w.userId,
          amount: 10000,
          type: 'TOP10_PRIZE',
          status: 'paid',
          description: `Top 10 Guardians Prize #${w.rank} (${currentMonthKey})`,
          createdAt: serverTimestamp(),
        });
      }

      const totalPaid = winners.length * 10000;
      await addDoc(collection(db, 'leaderboardHistory'), {
        month: currentMonthKey,
        totalPaid,
        winners,
        paidByAdminId: adminUser.uid,
        paidAt: serverTimestamp(),
      });

      // Reset real user monthly Guard Scores & breakdowns to 0
      const batch = writeBatch(db);
      usageStats.forEach((st) => {
        if (!isStarterUserRecord(st)) {
          batch.update(doc(db, 'user_usage_stats', st.id), {
            guardScore: 0,
            monthlyBreakdown: EMPTY_MONTHLY_BREAKDOWN,
            scoreHistory: [],
          });
        }
      });
      allUsers.forEach((u) => {
        if (!isStarterUserRecord(u) && ((u.guardScore || 0) > 0 || u.monthlyBreakdown)) {
          batch.update(doc(db, 'users', u.uid), {
            guardScore: 0,
            monthlyBreakdown: EMPTY_MONTHLY_BREAKDOWN,
          });
        }
      });
      await batch.commit();

      setPayoutConfirmOpen(false);
      showToast(
        `Paid ₦${totalPaid.toLocaleString()} across ${winners.length} real subscribers, archived to leaderboardHistory, and reset scores to 0.`
      );
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'leaderboardHistory');
    } finally {
      setPayoutBusy(false);
    }
  };

  const handleToggleCheatFlag = async (stat: UserUsageStat) => {
    await updateDoc(doc(db, 'user_usage_stats', stat.id), {
      cheatingFlagged: !stat.cheatingFlagged,
    });
  };

  const handlePublishTip = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tipBody.trim()) return;
    await addDoc(collection(db, 'sansa_memory'), {
      title: tipTitle.trim() || 'Daily Safety Tip from Sansa',
      message: tipBody.trim(),
      isPublicTip: true,
      createdAt: serverTimestamp(),
    });
    setTipTitle('');
    setTipBody('');
  };

  const handleBroadcastWish = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!wishText.trim()) return;
    await addDoc(collection(db, 'notifications'), {
      targetAll: true,
      message: wishText.trim(),
      read: false,
      createdAt: serverTimestamp(),
    });
    setWishText('');
  };

  // Real users inactive > 24h (exclude Starter Guards)
  const nowMs = Date.now();
  const realUsersList = allUsers.filter((u) => !isStarterUserRecord(u));
  const starterUsersList = allUsers.filter((u) => isStarterUserRecord(u));
  const filteredOverviewUsers =
    usersFilter === 'real'
      ? realUsersList
      : usersFilter === 'starter'
      ? starterUsersList
      : allUsers;
  const inactiveUsers24h = realUsersList.filter((u) => {
    const t = u.lastActive?.toMillis ? u.lastActive.toMillis() : 0;
    return !t || nowMs - t > 24 * 60 * 60 * 1000;
  });

  return (
    <div className="flex flex-col min-h-full">
      <div className="flex-1 px-4 py-4 space-y-4 max-w-3xl mx-auto w-full">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-extrabold text-white flex items-center gap-2">
              <ShieldAlert className="w-5 h-5 text-[#FF2D55]" />
              <span>Guard AI Admin Command</span>
            </h1>
            <p className="text-xs text-slate-400">
              Live Telemetry, Police Dispatch, Payments &amp; Anti-Cheat
            </p>
          </div>
        </div>

        {/* Live KPI Row */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
          {[
            { label: 'Total Users', val: allUsers.length, color: 'text-white' },
            { label: 'Alerts Today', val: alertsTodayCount, color: 'text-[#FF2D55]' },
            { label: 'Scans Today', val: scansTodayCount, color: 'text-[#00E67A]' },
            { label: 'Pending Reports', val: pendingReportsCount, color: 'text-[#FFC400]' },
            { label: 'Pending OPay', val: pendingPaymentsCount, color: 'text-[#2E9BFF]' },
          ].map((k) => (
            <div
              key={k.label}
              className="bg-[#0C1626] border border-slate-800 rounded-2xl p-3 text-center"
            >
              <p className={`text-lg font-extrabold font-mono ${k.color}`}>{k.val}</p>
              <p className="text-[10px] text-slate-400">{k.label}</p>
            </div>
          ))}
        </div>

        {adminToast && (
          <div className="p-3 rounded-xl bg-[#00E67A]/15 border border-[#00E67A]/50 text-xs font-bold text-[#00E67A]">
            {adminToast}
          </div>
        )}

        {/* Sub-Section Selector */}
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          {[
            { id: 'reports', label: `Reports (${pendingReportsCount})`, icon: Shield },
            { id: 'top10', label: `Top 10 (${top10Guardians.length})`, icon: Trophy },
            { id: 'police', label: `Police (${stations.length})`, icon: Phone },
            { id: 'payments', label: `OPay (${pendingPaymentsCount})`, icon: CreditCard },
            { id: 'overview', label: 'Users & GPS', icon: Users },
            { id: 'leaderboard', label: 'Anti-Cheat', icon: Flag },
            { id: 'audit', label: `Audit (${flaggedReportersCount})`, icon: ShieldAlert },
            { id: 'broadcast', label: 'Tips & Biz', icon: Sparkles },
          ].map((t) => {
            const Icon = t.icon;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setSubSection(t.id as typeof subSection)}
                className={`px-3 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 whitespace-nowrap cursor-pointer border ${
                  subSection === t.id
                    ? 'bg-[#2E9BFF] border-[#2E9BFF] text-white'
                    : 'bg-[#0C1626] border-slate-800 text-slate-300'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{t.label}</span>
              </button>
            );
          })}
        </div>

        {/* 1. REPORTS TO VERIFY, PAY (SUBSCRIBERS ONLY), & FORWARD POLICE */}
        {subSection === 'reports' && (
          <div className="space-y-3">
            {reports.length === 0 ? (
              <p className="text-xs text-slate-400 text-center py-6 bg-[#0C1626] rounded-2xl border border-slate-800">
                No incident reports submitted yet.
              </p>
            ) : (
              reports.map((rep) => {
                const authorUser = allUsers.find((u) => u.uid === rep.userId);
                const effSub = getEffectiveSubscription(authorUser);
                const isMine = rep.userId === adminUser.uid;
                const repAvatar = isMine
                  ? globalProfile.photo || adminPhoto
                  : authorUser?.profilePicUrl || authorUser?.photoURL || rep.userProfilePic;
                const alreadyApproved = rep.adminDecision === 'approved';
                const alreadyRejected = rep.adminDecision === 'rejected';
                return (
                  <div
                    key={rep.id}
                    className="bg-[#0C1626] border border-slate-800 rounded-2xl p-4 space-y-3"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-start gap-2.5 min-w-0">
                        <UserAvatar
                          photoURL={repAvatar}
                          name={isMine ? globalProfile.name : rep.userName}
                          size="40"
                          borderVariant={isMine ? 'purple' : 'none'}
                          fallbackVariant={isMine ? 'purple' : 'grey'}
                        />
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-xs font-extrabold text-[#FF2D55]">
                              {rep.incidentType}
                            </span>
                            <span
                              className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                effSub.isSubscriber
                                  ? 'bg-[#00E67A]/15 text-[#00E67A]'
                                  : 'bg-slate-800 text-slate-400'
                              }`}
                            >
                              {effSub.plan}
                            </span>
                          </div>
                          <h3 className="text-sm font-bold text-white truncate">
                            {isMine ? globalProfile.name : rep.userName}
                          </h3>
                          <p className="text-xs text-slate-400 truncate">{rep.incidentAddress}</p>
                          <p className="text-[11px] font-mono text-slate-500">
                            Admin Coords: {rep.gpsLat?.toFixed(5)}, {rep.gpsLng?.toFixed(5)} • State:{' '}
                            {rep.incidentState || 'Unknown'}
                          </p>
                        </div>
                      </div>
                      <span className="px-2.5 py-1 rounded-lg bg-slate-800 text-[11px] font-bold text-[#FFC400] shrink-0">
                        {rep.status}
                      </span>
                    </div>

                    {rep.description && <p className="text-xs text-slate-300">{rep.description}</p>}

                    {/* V Score & Anti-Spam Audit Breakdown */}
                    <div className="p-2.5 rounded-xl bg-[#050B14] border border-slate-800 text-[11px] font-mono text-slate-300 space-y-1">
                      <div className="flex flex-wrap gap-3">
                        {typeof rep.guardAiScore === 'number' && (
                          <>
                            <span>V Score: {Math.round(rep.guardAiScore * 100)}%</span>
                            <span>Verdict: {rep.aiVerdict}</span>
                            <span>Duration: {rep.videoDurationSec || 0}s</span>
                          </>
                        )}
                        <span
                          className={
                            rep.visibleOnMap ? 'text-[#00E67A]' : 'text-[#FFC400]'
                          }
                        >
                          Map: {rep.visibleOnMap ? 'Visible (Verified)' : 'Hidden (Pending)'}
                        </span>
                        {authorUser?.flaggedReporter && (
                          <span className="text-[#FF2D55] font-bold">FLAGGED REPORTER</span>
                        )}
                      </div>
                      {rep.device && (
                        <p className="text-[10px] text-slate-400 truncate">
                          Device: {rep.device}
                        </p>
                      )}
                    </div>

                    {rep.videoUrl &&
                      (rep.videoUrl.startsWith('http') || rep.videoUrl.startsWith('data:video')) && (
                        <video
                          src={rep.videoUrl}
                          controls
                          className="w-full h-44 rounded-xl bg-black object-cover"
                        />
                      )}

                    {!alreadyApproved && !alreadyRejected && (
                      <div className="flex flex-wrap gap-2 pt-1">
                        <button
                          type="button"
                          onClick={() => handleVerifyReportClick(rep)}
                          className="flex-1 min-w-[160px] py-2.5 px-3 rounded-xl bg-[#00E67A] text-slate-950 font-extrabold text-xs cursor-pointer"
                        >
                          {effSub.isSubscriber
                            ? 'Verify Report (+₦5,000 + Police)'
                            : 'Verify Report (FREE — ₦0)'}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleRejectReport(rep)}
                          className="py-2.5 px-3 rounded-xl bg-[#FF2D55]/15 text-[#FF2D55] font-bold text-xs cursor-pointer"
                        >
                          Reject (-250 Score)
                        </button>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        )}

        {/* 1b. TOP 10 GUARDIANS OF THE MONTH PAYOUT, STARTER GUARDS CONTROL & FREEZE */}
        {subSection === 'top10' && (
          <div className="space-y-4">
            {/* Starter Guards Admin Controls */}
            <div className="bg-[#0C1626] border border-slate-800 rounded-2xl p-4 space-y-3">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div>
                  <h3 className="text-xs font-extrabold text-white flex items-center gap-1.5">
                    <Users className="w-4 h-4 text-[#FFC400]" />
                    <span>Guards AI System Controls ({starterUsageStats.length} Starter Guards Active)</span>
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    Starter Guards are strictly blocked from payouts &amp; end-of-month prizes.
                  </p>
                </div>
                <button
                  type="button"
                  disabled={starterBusy}
                  onClick={handleToggleShowStarters}
                  className={`px-3 py-2 rounded-xl text-xs font-extrabold flex items-center gap-1.5 cursor-pointer disabled:opacity-50 ${
                    starterSettings.showInApp && !starterSettings.starterRemoved
                      ? 'bg-[#00E67A] text-slate-950'
                      : 'bg-slate-800 text-slate-300'
                  }`}
                >
                  {starterSettings.showInApp && !starterSettings.starterRemoved ? (
                    <Eye className="w-3.5 h-3.5" />
                  ) : (
                    <EyeOff className="w-3.5 h-3.5" />
                  )}
                  <span>
                    Show Starter Guards in App:{' '}
                    {starterSettings.showInApp && !starterSettings.starterRemoved ? 'ON' : 'OFF'}
                  </span>
                </button>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={starterBusy}
                  onClick={handleSeedStarters}
                  className="px-3 py-2 rounded-xl bg-[#2E9BFF]/15 border border-[#2E9BFF]/40 text-[#2E9BFF] font-bold text-xs flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  <Database className="w-3.5 h-3.5" />
                  <span>Seed / Sync 56 Starter Guards</span>
                </button>
                <button
                  type="button"
                  disabled={starterBusy}
                  onClick={handleManualStarterShuffle}
                  className="px-3 py-2 rounded-xl bg-[#FFC400]/15 border border-[#FFC400]/40 text-[#FFC400] font-bold text-xs flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Run Daily Shuffle (-20/+30)</span>
                </button>
                <button
                  type="button"
                  disabled={starterBusy}
                  onClick={handleFreezeMonthAndDeclareWinners}
                  className="px-3 py-2 rounded-xl bg-[#00E67A]/15 border border-[#00E67A]/40 text-[#00E67A] font-bold text-xs flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  <Crown className="w-3.5 h-3.5" />
                  <span>Freeze Month &amp; Declare Winners</span>
                </button>
                <button
                  type="button"
                  disabled={starterBusy}
                  onClick={() => setRemoveStartersModalOpen(true)}
                  className="px-3 py-2 rounded-xl bg-[#FF2D55]/15 border border-[#FF2D55]/40 text-[#FF2D55] font-bold text-xs flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Remove All Starter Guards</span>
                </button>
              </div>

              {starterSettings.frozenMonth === currentMonthKey &&
                starterSettings.monthlyWinnerSummary && (
                  <div className="p-3 rounded-xl bg-[#00E67A]/10 border border-[#00E67A]/40 text-xs text-white flex items-center justify-between gap-2">
                    <span>
                      <strong>Frozen ({starterSettings.monthlyWinnerSummary.monthName}):</strong>{' '}
                      {starterSettings.monthlyWinnerSummary.topUsers[0]
                        ? `Top User of ${starterSettings.monthlyWinnerSummary.monthName}: ${starterSettings.monthlyWinnerSummary.topUsers[0].name} - ₦10,000`
                        : 'No real subscriber winners declared yet.'}
                    </span>
                    <button
                      type="button"
                      disabled={starterBusy}
                      onClick={() =>
                        setDoc(
                          doc(db, 'app_settings', 'starter_guards'),
                          { frozenMonth: '' },
                          { merge: true }
                        )
                      }
                      className="px-2.5 py-1 rounded-lg bg-slate-800 text-slate-300 text-[11px] font-bold cursor-pointer shrink-0"
                    >
                      Unfreeze
                    </button>
                  </div>
                )}
            </div>

            {/* Dual Sub-Tabs: Real Users Payout vs Starter Guards (No Payout) */}
            <div className="grid grid-cols-2 gap-2 bg-[#0C1626] border border-slate-800 p-1.5 rounded-2xl">
              <button
                type="button"
                onClick={() => setPayoutSubTab('real')}
                className={`py-2.5 px-3 rounded-xl text-xs font-extrabold cursor-pointer ${
                  payoutSubTab === 'real'
                    ? 'bg-[#00E67A] text-slate-950'
                    : 'text-slate-300 hover:text-white'
                }`}
              >
                Real Users Payout ({top10Guardians.length})
              </button>
              <button
                type="button"
                onClick={() => setPayoutSubTab('starter')}
                className={`py-2.5 px-3 rounded-xl text-xs font-extrabold cursor-pointer ${
                  payoutSubTab === 'starter'
                    ? 'bg-[#FFC400] text-slate-950'
                    : 'text-slate-300 hover:text-white'
                }`}
              >
                Starter Guards (No Payout) ({starterUsageStats.length})
              </button>
            </div>

            {payoutSubTab === 'real' ? (
              <>
                <div className="bg-[#0C1626] border border-[#00E67A]/40 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-extrabold text-white flex items-center gap-2">
                      <Trophy className="w-4 h-4 text-[#FFC400]" />
                      <span>Real Users Payout — {currentMonthKey}</span>
                    </h2>
                    <p className="text-[11px] text-slate-400">
                      Real active subscribers ONLY ({top10Guardians.length}/10 winners). Prize:
                      ₦10,000 each (Total: ₦{(top10Guardians.length * 10000).toLocaleString()}).
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={top10Guardians.length === 0 || payoutBusy}
                    onClick={() => setPayoutConfirmOpen(true)}
                    className="px-4 py-2.5 rounded-xl bg-[#00E67A] text-slate-950 font-extrabold text-xs cursor-pointer disabled:opacity-50 shrink-0"
                  >
                    Pay Top 10 - ₦{(top10Guardians.length * 10000).toLocaleString()}
                  </button>
                </div>

                {top10Guardians.length === 0 ? (
                  <div className="bg-[#0C1626] border border-slate-800 rounded-2xl p-6 text-center text-xs text-slate-400">
                    No active paid real subscribers with Guard Score activity this month yet.
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    {top10Guardians.map((g, idx) => {
                      const u = allUsers.find((usr) => usr.uid === g.userId);
                      const sub = getEffectiveSubscription(g);
                      const b = normalizeBreakdown(g.monthlyBreakdown);
                      const expanded = expandedTop10Id === g.id;
                      return (
                        <div
                          key={g.id}
                          className="bg-[#0C1626] border border-slate-800 rounded-2xl p-3.5 space-y-2"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2.5 min-w-0">
                              <span className="w-6 text-center text-xs font-extrabold font-mono text-[#FFC400]">
                                #{idx + 1}
                              </span>
                              <UserAvatar
                                photoURL={u?.profilePicUrl || u?.photoURL || g.profilePicUrl || g.avatar}
                                name={g.name}
                                size="sm"
                                borderVariant="green"
                                fallbackVariant="letter"
                              />
                              <div className="min-w-0">
                                <p className="text-sm font-extrabold text-white truncate">{g.name}</p>
                                <p className="text-[11px] text-slate-400 truncate">
                                  {g.state || g.city || u?.city || 'Nigeria'} • {sub.plan}
                                  {sub.expiresAtMs
                                    ? ` (exp ${new Date(sub.expiresAtMs).toLocaleDateString()})`
                                    : ''}
                                </p>
                              </div>
                            </div>
                            <div className="text-right shrink-0">
                              <p className="text-sm font-extrabold font-mono text-[#2E9BFF]">
                                {getEffectiveGuardScore(g).toLocaleString()} Score
                              </p>
                              <p className="text-[11px] font-bold text-[#00E67A]">₦10,000 Prize</p>
                            </div>
                          </div>

                          <div className="flex flex-wrap gap-1.5 text-[10px] font-mono text-slate-300">
                            <span className="px-2 py-0.5 rounded bg-[#050B14] border border-slate-800">
                              Reports: {b.verifiedGunshotRobberyKidnapReports + b.verifiedOtherReports}
                            </span>
                            <span className="px-2 py-0.5 rounded bg-[#050B14] border border-slate-800">
                              Road: {b.roadScansCount}
                            </span>
                            <span className="px-2 py-0.5 rounded bg-[#050B14] border border-slate-800">
                              Bldg: {b.buildingScansCount}
                            </span>
                            <span className="px-2 py-0.5 rounded bg-[#050B14] border border-slate-800">
                              Veh: {b.vehicleScansCount}
                            </span>
                            <span className="px-2 py-0.5 rounded bg-[#050B14] border border-slate-800">
                              Night: {b.nightWatchScansCount}
                            </span>
                            <span className="px-2 py-0.5 rounded bg-[#050B14] border border-slate-800">
                              Upvotes: {b.communityUpvotesCount || 0}
                            </span>
                            <span className="px-2 py-0.5 rounded bg-[#050B14] border border-slate-800">
                              Check-Ins: {b.dailyCheckInsCount}
                            </span>
                            <span className="px-2 py-0.5 rounded bg-[#050B14] border border-slate-800">
                              Refs: {b.subscribedReferralsCount}
                            </span>
                            {b.falseRejectedReportsCount > 0 && (
                              <span className="px-2 py-0.5 rounded bg-[#FF2D55]/15 text-[#FF2D55]">
                                False: -{b.falseRejectedReportsCount * 250}
                              </span>
                            )}
                          </div>

                          <button
                            type="button"
                            onClick={() => setExpandedTop10Id(expanded ? null : g.id)}
                            className="text-[11px] font-bold text-[#2E9BFF] underline cursor-pointer"
                          >
                            {expanded ? 'Hide Score History' : 'View Score History'}
                          </button>

                          {expanded && (
                            <div className="p-2.5 rounded-xl bg-[#050B14] border border-slate-800 space-y-1 max-h-40 overflow-y-auto text-[11px] font-mono">
                              {!g.scoreHistory || g.scoreHistory.length === 0 ? (
                                <p className="text-slate-500">No logged events yet.</p>
                              ) : (
                                g.scoreHistory.map((h, i) => (
                                  <div key={i} className="flex justify-between gap-2 text-slate-300">
                                    <span className="truncate">{h.action}</span>
                                    <span
                                      className={h.delta >= 0 ? 'text-[#00E67A]' : 'text-[#FF2D55]'}
                                    >
                                      {h.delta >= 0 ? `+${h.delta}` : h.delta}
                                    </span>
                                  </div>
                                ))
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Past Paid Months Archive */}
                {leaderboardHistory.length > 0 && (
                  <div className="bg-[#0C1626] border border-slate-800 rounded-2xl p-4 space-y-2.5">
                    <h3 className="text-xs font-extrabold text-white">Past Top 10 Payout Archives</h3>
                    {leaderboardHistory.map((hist) => (
                      <div
                        key={hist.id}
                        className="p-3 rounded-xl bg-[#050B14] border border-slate-800 text-xs flex items-center justify-between"
                      >
                        <div>
                          <p className="font-bold text-white">{hist.month}</p>
                          <p className="text-[11px] text-slate-400">
                            {hist.winners?.length || 0} winners paid
                          </p>
                        </div>
                        <span className="font-mono font-extrabold text-[#00E67A]">
                          ₦{Number(hist.totalPaid || 0).toLocaleString()}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </>
            ) : (
              /* Starter Guards (No Payout) Tab */
              <div className="space-y-2.5">
                <div className="p-3.5 rounded-2xl bg-[#FFC400]/10 border border-[#FFC400]/40 text-xs font-bold text-[#FFC400]">
                  Starter Guards (No Payout) — Starter Guards are not eligible for cash prizes or
                  monthly payouts. They automatically slide down as real subscribers climb.
                </div>
                {starterUsageStats.length === 0 ? (
                  <div className="bg-[#0C1626] border border-slate-800 rounded-2xl p-6 text-center text-xs text-slate-400">
                    No Starter Guards currently in database. Click &ldquo;Seed / Sync 56 Starter Guards&rdquo; above if needed.
                  </div>
                ) : (
                  starterUsageStats.map((g, idx) => (
                    <div
                      key={g.id}
                      className="bg-[#0C1626] border border-slate-800 rounded-2xl p-3 flex items-center justify-between gap-2 text-xs"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span className="w-7 font-mono font-bold text-slate-400 shrink-0">
                          #{idx + 1}
                        </span>
                        <UserAvatar
                          photoURL={g.profilePicUrl || g.avatar}
                          name={g.name}
                          size="xs"
                          fallbackVariant="letter"
                        />
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="font-bold text-white truncate">{g.name}</span>
                            <span className="px-1.5 py-0.5 rounded bg-[#FFC400]/15 text-[#FFC400] text-[10px] font-extrabold">
                              STARTER - DEMO
                            </span>
                          </div>
                          <p className="text-[10px] text-slate-400 truncate">
                            {g.state || g.city} • {g.verifiedReports} verified reports •{' '}
                            {(g.guardScore ?? 0).toLocaleString()} pts
                          </p>
                        </div>
                      </div>
                      <span className="px-2 py-1 rounded-lg bg-[#FF2D55]/15 text-[#FF2D55] text-[10px] font-extrabold shrink-0">
                        ₦0 (Ineligible)
                      </span>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        )}

        {/* 2. POLICE STATIONS MANAGER (ADMIN ONLY, 37 STATES) */}
        {subSection === 'police' && (
          <div className="space-y-4">
            {stations.length === 0 && (
              <div className="p-4 rounded-2xl bg-[#0C1626] border border-[#00E67A]/40 flex items-center justify-between gap-3">
                <p className="text-xs text-slate-200">
                  Police directory is empty. Seed all 37 Nigerian states verified contacts?
                </p>
                <button
                  type="button"
                  disabled={seedingPolice}
                  onClick={handleSeedAll37StatesPolice}
                  className="px-3.5 py-2 rounded-xl bg-[#00E67A] text-slate-950 font-extrabold text-xs flex items-center gap-1.5 shrink-0 cursor-pointer"
                >
                  <Database className="w-4 h-4" />
                  <span>{seedingPolice ? 'Loading...' : 'Seed 37 States'}</span>
                </button>
              </div>
            )}

            <form
              onSubmit={handleAddPoliceStation}
              className="bg-[#0C1626] border border-slate-800 rounded-2xl p-4 space-y-2.5"
            >
              <h3 className="text-xs font-extrabold text-white">Add State Police Contact</h3>
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="text"
                  required
                  placeholder="State (e.g. Rivers, Abuja, Lagos)"
                  value={newState}
                  onChange={(e) => setNewState(e.target.value)}
                  className="px-3 py-2 rounded-xl bg-[#050B14] border border-slate-800 text-xs text-white"
                />
                <input
                  type="text"
                  placeholder="Area / Command"
                  value={newArea}
                  onChange={(e) => setNewArea(e.target.value)}
                  className="px-3 py-2 rounded-xl bg-[#050B14] border border-slate-800 text-xs text-white"
                />
                <input
                  type="text"
                  required
                  placeholder="Station Name"
                  value={newStationName}
                  onChange={(e) => setNewStationName(e.target.value)}
                  className="col-span-2 px-3 py-2 rounded-xl bg-[#050B14] border border-slate-800 text-xs text-white"
                />
                <input
                  type="tel"
                  required
                  placeholder="Primary Phone"
                  value={newPhone1}
                  onChange={(e) => setNewPhone1(e.target.value)}
                  className="px-3 py-2 rounded-xl bg-[#050B14] border border-slate-800 text-xs text-white"
                />
                <input
                  type="tel"
                  placeholder="Secondary Phone"
                  value={newPhone2}
                  onChange={(e) => setNewPhone2(e.target.value)}
                  className="px-3 py-2 rounded-xl bg-[#050B14] border border-slate-800 text-xs text-white"
                />
              </div>
              <button
                type="submit"
                className="w-full py-2.5 rounded-xl bg-[#2E9BFF] text-white font-bold text-xs cursor-pointer"
              >
                Save Police Station
              </button>
            </form>

            <div className="space-y-2">
              {stations.map((st) => (
                <div
                  key={st.id}
                  className="bg-[#0C1626] border border-slate-800 rounded-2xl p-3.5 flex items-center justify-between gap-2 text-xs"
                >
                  <div className="min-w-0">
                    <p className="font-extrabold text-white truncate">
                      {st.state} — {st.stationName}
                    </p>
                    <p className="text-slate-400 font-mono">
                      {st.phone1} {st.phone2 && st.phone2 !== st.phone1 ? `• ${st.phone2}` : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() =>
                        updateDoc(doc(db, 'police_stations', st.id), {
                          isActive: !st.isActive,
                        })
                      }
                      className={`px-2 py-1 rounded-lg text-[10px] font-bold cursor-pointer ${
                        st.isActive
                          ? 'bg-[#00E67A]/15 text-[#00E67A]'
                          : 'bg-[#FF2D55]/15 text-[#FF2D55]'
                      }`}
                    >
                      {st.isActive ? 'Active' : 'Not Working'}
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteDoc(doc(db, 'police_stations', st.id))}
                      className="p-1.5 rounded-lg bg-slate-800 text-slate-400 hover:text-[#FF2D55] cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 3. OPAY SETTINGS & RECEIPT APPROVALS */}
        {subSection === 'payments' && (
          <div className="space-y-4">
            <form
              onSubmit={handleSaveOPaySettings}
              className="bg-[#0C1626] border border-slate-800 rounded-2xl p-4 space-y-3"
            >
              <h3 className="text-sm font-extrabold text-white">OPay Bank Account Settings</h3>
              <input
                type="text"
                placeholder="Bank Name (e.g. OPay)"
                value={bankName}
                onChange={(e) => setBankName(e.target.value)}
                className="w-full px-3 py-2.5 rounded-xl bg-[#050B14] border border-slate-800 text-xs text-white"
              />
              <input
                type="text"
                required
                placeholder="Account Name"
                value={accountName}
                onChange={(e) => setAccountName(e.target.value)}
                className="w-full px-3 py-2.5 rounded-xl bg-[#050B14] border border-slate-800 text-xs text-white"
              />
              <input
                type="text"
                required
                placeholder="OPay Account Number"
                value={accountNumber}
                onChange={(e) => setAccountNumber(e.target.value)}
                className="w-full px-3 py-2.5 rounded-xl bg-[#050B14] border border-slate-800 text-xs text-white font-mono"
              />
              {opaySavedMsg && <p className="text-xs text-[#00E67A]">{opaySavedMsg}</p>}
              <button
                type="submit"
                className="w-full py-2.5 rounded-xl bg-[#00E67A] text-slate-950 font-extrabold text-xs cursor-pointer"
              >
                Save OPay Details
              </button>
            </form>

            <div className="space-y-2.5">
              {payments.map((p) => (
                <div
                  key={p.id}
                  className="bg-[#0C1626] border border-slate-800 rounded-2xl p-4 space-y-2.5"
                >
                  <div className="flex items-center justify-between text-xs">
                    <div>
                      <p className="font-bold text-white">{p.userName || p.userId}</p>
                      <p className="text-slate-400">
                        {p.plan} — ₦{p.amount.toLocaleString()}
                      </p>
                    </div>
                    <span className="font-bold text-[#FFC400]">{p.status}</span>
                  </div>
                  {p.receiptImage && (
                    <img
                      src={p.receiptImage}
                      alt="OPay Receipt"
                      className="w-full h-40 object-contain rounded-xl bg-black border border-slate-800"
                    />
                  )}
                  {p.status === 'PENDING' && (
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => handleReviewPayment(p, true)}
                        className="py-2 rounded-xl bg-[#00E67A] text-slate-950 font-extrabold text-xs flex items-center justify-center gap-1 cursor-pointer"
                      >
                        <CheckCircle2 className="w-4 h-4" />
                        <span>Approve Plan</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleReviewPayment(p, false)}
                        className="py-2 rounded-xl bg-[#FF2D55] text-white font-bold text-xs flex items-center justify-center gap-1 cursor-pointer"
                      >
                        <XCircle className="w-4 h-4" />
                        <span>Reject</span>
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 4. USERS, STARTER LABELS/FILTER, SCREEN TIME & ADMIN RAW GPS */}
        {subSection === 'overview' && (
          <div className="space-y-4">
            {/* Filter Real Users vs Starter - Demo */}
            <div className="bg-[#0C1626] border border-slate-800 rounded-2xl p-3.5 space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap gap-1.5">
                  {[
                    { id: 'all', label: `All (${allUsers.length})` },
                    { id: 'real', label: `Real Users (${realUsersList.length})` },
                    { id: 'starter', label: `Starter - Demo (${starterUsersList.length})` },
                  ].map((f) => (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => setUsersFilter(f.id as typeof usersFilter)}
                      className={`px-3 py-1.5 rounded-xl text-xs font-extrabold cursor-pointer ${
                        usersFilter === f.id
                          ? 'bg-[#2E9BFF] text-white'
                          : 'bg-[#050B14] border border-slate-800 text-slate-300'
                      }`}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  disabled={starterBusy}
                  onClick={handleToggleShowStarters}
                  className={`px-2.5 py-1.5 rounded-xl text-[11px] font-bold cursor-pointer ${
                    starterSettings.showInApp && !starterSettings.starterRemoved
                      ? 'bg-[#00E67A]/15 text-[#00E67A]'
                      : 'bg-slate-800 text-slate-300'
                  }`}
                >
                  In-App Starters:{' '}
                  {starterSettings.showInApp && !starterSettings.starterRemoved ? 'ON' : 'OFF'}
                </button>
              </div>
            </div>

            {/* Red List: Real Users Inactive > 24h */}
            <div className="bg-[#0C1626] border border-[#FF2D55]/40 rounded-2xl p-4 space-y-2">
              <h3 className="text-xs font-extrabold text-[#FF2D55]">
                Real Users Not Logged In Last 24 Hours ({inactiveUsers24h.length})
              </h3>
              {inactiveUsers24h.length === 0 ? (
                <p className="text-xs text-slate-400">All real users active within 24 hours.</p>
              ) : (
                <div className="space-y-1 max-h-36 overflow-y-auto text-xs text-slate-300">
                  {inactiveUsers24h.map((u) => (
                    <div key={u.uid} className="flex justify-between">
                      <span>{u.fullName}</span>
                      <span className="text-slate-500">{u.email || u.phone}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Users List + Starter/Real Labels + Admin Raw Coordinates */}
            <div className="space-y-2">
              {filteredOverviewUsers.map((u) => {
                const isStarter = isStarterUserRecord(u);
                const coord = liveCoords[u.uid];
                const uSessions = sessions.filter((s) => s.userId === u.uid);
                const totalMins = uSessions.reduce((acc, s) => acc + s.minutes, 0);
                const uScreens = screenTimes.filter((s) => s.userId === u.uid);
                const topScreen = [...uScreens].sort((a, b) => b.seconds - a.seconds)[0];
                const effSub = getEffectiveSubscription(u);
                const userStat = usageStats.find((s) => s.userId === u.uid);
                const scoreVal = userStat ? getEffectiveGuardScore(userStat) : u.guardScore || 0;
                const authSourceLabel = isStarter
                  ? 'System'
                  : u.authProvider === 'gmail' || (u.email || '').toLowerCase().endsWith('@gmail.com')
                  ? 'Gmail signup'
                  : 'Email signup';
                return (
                  <div
                    key={u.uid}
                    onClick={() => {
                      setSelectedUserDetail(u);
                      setUserDetailTab('profile');
                    }}
                    className="bg-[#0C1626] border border-slate-800 hover:border-[#2E9BFF]/60 rounded-2xl p-3.5 space-y-1.5 text-xs cursor-pointer transition-colors"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <UserAvatar
                          photoURL={u.profilePicUrl || u.photoURL}
                          name={u.fullName}
                          size="xs"
                          borderVariant={effSub.isSubscriber ? 'green' : 'none'}
                          fallbackVariant="letter"
                        />
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="font-extrabold text-white truncate">
                              {u.fullName}
                            </span>
                            {isStarter ? (
                              <span className="px-1.5 py-0.5 rounded bg-[#FFC400]/15 text-[#FFC400] text-[10px] font-extrabold">
                                STARTER - DEMO
                              </span>
                            ) : (
                              <span className="px-1.5 py-0.5 rounded bg-[#00E67A]/15 text-[#00E67A] text-[10px] font-extrabold">
                                {authSourceLabel}
                              </span>
                            )}
                            <span className="text-[10px] text-[#2E9BFF]">({u.role})</span>
                            {!isStarter && (
                              <span className="text-[10px] text-[#00E67A]">• {effSub.plan}</span>
                            )}
                          </div>
                          <span className="text-[10px] text-slate-400">
                            {formatCityStateLabel(u.city, u.state || u.userState)} • Score:{' '}
                            {scoreVal.toLocaleString()}
                            {isStarter ? ' • No Payout' : ''}
                          </span>
                        </div>
                      </div>
                      {!isStarter && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            updateDoc(doc(db, 'users', u.uid), {
                              role: u.role === 'banned' ? 'user' : 'banned',
                            });
                          }}
                          className="px-2 py-0.5 rounded bg-slate-800 text-[10px] text-slate-300 cursor-pointer shrink-0"
                        >
                          {u.role === 'banned' ? 'Unban' : 'Ban'}
                        </button>
                      )}
                    </div>
                    {!isStarter && (
                      <p className="text-slate-400">
                        Usage: {Math.round(totalMins)} mins • Top Tab:{' '}
                        {topScreen ? topScreen.screen : 'home'} • Tap for Profile &amp; Referrals
                      </p>
                    )}
                    {coord && !isStarter && (
                      <p className="text-[11px] font-mono text-[#00E67A]">
                        Admin Live GPS: {coord.lat?.toFixed(5)}, {coord.lng?.toFixed(5)} (
                        {coord.address || 'Unknown'})
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* 5. LEADERBOARD ANTI-CHEAT AUDIT (REAL USERS ONLY) */}
        {subSection === 'leaderboard' && (
          <div className="space-y-2.5">
            {usageStats.filter((st) => !isStarterUserRecord(st)).length === 0 ? (
              <p className="text-xs text-slate-400 text-center py-6 bg-[#0C1626] rounded-2xl border border-slate-800">
                No real-user monthly usage stats yet.
              </p>
            ) : (
              usageStats
                .filter((st) => !isStarterUserRecord(st))
                .map((st) => (
                  <div
                    key={st.id}
                    className="bg-[#0C1626] border border-slate-800 rounded-2xl p-3.5 flex items-center justify-between gap-2 text-xs"
                  >
                    <div>
                      <p className="font-bold text-white">{st.name}</p>
                      <p className="text-slate-400 font-mono">
                        Scans: {st.totalScans} • Reports: {st.verifiedReports} • Guard Score:{' '}
                        {getEffectiveGuardScore(st)}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleToggleCheatFlag(st)}
                      className={`px-3 py-1.5 rounded-xl font-bold text-xs cursor-pointer ${
                        st.cheatingFlagged
                          ? 'bg-[#FF2D55] text-white'
                          : 'bg-slate-800 text-slate-300'
                      }`}
                    >
                      {st.cheatingFlagged ? 'Flagged Cheating' : 'Flag Cheating'}
                    </button>
                  </div>
                ))
            )}
          </div>
        )}

        {/* 5b. REPORT AUDIT LOGS & FLAGGED REPORTERS */}
        {subSection === 'audit' && (
          <div className="space-y-4">
            <div className="bg-[#0C1626] border border-[#FF2D55]/40 rounded-2xl p-4 space-y-2.5">
              <h3 className="text-xs font-extrabold text-[#FF2D55]">
                Flagged Reporters (3+ False Votes) — {flaggedReportersCount}
              </h3>
              {flaggedReportersCount === 0 ? (
                <p className="text-xs text-slate-400">No reporters currently flagged.</p>
              ) : (
                <div className="space-y-2">
                  {allUsers
                    .filter((u) => Boolean(u.flaggedReporter))
                    .map((u) => (
                      <div
                        key={u.uid}
                        className="p-3 rounded-xl bg-[#050B14] border border-slate-800 flex items-center justify-between gap-2 text-xs"
                      >
                        <div className="min-w-0">
                          <p className="font-bold text-white truncate">
                            {u.fullName}{' '}
                            <span className="text-[#FF2D55]">({u.role})</span>
                          </p>
                          <p className="text-[11px] font-mono text-slate-400 truncate">
                            UID: {u.uid} • Alert: {u.flaggedReportId || 'N/A'}
                          </p>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            type="button"
                            onClick={() =>
                              updateDoc(doc(db, 'users', u.uid), {
                                flaggedReporter: false,
                              })
                            }
                            className="px-2.5 py-1 rounded-lg bg-[#00E67A]/15 text-[#00E67A] font-bold text-[11px] cursor-pointer"
                          >
                            Clear Flag
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              updateDoc(doc(db, 'users', u.uid), {
                                role: u.role === 'banned' ? 'user' : 'banned',
                              })
                            }
                            className="px-2.5 py-1 rounded-lg bg-[#FF2D55] text-white font-bold text-[11px] cursor-pointer"
                          >
                            {u.role === 'banned' ? 'Unban' : 'Ban'}
                          </button>
                        </div>
                      </div>
                    ))}
                </div>
              )}
            </div>

            <div className="bg-[#0C1626] border border-slate-800 rounded-2xl p-4 space-y-2.5">
              <h3 className="text-xs font-extrabold text-white">
                Immutable Report Audit Trail ({auditLogs.length})
              </h3>
              {auditLogs.length === 0 ? (
                <p className="text-xs text-slate-400">No report audit entries yet.</p>
              ) : (
                <div className="space-y-2 max-h-96 overflow-y-auto">
                  {auditLogs.map((log) => {
                    const tsMs = toMillisSafe(log.timestamp);
                    const timeLabel = tsMs ? new Date(tsMs).toLocaleString() : 'Pending sync';
                    return (
                      <div
                        key={log.id}
                        className="p-3 rounded-xl bg-[#050B14] border border-slate-800 text-[11px] font-mono space-y-1"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[#2E9BFF] font-bold">
                            {log.reportId} ({log.incidentType || 'Report'})
                          </span>
                          <span className="text-slate-400">{timeLabel}</span>
                        </div>
                        <p className="text-slate-300 truncate">User ID: {log.userId}</p>
                        <p className="text-slate-400 truncate">Device: {log.device}</p>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* 6. TIPS, GOOD WISHES & SAFE BUSINESS APPROVALS */}
        {subSection === 'broadcast' && (
          <div className="space-y-4">
            <form
              onSubmit={handlePublishTip}
              className="bg-[#0C1626] border border-slate-800 rounded-2xl p-4 space-y-2.5"
            >
              <h3 className="text-xs font-extrabold text-white">
                Publish Daily Tip from Sansa (Home Tab)
              </h3>
              <input
                type="text"
                placeholder="Tip Title"
                value={tipTitle}
                onChange={(e) => setTipTitle(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-[#050B14] border border-slate-800 text-xs text-white"
              />
              <textarea
                rows={2}
                required
                placeholder="Write practical Nigeria safety tip..."
                value={tipBody}
                onChange={(e) => setTipBody(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-[#050B14] border border-slate-800 text-xs text-white"
              />
              <button
                type="submit"
                className="w-full py-2.5 rounded-xl bg-[#00E67A] text-slate-950 font-extrabold text-xs cursor-pointer"
              >
                Publish Sansa Tip
              </button>
            </form>

            <form
              onSubmit={handleBroadcastWish}
              className="bg-[#0C1626] border border-slate-800 rounded-2xl p-4 space-y-2.5"
            >
              <h3 className="text-xs font-extrabold text-white">
                Broadcast Good Wish Message to All Users
              </h3>
              <input
                type="text"
                required
                placeholder="e.g. Stay safe out there today — Guard AI cares!"
                value={wishText}
                onChange={(e) => setWishText(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-[#050B14] border border-slate-800 text-xs text-white"
              />
              <button
                type="submit"
                className="w-full py-2.5 rounded-xl bg-[#2E9BFF] text-white font-bold text-xs flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <Send className="w-3.5 h-3.5" />
                <span>Send Broadcast</span>
              </button>
            </form>

            {/* Safe Business Approvals */}
            <div className="bg-[#0C1626] border border-slate-800 rounded-2xl p-4 space-y-2.5">
              <h3 className="text-xs font-extrabold text-white flex items-center gap-1.5">
                <Building2 className="w-4 h-4 text-[#00E67A]" />
                <span>Pending Safe Business Approvals ({pendingBusinesses.length})</span>
              </h3>
              {pendingBusinesses.map((b) => (
                <div
                  key={b.id}
                  className="p-3 rounded-xl bg-[#050B14] border border-slate-800 flex items-center justify-between gap-2 text-xs"
                >
                  <div>
                    <p className="font-bold text-white">
                      {b.businessName} ({b.type})
                    </p>
                    <p className="text-slate-400">{b.address}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => updateDoc(doc(db, 'safe_business', b.id), { verified: true })}
                    className="px-3 py-1.5 rounded-lg bg-[#00E67A] text-slate-950 font-bold cursor-pointer"
                  >
                    Approve
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <AdBanner />

      {/* Police Dispatch Confirmation & SMS/WhatsApp/Call Intents */}
      {dispatchInfo && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="w-full max-w-md bg-[#0C1626] border-2 border-[#00E67A] rounded-t-3xl sm:rounded-3xl p-6 space-y-4">
            <h2 className="text-base font-extrabold text-white">
              Alert Published &amp; Ready for Police Dispatch
            </h2>
            <p className="text-xs text-slate-300">
              Matched State Police:{' '}
              <strong>
                {dispatchInfo.station?.stationName || 'Nigeria Emergency 112'} (
                {dispatchInfo.station?.phone1 || '112'})
              </strong>
            </p>
            <div className="space-y-2">
              <a
                href={`sms:${dispatchInfo.station?.phone1 || '112'}?body=${encodeURIComponent(
                  `GUARD AI VERIFIED ALERT (${dispatchInfo.report.incidentType}) at ${dispatchInfo.report.incidentAddress}. Reporter: ${dispatchInfo.report.userName} (${dispatchInfo.report.userPhone}).`
                )}`}
                className="w-full py-3 rounded-xl bg-[#2E9BFF] text-white font-bold text-xs flex items-center justify-center gap-2"
              >
                <MessageSquare className="w-4 h-4" />
                <span>Send SMS to State Police</span>
              </a>
              <a
                href={`https://wa.me/${(dispatchInfo.station?.phone1 || '2348032003513').replace(
                  /[^0-9]/g,
                  ''
                )}?text=${encodeURIComponent(
                  `GUARD AI VERIFIED ALERT (${dispatchInfo.report.incidentType}) at ${dispatchInfo.report.incidentAddress}.`
                )}`}
                target="_blank"
                rel="noreferrer"
                className="w-full py-3 rounded-xl bg-[#00E67A] text-slate-950 font-extrabold text-xs flex items-center justify-center gap-2"
              >
                <Send className="w-4 h-4" />
                <span>WhatsApp State Police</span>
              </a>
              <a
                href={`tel:${dispatchInfo.station?.phone1 || '112'}`}
                className="w-full py-3 rounded-xl bg-[#FF2D55] text-white font-bold text-xs flex items-center justify-center gap-2"
              >
                <Phone className="w-4 h-4" />
                <span>Call Police Directly</span>
              </a>
              <button
                type="button"
                onClick={() => setDispatchInfo(null)}
                className="w-full py-2.5 rounded-xl bg-slate-800 text-slate-300 font-bold text-xs cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Free / Suspended Report Verification Confirmation Modal */}
      {freeConfirmReport && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-[#0C1626] border border-[#FFC400] rounded-3xl p-6 space-y-4">
            <h2 className="text-base font-extrabold text-white">
              {freeConfirmReport.reason === 'suspended'
                ? 'Reporter Suspended From Report & Earn'
                : 'Confirm Publish Without Payment'}
            </h2>
            <p className="text-xs text-slate-200 leading-relaxed">
              {freeConfirmReport.reason === 'suspended'
                ? 'This reporter had 3+ false reports this month and is suspended for 30 days. Report will be published to Map/Alerts with NO payment (₦0). Confirm?'
                : 'This user is FREE - Report will be published but NO payment. Confirm?'}
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  const rep = freeConfirmReport.report;
                  setFreeConfirmReport(null);
                  void finalizeVerifiedReport(rep, false);
                }}
                className="flex-1 py-3 rounded-xl bg-[#00E67A] text-slate-950 font-extrabold text-xs cursor-pointer"
              >
                Confirm Publish (₦0)
              </button>
              <button
                type="button"
                onClick={() => setFreeConfirmReport(null)}
                className="py-3 px-4 rounded-xl bg-slate-800 text-slate-300 font-bold text-xs cursor-pointer"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Pay Top 10 Confirmation Modal */}
      {payoutConfirmOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-[#0C1626] border border-[#00E67A] rounded-3xl p-6 space-y-4">
            <h2 className="text-base font-extrabold text-white">
              Confirm Top 10 Monthly Payout
            </h2>
            <p className="text-xs text-slate-300">
              Credit <strong>₦10,000</strong> to each of the top{' '}
              <strong>{top10Guardians.length}</strong> subscribers (Total:{' '}
              <strong>₦{(top10Guardians.length * 10000).toLocaleString()}</strong>), archive results
              to <code className="text-[#00E67A]">leaderboardHistory</code>, and reset all monthly
              Guard Scores to 0?
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={payoutBusy}
                onClick={handlePayTop10Monthly}
                className="flex-1 py-3 rounded-xl bg-[#00E67A] text-slate-950 font-extrabold text-xs cursor-pointer disabled:opacity-60"
              >
                {payoutBusy ? 'Processing Payout...' : 'Confirm Pay & Reset'}
              </button>
              <button
                type="button"
                disabled={payoutBusy}
                onClick={() => setPayoutConfirmOpen(false)}
                className="py-3 px-4 rounded-xl bg-slate-800 text-slate-300 font-bold text-xs cursor-pointer"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* User Detail Modal (Profile & GPS + Referrals Tab) */}
      {selectedUserDetail && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="w-full max-w-lg max-h-[88vh] overflow-y-auto bg-[#0C1626] border border-slate-800 rounded-t-3xl sm:rounded-3xl p-5 space-y-4">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-3 min-w-0">
                <UserAvatar
                  photoURL={selectedUserDetail.profilePicUrl || selectedUserDetail.photoURL}
                  name={selectedUserDetail.fullName}
                  size="md"
                  borderVariant="purple"
                />
                <div className="min-w-0">
                  <h2 className="text-base font-extrabold text-white truncate">
                    {selectedUserDetail.fullName}
                  </h2>
                  <p className="text-xs text-slate-400 truncate">
                    {selectedUserDetail.email || selectedUserDetail.phone || selectedUserDetail.uid}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedUserDetail(null)}
                className="w-9 h-9 rounded-full bg-slate-800 text-slate-300 flex items-center justify-center cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setUserDetailTab('profile')}
                className={`py-2 rounded-xl text-xs font-extrabold cursor-pointer ${
                  userDetailTab === 'profile'
                    ? 'bg-[#2E9BFF] text-white'
                    : 'bg-[#050B14] border border-slate-800 text-slate-300'
                }`}
              >
                Profile &amp; GPS
              </button>
              <button
                type="button"
                onClick={() => setUserDetailTab('referrals')}
                className={`py-2 rounded-xl text-xs font-extrabold cursor-pointer ${
                  userDetailTab === 'referrals'
                    ? 'bg-[#00E67A] text-slate-950'
                    : 'bg-[#050B14] border border-slate-800 text-slate-300'
                }`}
              >
                Referrals ({selectedUserReferrals.length})
              </button>
            </div>

            {userDetailTab === 'profile' ? (
              <div className="space-y-3 text-xs">
                {(() => {
                  const eff = getEffectiveSubscription(selectedUserDetail);
                  const coord = liveCoords[selectedUserDetail.uid];
                  const avail =
                    selectedUserDetail.availableBalanceNaira ??
                    selectedUserDetail.walletBalance ??
                    0;
                  const earned =
                    selectedUserDetail.totalEarnedNaira ??
                    selectedUserDetail.walletBalance ??
                    0;
                  return (
                    <>
                      <div className="grid grid-cols-2 gap-2 bg-[#050B14] border border-slate-800 rounded-2xl p-3">
                        <div>
                          <p className="text-slate-400 text-[10px]">Subscription Plan</p>
                          <p className="font-extrabold text-[#00E67A]">
                            {eff.plan} ({eff.status})
                          </p>
                          {eff.expiresAtMs > 0 && (
                            <p className="text-[10px] text-slate-400">
                              Expires {new Date(eff.expiresAtMs).toLocaleDateString()}
                            </p>
                          )}
                        </div>
                        <div>
                          <p className="text-slate-400 text-[10px]">Wallet Balances</p>
                          <p className="font-mono font-extrabold text-white">
                            Avail: ₦{avail.toLocaleString()}
                          </p>
                          <p className="font-mono text-[10px] text-slate-400">
                            Total Earned: ₦{earned.toLocaleString()}
                          </p>
                        </div>
                      </div>

                      <div className="bg-[#050B14] border border-slate-800 rounded-2xl p-3 space-y-1">
                        <p className="text-slate-400 text-[10px] flex items-center gap-1">
                          <MapPin className="w-3 h-3 text-[#2E9BFF]" /> Location Details
                        </p>
                        <p className="text-white font-bold">
                          {formatCityStateLabel(
                            selectedUserDetail.city,
                            selectedUserDetail.state || selectedUserDetail.userState
                          )}{' '}
                          <span className="text-[10px] text-[#2E9BFF]">
                            ({selectedUserDetail.locationSource || 'unset'})
                          </span>
                        </p>
                        {coord && (
                          <p className="font-mono text-[11px] text-[#00E67A]">
                            GPS: {coord.lat?.toFixed(5)}, {coord.lng?.toFixed(5)}
                          </p>
                        )}
                      </div>

                      <div className="bg-[#050B14] border border-slate-800 rounded-2xl p-3 flex justify-between">
                        <div>
                          <p className="text-slate-400 text-[10px]">Monthly Guard Score</p>
                          <p className="text-sm font-mono font-extrabold text-[#2E9BFF]">
                            {selectedUserDetail.guardScore || 0}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-slate-400 text-[10px]">False Reports (Month)</p>
                          <p className="text-sm font-mono font-extrabold text-[#FF2D55]">
                            {selectedUserDetail.falseReportsThisMonth || 0}
                          </p>
                        </div>
                      </div>
                    </>
                  );
                })()}
              </div>
            ) : (
              <div className="space-y-3 text-xs">
                <div className="bg-[#050B14] border border-slate-800 rounded-2xl p-3 space-y-1">
                  <p className="text-slate-400 text-[10px]">User Referral Code</p>
                  <p className="font-mono font-extrabold text-[#00E67A]">
                    {selectedUserDetail.referralCode || 'Not Generated Yet'}
                  </p>
                  {selectedUserDetail.referredByCode && (
                    <p className="text-[11px] text-slate-300 pt-1">
                      Referred By:{' '}
                      <span className="font-bold text-white">
                        {allUsers.find((x) => x.uid === selectedUserDetail.referredByUid)
                          ?.fullName || selectedUserDetail.referredByCode}
                      </span>{' '}
                      ({selectedUserDetail.referredByCode})
                    </p>
                  )}
                </div>

                <div className="bg-[#050B14] border border-slate-800 rounded-2xl p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-extrabold text-white flex items-center gap-1.5">
                      <Gift className="w-3.5 h-3.5 text-[#00E67A]" />
                      Invited Friends ({selectedUserReferrals.length})
                    </span>
                    <span className="font-mono font-bold text-[#00E67A]">
                      Total Paid: ₦
                      {selectedUserReferrals
                        .reduce((acc, r) => acc + (r.rewardPaid ? r.rewardAmount : 0), 0)
                        .toLocaleString()}
                    </span>
                  </div>
                  {selectedUserReferrals.length === 0 ? (
                    <p className="text-slate-500">No invited users yet.</p>
                  ) : (
                    <div className="space-y-1.5 max-h-56 overflow-y-auto">
                      {selectedUserReferrals.map((r) => (
                        <div
                          key={r.id}
                          className="p-2 rounded-xl bg-[#0C1626] border border-slate-800 flex items-center justify-between gap-2"
                        >
                          <div className="min-w-0">
                            <p className="font-bold text-white truncate">
                              {r.referredName || r.referredUid}
                            </p>
                            <p className="text-[10px] text-slate-400">
                              {r.subscribedPlan || 'Free'} • {r.status}
                            </p>
                          </div>
                          <span
                            className={`font-mono font-bold text-[11px] ${
                              r.rewardPaid ? 'text-[#00E67A]' : 'text-[#FFC400]'
                            }`}
                          >
                            {r.rewardPaid ? `₦${r.rewardAmount.toLocaleString()}` : r.status}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
      {/* Remove All Starter Guards In-App Confirmation Modal */}
      {removeStartersModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-[#0C1626] border-2 border-[#FF2D55] rounded-3xl p-6 space-y-4">
            <h2 className="text-base font-extrabold text-white">
              Remove All 56 Starter Guards?
            </h2>
            <p className="text-xs text-slate-300 leading-relaxed">
              This permanently removes all Starter Guards (<code className="text-[#FFC400]">isStarter === true</code>)
              from Users, Public Profiles, and Leaderboard Stats, and disables starter display in
              the app. Real users are untouched.
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={starterBusy}
                onClick={handleConfirmRemoveAllStarters}
                className="flex-1 py-3 rounded-xl bg-[#FF2D55] text-white font-extrabold text-xs cursor-pointer disabled:opacity-60"
              >
                {starterBusy ? 'Removing...' : 'Confirm Remove All'}
              </button>
              <button
                type="button"
                disabled={starterBusy}
                onClick={() => setRemoveStartersModalOpen(false)}
                className="py-3 px-4 rounded-xl bg-slate-800 text-slate-300 font-bold text-xs cursor-pointer"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
