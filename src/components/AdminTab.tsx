import React, { useEffect, useState } from 'react';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  increment,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
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
} from 'lucide-react';
import { db, handleFirestoreError, OperationType } from '../firebase';
import {
  IncidentReport,
  OPaySettings,
  PaymentDoc,
  PoliceStation,
  SafeBusiness,
  UserProfile,
  UserUsageStat,
} from '../types';
import { NIGERIA_POLICE_SEED } from '../data/nigeriaPoliceSeed';
import { computeLeaderboardPoints, getWatMonthKey, isTimestampTodayWat } from '../utils/geoPhysics';
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
  const globalProfile = useGlobalUserProfile(adminUser.fullName, adminUser.photoURL);
  const [subSection, setSubSection] = useState<
    'overview' | 'reports' | 'police' | 'payments' | 'leaderboard' | 'broadcast'
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
  const [newState, setNewState] = useState('Lagos');
  const [newArea, setNewArea] = useState('');
  const [newStationName, setNewStationName] = useState('');
  const [newPhone1, setNewPhone1] = useState('');
  const [newPhone2, setNewPhone2] = useState('');

  // Police Dispatch Drawer
  const [dispatchInfo, setDispatchInfo] = useState<{
    report: IncidentReport;
    station: PoliceStation | null;
  } | null>(null);

  // Broadcast / Sansa Tip Form
  const [tipTitle, setTipTitle] = useState('');
  const [tipBody, setTipBody] = useState('');
  const [wishText, setWishText] = useState('');
  const [seedingPolice, setSeedingPolice] = useState(false);

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
    };
  }, []);

  const pendingReportsCount = reports.filter((r) => r.adminDecision === 'pending' || r.status === 'PENDING VERIFICATION').length;
  const pendingPaymentsCount = payments.filter((p) => p.status === 'PENDING').length;

  // Approve & Send to State Police
  const handleApproveAndForwardPolice = async (rep: IncidentReport) => {
    const targetState = (rep.incidentState || rep.userState || 'Lagos').trim();
    const matchedStation =
      stations.find(
        (s) =>
          s.state.toLowerCase() === targetState.toLowerCase() && s.isVerified && s.isActive
      ) ||
      stations.find((s) => s.isVerified && s.isActive) ||
      null;

    try {
      // 1. Publish verified alert to Alerts Tab
      await addDoc(collection(db, 'alerts'), {
        userId: rep.userId,
        userName: rep.userName || 'Verified Reporter',
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
        createdAt: serverTimestamp(),
      });

      // 2. Update IncidentReport
      await updateDoc(doc(db, 'incident_reports', rep.id), {
        status: 'APPROVED & SENT TO POLICE',
        adminDecision: 'approved',
        adminName: adminUser.fullName,
        approvedAt: serverTimestamp(),
        forwardedTo: matchedStation?.phone1 || '112',
        forwardedState: targetState,
        forwardedAt: serverTimestamp(),
      });

      // 3. Log in sansa_memory & admin
      await addDoc(collection(db, 'sansa_memory'), {
        type: 'police_dispatch',
        reportId: rep.reportId || rep.id,
        state: targetState,
        stationName: matchedStation?.stationName || 'Emergency 112',
        isPublicTip: false,
        createdAt: serverTimestamp(),
      });
      await addDoc(collection(db, 'admin'), {
        action: 'APPROVE_AND_FORWARD_POLICE',
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

  // Mark Paid ₦5,000 + Promote Video to Home
  const handleMarkPaidAndPromote = async (rep: IncidentReport) => {
    try {
      await updateDoc(doc(db, 'incident_reports', rep.id), {
        paymentStatus: 'paid',
        status: 'PAID ₦5,000',
        adminDecision: 'approved',
      });

      await updateDoc(doc(db, 'users', rep.userId), {
        walletBalance: increment(5000),
        verifiedBadge: true,
      });

      await addDoc(collection(db, 'wallet_transactions'), {
        userId: rep.userId,
        amount: 5000,
        description: `Verified Report Reward (${rep.incidentType})`,
        reportId: rep.id,
        createdAt: serverTimestamp(),
      });

      // Update user_usage_stats (+1 verifiedReport, +100 points)
      const statDoc = usageStats.find((u) => u.userId === rep.userId);
      if (statDoc) {
        const nextVerified = (statDoc.verifiedReports || 0) + 1;
        const nextPts = computeLeaderboardPoints({
          verifiedReports: nextVerified,
          totalScans: statDoc.totalScans || 0,
          totalUsageDays: statDoc.totalUsageDays || 1,
          totalUsageMinutes: statDoc.totalUsageMinutes || 0,
        });
        await updateDoc(doc(db, 'user_usage_stats', statDoc.id), {
          verifiedReports: nextVerified,
          totalPoints: nextPts,
        });
      }

      // Update public_profiles
      await updateDoc(doc(db, 'public_profiles', rep.userId), {
        verifiedReports: increment(1),
        verifiedBadge: true,
      }).catch(() => {});

      // Copy to home_videos ("Verified By Guard AI - Real Videos")
      const repAuthor = allUsers.find((u) => u.uid === rep.userId);
      await addDoc(collection(db, 'home_videos'), {
        reportId: rep.reportId || rep.id,
        userId: rep.userId,
        userName: rep.userName || repAuthor?.fullName || 'Verified User',
        userProfilePic: repAuthor?.photoURL || '',
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
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `incident_reports/${rep.id}`);
    }
  };

  const handleRejectReport = async (rep: IncidentReport) => {
    try {
      await updateDoc(doc(db, 'incident_reports', rep.id), {
        status: 'REJECTED',
        adminDecision: 'rejected',
        adminReason: 'Did not meet Guard AI verification criteria',
      });
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
        await updateDoc(doc(db, 'users', p.userId), {
          subscription: 'active',
        });
        await addDoc(collection(db, 'subscriptions'), {
          userId: p.userId,
          plan: p.plan,
          status: 'active',
          amount: p.amount,
          createdAt: serverTimestamp(),
        });
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `payments/${p.id}`);
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

  // Users inactive > 24h
  const nowMs = Date.now();
  const inactiveUsers24h = allUsers.filter((u) => {
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

        {/* Sub-Section Selector */}
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          {[
            { id: 'reports', label: `Reports (${pendingReportsCount})`, icon: Shield },
            { id: 'police', label: `Police (${stations.length})`, icon: Phone },
            { id: 'payments', label: `OPay (${pendingPaymentsCount})`, icon: CreditCard },
            { id: 'overview', label: 'Users & GPS', icon: Users },
            { id: 'leaderboard', label: 'Anti-Cheat', icon: Flag },
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

        {/* 1. REPORTS TO APPROVE & POLICE AUTO-FORWARD */}
        {subSection === 'reports' && (
          <div className="space-y-3">
            {reports.length === 0 ? (
              <p className="text-xs text-slate-400 text-center py-6 bg-[#0C1626] rounded-2xl border border-slate-800">
                No incident reports submitted yet.
              </p>
            ) : (
              reports.map((rep) => {
                const authorUser = allUsers.find((u) => u.uid === rep.userId);
                const isMine = rep.userId === adminUser.uid;
                const repAvatar = isMine
                  ? globalProfile.photo || adminUser.photoURL
                  : authorUser?.photoURL;
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
                        <span className="text-xs font-extrabold text-[#FF2D55]">
                          {rep.incidentType}
                        </span>
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

                  {/* V Score Breakdown */}
                  {typeof rep.guardAiScore === 'number' && (
                    <div className="p-2.5 rounded-xl bg-[#050B14] border border-slate-800 text-[11px] font-mono text-slate-300 flex flex-wrap gap-3">
                      <span>V Score: {Math.round(rep.guardAiScore * 100)}%</span>
                      <span>Verdict: {rep.aiVerdict}</span>
                      <span>Duration: {rep.videoDurationSec || 0}s</span>
                    </div>
                  )}

                  {rep.videoUrl &&
                    (rep.videoUrl.startsWith('http') || rep.videoUrl.startsWith('data:video')) && (
                      <video
                        src={rep.videoUrl}
                        controls
                        className="w-full h-44 rounded-xl bg-black object-cover"
                      />
                    )}

                  <div className="flex flex-wrap gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => handleApproveAndForwardPolice(rep)}
                      className="flex-1 min-w-[150px] py-2.5 px-3 rounded-xl bg-[#2E9BFF] text-white font-bold text-xs cursor-pointer"
                    >
                      Approve &amp; Send to Police
                    </button>
                    {rep.paymentStatus !== 'paid' && (
                      <button
                        type="button"
                        onClick={() => handleMarkPaidAndPromote(rep)}
                        className="flex-1 min-w-[150px] py-2.5 px-3 rounded-xl bg-[#00E67A] text-slate-950 font-extrabold text-xs cursor-pointer"
                      >
                        Mark Paid ₦5,000 + Home Video
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => handleRejectReport(rep)}
                      className="py-2.5 px-3 rounded-xl bg-[#FF2D55]/15 text-[#FF2D55] font-bold text-xs cursor-pointer"
                    >
                      Reject
                    </button>
                  </div>
                </div>
                );
              })
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
                  placeholder="State (e.g. Lagos)"
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

        {/* 4. USERS, SCREEN TIME ANALYTICS & ADMIN RAW GPS */}
        {subSection === 'overview' && (
          <div className="space-y-4">
            {/* Red List: Inactive > 24h */}
            <div className="bg-[#0C1626] border border-[#FF2D55]/40 rounded-2xl p-4 space-y-2">
              <h3 className="text-xs font-extrabold text-[#FF2D55]">
                Not Logged In Last 24 Hours ({inactiveUsers24h.length})
              </h3>
              {inactiveUsers24h.length === 0 ? (
                <p className="text-xs text-slate-400">All users active within 24 hours.</p>
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

            {/* All Users + Screen Time + Admin-Only Raw Coordinates */}
            <div className="space-y-2">
              {allUsers.map((u) => {
                const coord = liveCoords[u.uid];
                const uSessions = sessions.filter((s) => s.userId === u.uid);
                const totalMins = uSessions.reduce((acc, s) => acc + s.minutes, 0);
                const uScreens = screenTimes.filter((s) => s.userId === u.uid);
                const topScreen = [...uScreens].sort((a, b) => b.seconds - a.seconds)[0];
                return (
                  <div
                    key={u.uid}
                    className="bg-[#0C1626] border border-slate-800 rounded-2xl p-3.5 space-y-1.5 text-xs"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-extrabold text-white">
                        {u.fullName}{' '}
                        <span className="text-[10px] text-[#2E9BFF]">({u.role})</span>
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          updateDoc(doc(db, 'users', u.uid), {
                            role: u.role === 'banned' ? 'user' : 'banned',
                          })
                        }
                        className="px-2 py-0.5 rounded bg-slate-800 text-[10px] text-slate-300 cursor-pointer"
                      >
                        {u.role === 'banned' ? 'Unban' : 'Ban'}
                      </button>
                    </div>
                    <p className="text-slate-400">
                      Usage: {Math.round(totalMins)} mins • Top Tab:{' '}
                      {topScreen ? topScreen.screen : 'home'}
                    </p>
                    {coord && (
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

        {/* 5. LEADERBOARD ANTI-CHEAT AUDIT */}
        {subSection === 'leaderboard' && (
          <div className="space-y-2.5">
            {usageStats.length === 0 ? (
              <p className="text-xs text-slate-400 text-center py-6 bg-[#0C1626] rounded-2xl border border-slate-800">
                No monthly usage stats yet.
              </p>
            ) : (
              usageStats.map((st) => (
                <div
                  key={st.id}
                  className="bg-[#0C1626] border border-slate-800 rounded-2xl p-3.5 flex items-center justify-between gap-2 text-xs"
                >
                  <div>
                    <p className="font-bold text-white">{st.name}</p>
                    <p className="text-slate-400 font-mono">
                      Scans: {st.totalScans} • Reports: {st.verifiedReports} • Pts: {st.totalPoints}
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
    </div>
  );
};
