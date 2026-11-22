import React, { useEffect, useState } from 'react';
import {
  addDoc,
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { signOut } from 'firebase/auth';
import {
  Award,
  Camera,
  CheckCircle2,
  Clock,
  Copy,
  CreditCard,
  HelpCircle,
  LogOut,
  RefreshCw,
  Settings,
  Shield,
  Trophy,
  Upload,
  User as UserIcon,
  Wallet,
  X,
} from 'lucide-react';
import { auth, db, handleFirestoreError, OperationType, storage } from '../firebase';
import {
  HumanLocation,
  IncidentReport,
  OPaySettings,
  PaymentDoc,
  PlanType,
  UserProfile,
  UserUsageStat,
} from '../types';
import { getWatMonthKey } from '../utils/geoPhysics';
import {
  compressImageTo500,
  saveUserProfileName,
  saveUserProfilePhoto,
  useGlobalUserProfile,
} from '../utils/userProfileStore';
import { UserAvatar } from './UserAvatar';
import { AdBanner } from './AdBanner';

interface MeTabProps {
  user: UserProfile;
  location: HumanLocation | null;
  scansToday: number;
  activePlan: PlanType;
  usageStatDocId: string | null;
  darkMode: boolean;
  onToggleDarkMode: () => void;
  onOpenReportModal: () => void;
  onOpenProfile: (uid: string) => void;
  onReplayTutorial?: () => void;
  openSubSectionSignal?: number;
  openProfileSectionSignal?: number;
  openSettingsSectionSignal?: number;
}

function getMonthCountdown(): string {
  const now = new Date();
  const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1, 0, 0, 0);
  const diffMs = Math.max(0, endOfMonth.getTime() - now.getTime());
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diffMs / (1000 * 60 * 60)) % 24);
  const mins = Math.floor((diffMs / (1000 * 60)) % 60);
  return `${days}d ${hours}h ${mins}m left`;
}

export const MeTab: React.FC<MeTabProps> = ({
  user,
  scansToday,
  activePlan,
  usageStatDocId,
  darkMode,
  onToggleDarkMode,
  onOpenReportModal,
  onOpenProfile,
  onReplayTutorial,
  openSubSectionSignal,
  openProfileSectionSignal,
  openSettingsSectionSignal,
}) => {
  const globalProfile = useGlobalUserProfile(user.fullName, user.photoURL);
  const displayName = globalProfile.name || user.fullName;
  const displayPhoto = globalProfile.photo || user.photoURL || '';

  const [section, setSection] = useState<'profile' | 'subscriptions' | 'leaderboard' | 'settings'>(
    'profile'
  );

  // Profile Edit State
  const [fullName, setFullName] = useState(displayName || '');
  const [username, setUsername] = useState(user.username || '');
  const [phone, setPhone] = useState(user.phone || '');
  const [city, setCity] = useState(user.city || '');
  const [userState, setUserState] = useState(user.userState || 'Lagos');
  const [bio, setBio] = useState(user.bio || '');
  const [emergencyContact, setEmergencyContact] = useState(user.emergencyContact || '');
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileSavedMsg, setProfileSavedMsg] = useState<string | null>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);

  // My Reports & Wallet History
  const [myReports, setMyReports] = useState<IncidentReport[]>([]);
  const [walletTxs, setWalletTxs] = useState<{ id: string; amount: number; description: string }[]>([]);

  // Subscriptions & Manual OPay Payment
  const [opaySettings, setOpaySettings] = useState<OPaySettings | null>(null);
  const [myPayments, setMyPayments] = useState<PaymentDoc[]>([]);
  const [payModalPlan, setPayModalPlan] = useState<'Monthly' | 'Yearly' | null>(null);
  const [receiptDataUrl, setReceiptDataUrl] = useState<string>('');
  const [submittingPayment, setSubmittingPayment] = useState(false);
  const [copiedAccount, setCopiedAccount] = useState(false);

  // Real Top 10 Monthly Leaderboard
  const [leaderboard, setLeaderboard] = useState<UserUsageStat[]>([]);
  const [lbSort, setLbSort] = useState<'points' | 'scans' | 'usage'>('points');
  const [countdown, setCountdown] = useState<string>(getMonthCountdown());

  // Settings & Real Device Permissions
  const [notifEnabled, setNotifEnabled] = useState(true);
  const [shareLocation, setShareLocation] = useState(true);
  const [language, setLanguage] = useState('English');
  const [geoPerm, setGeoPerm] = useState<string>('checking');
  const [micPerm, setMicPerm] = useState<string>('checking');

  useEffect(() => {
    if (openSubSectionSignal && openSubSectionSignal > 0) {
      setSection('subscriptions');
    }
  }, [openSubSectionSignal]);

  useEffect(() => {
    if (openProfileSectionSignal && openProfileSectionSignal > 0) {
      setSection('profile');
    }
  }, [openProfileSectionSignal]);

  useEffect(() => {
    if (openSettingsSectionSignal && openSettingsSectionSignal > 0) {
      setSection('settings');
    }
  }, [openSettingsSectionSignal]);

  useEffect(() => {
    const id = window.setInterval(() => setCountdown(getMonthCountdown()), 30000);
    return () => clearInterval(id);
  }, []);

  // Load my incident reports
  useEffect(() => {
    const q = query(
      collection(db, 'incident_reports'),
      where('userId', '==', user.uid)
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const list = snap.docs
          .map((d) => ({
            id: d.id,
            ...(d.data() as Omit<IncidentReport, 'id'>),
          }))
          .sort((a, b) => {
            const ta = a.createdAt?.toMillis ? a.createdAt.toMillis() : 0;
            const tb = b.createdAt?.toMillis ? b.createdAt.toMillis() : 0;
            return tb - ta;
          });
        setMyReports(list);
      },
      () => {}
    );
    return () => unsub();
  }, [user.uid]);

  // Load my wallet transactions
  useEffect(() => {
    const q = query(
      collection(db, 'wallet_transactions'),
      where('userId', '==', user.uid)
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const sorted = [...snap.docs].sort((a, b) => {
          const ta = a.data().createdAt?.toMillis ? a.data().createdAt.toMillis() : 0;
          const tb = b.data().createdAt?.toMillis ? b.data().createdAt.toMillis() : 0;
          return tb - ta;
        });
        setWalletTxs(
          sorted.map((d) => ({
            id: d.id,
            amount: Number(d.data().amount || 0),
            description: String(d.data().description || 'Reward'),
          }))
        );
      },
      () => {}
    );
    return () => unsub();
  }, [user.uid]);

  // Load live OPay Settings
  useEffect(() => {
    const unsub = onSnapshot(
      doc(db, 'app_settings', 'opay'),
      (snap) => {
        if (snap.exists()) {
          setOpaySettings(snap.data() as OPaySettings);
        } else {
          setOpaySettings(null);
        }
      },
      () => {}
    );
    return () => unsub();
  }, []);

  // Load my OPay payments
  useEffect(() => {
    const q = query(
      collection(db, 'payments'),
      where('userId', '==', user.uid)
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const list = snap.docs
          .map((d) => ({
            id: d.id,
            ...(d.data() as Omit<PaymentDoc, 'id'>),
          }))
          .sort((a, b) => {
            const ta = a.createdAt?.toMillis ? a.createdAt.toMillis() : 0;
            const tb = b.createdAt?.toMillis ? b.createdAt.toMillis() : 0;
            return tb - ta;
          });
        setMyPayments(list);
      },
      () => {}
    );
    return () => unsub();
  }, [user.uid]);

  // Load real monthly Top 10 Leaderboard (auto-refreshes live + 30s countdown tick)
  useEffect(() => {
    const month = getWatMonthKey();
    const q = query(collection(db, 'user_usage_stats'), where('month', '==', month));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const list = snap.docs
          .map((d) => ({ id: d.id, ...(d.data() as Omit<UserUsageStat, 'id'>) }))
          .filter((u) => !u.cheatingFlagged);
        setLeaderboard(list);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'user_usage_stats')
    );
    return () => unsub();
  }, []);

  // Check real Permissions API status
  const refreshPermStatuses = async () => {
    if (!navigator.permissions) return;
    try {
      const g = await navigator.permissions.query({ name: 'geolocation' as PermissionName });
      setGeoPerm(g.state.toUpperCase());
    } catch {
      setGeoPerm('UNKNOWN');
    }
    try {
      const m = await navigator.permissions.query({ name: 'microphone' as PermissionName });
      setMicPerm(m.state.toUpperCase());
    } catch {
      setMicPerm('UNKNOWN');
    }
  };

  useEffect(() => {
    if (section === 'settings') {
      refreshPermStatuses();
    }
  }, [section]);

  // Global profile picture compress (max 500x500, max 500KB) + save to localStorage ("guard_user_photo")
  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingPhoto(true);
    setProfileSavedMsg(null);
    try {
      const { localDataUrl, firestoreSafeDataUrl } = await compressImageTo500(file);

      // Save ONCE globally to localStorage ("guard_user_photo" & "guard_user_name")
      // so Home, Map, SOS, Report, Leaderboard update INSTANTLY without refresh
      saveUserProfilePhoto(localDataUrl);
      saveUserProfileName(fullName.trim() || displayName || user.fullName);
      setProfileSavedMsg('Profile picture updated everywhere!');

      // Best-effort non-blocking sync to Firestore/Storage so other users can also see it
      let cloudUrl = firestoreSafeDataUrl;
      try {
        const blob = await (await fetch(localDataUrl)).blob();
        const sRef = ref(storage, `users/${user.uid}/profile.jpg`);
        await uploadBytes(sRef, blob);
        cloudUrl = await getDownloadURL(sRef);
      } catch {
        cloudUrl = firestoreSafeDataUrl;
      }

      if (cloudUrl.length <= 145000) {
        updateDoc(doc(db, 'users', user.uid), {
          photoURL: cloudUrl,
          profilePicUrl: cloudUrl,
        }).catch(() => {});
        updateDoc(doc(db, 'public_profiles', user.uid), {
          photoURL: cloudUrl,
        }).catch(() => {});
        setDoc(
          doc(db, 'me_profiles', user.uid),
          {
            userId: user.uid,
            photoURL: cloudUrl,
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        ).catch(() => {});
        if (usageStatDocId) {
          updateDoc(doc(db, 'user_usage_stats', usageStatDocId), {
            avatar: cloudUrl,
          }).catch(() => {});
        }
      }
    } catch {
      setProfileSavedMsg('Could not process selected photo.');
    } finally {
      setUploadingPhoto(false);
    }
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingProfile(true);
    setProfileSavedMsg(null);
    const nextName = fullName.trim() || user.fullName;
    saveUserProfileName(nextName);
    try {
      await updateDoc(doc(db, 'users', user.uid), {
        fullName: nextName,
        username: username.trim(),
        phone: phone.trim(),
        city: city.trim(),
        userState,
        bio: bio.trim(),
        emergencyContact: emergencyContact.trim(),
      });
      await updateDoc(doc(db, 'public_profiles', user.uid), {
        fullName: nextName,
        username: username.trim(),
        city: city.trim(),
        userState,
        bio: bio.trim(),
      });
      await setDoc(
        doc(db, 'me_profiles', user.uid),
        {
          userId: user.uid,
          fullName: nextName,
          phone: phone.trim(),
          city: city.trim(),
          userState,
          bio: bio.trim(),
          emergencyContact: emergencyContact.trim(),
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
      if (usageStatDocId) {
        await updateDoc(doc(db, 'user_usage_stats', usageStatDocId), {
          name: nextName,
        });
      }
      setProfileSavedMsg('Profile saved.');
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `users/${user.uid}`);
    } finally {
      setSavingProfile(false);
    }
  };

  const handleReceiptFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const scale = Math.min(1, 720 / img.width);
        canvas.width = img.width * scale;
        canvas.height = img.height * scale;
        const c = canvas.getContext('2d');
        c?.drawImage(img, 0, 0, canvas.width, canvas.height);
        setReceiptDataUrl(canvas.toDataURL('image/jpeg', 0.72));
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  };

  const handleSubmitOPayReceipt = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!payModalPlan || !receiptDataUrl) return;
    setSubmittingPayment(true);
    const amount = payModalPlan === 'Monthly' ? 5000 : 35000;
    try {
      await addDoc(collection(db, 'payments'), {
        userId: user.uid,
        userName: user.fullName,
        plan: payModalPlan,
        amount,
        purpose: `${payModalPlan} Guard AI Subscription`,
        receiptImage: receiptDataUrl,
        status: 'PENDING',
        createdAt: serverTimestamp(),
      });
      await addDoc(collection(db, 'subscriptions'), {
        userId: user.uid,
        plan: payModalPlan,
        status: 'pending',
        amount,
        createdAt: serverTimestamp(),
      });
      setPayModalPlan(null);
      setReceiptDataUrl('');
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'payments');
    } finally {
      setSubmittingPayment(false);
    }
  };

  // Sorted Top 10 Leaderboard
  const sortedLeaderboard = [...leaderboard].sort((a, b) => {
    if (lbSort === 'scans') return b.totalScans - a.totalScans;
    if (lbSort === 'usage') return b.totalUsageMinutes - a.totalUsageMinutes;
    return b.totalPoints - a.totalPoints;
  });
  const top10 = sortedLeaderboard.slice(0, 10);
  const myIndex = sortedLeaderboard.findIndex((x) => x.userId === user.uid);
  const myStat = myIndex >= 0 ? sortedLeaderboard[myIndex] : null;
  const leaderPoints = sortedLeaderboard[0]?.totalPoints || 1;

  return (
    <div className="flex flex-col min-h-full">
      <div className="flex-1 px-4 py-4 space-y-4 max-w-2xl mx-auto w-full">
        {/* Sub-navigation */}
        <div className="grid grid-cols-4 gap-1.5 bg-[#0C1626] border border-slate-800 p-1.5 rounded-2xl">
          {[
            { id: 'profile', label: 'Profile', icon: UserIcon },
            { id: 'subscriptions', label: 'Plans', icon: CreditCard },
            { id: 'leaderboard', label: 'Top 10', icon: Trophy },
            { id: 'settings', label: 'Settings', icon: Settings },
          ].map((item) => {
            const Icon = item.icon;
            const active = section === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setSection(item.id as typeof section)}
                className={`py-2 px-2 rounded-xl text-[11px] font-bold flex items-center justify-center gap-1 cursor-pointer ${
                  active ? 'bg-[#2E9BFF] text-white' : 'text-slate-400 hover:text-white'
                }`}
              >
                <Icon className="w-3.5 h-3.5 shrink-0" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>

        {/* SECTION 1: PROFILE + WALLET + MY REPORTS */}
        {section === 'profile' && (
          <div className="space-y-4">
            {/* Avatar + Wallet Card */}
            <div className="bg-[#0C1626] border border-slate-800 rounded-2xl p-5 space-y-4">
              <div className="flex items-center gap-4">
                <div className="relative" data-tutorial-target="profile-avatar-circle">
                  <UserAvatar
                    photoURL={displayPhoto}
                    name={displayName}
                    size="xl"
                    borderVariant="purple"
                    fallbackVariant="purple"
                  />
                  <label className="absolute bottom-0 right-0 w-8 h-8 rounded-full bg-[#00E67A] text-slate-950 flex items-center justify-center shadow-lg cursor-pointer ring-2 ring-[#0C1626]">
                    <Camera className="w-4 h-4" />
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleAvatarUpload}
                      className="hidden"
                    />
                  </label>
                </div>
                <div className="min-w-0 flex-1">
                  <h2 className="text-lg font-extrabold text-white truncate">{displayName}</h2>
                  <p className="text-xs text-slate-400 truncate">
                    {user.email || user.phone || 'Guard AI Member'}
                  </p>
                  <span className="inline-block mt-1.5 px-2.5 py-0.5 rounded-lg bg-[#00E67A]/15 text-[#00E67A] text-[11px] font-bold">
                    {activePlan} Plan • {uploadingPhoto ? 'Uploading...' : 'Active'}
                  </span>
                </div>
              </div>

              <div className="p-3.5 rounded-2xl bg-[#050B14] border border-slate-800 flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <Wallet className="w-5 h-5 text-[#00E67A]" />
                  <div>
                    <p className="text-[11px] text-slate-400">Guard AI Wallet Balance</p>
                    <p className="text-lg font-extrabold font-mono text-white">
                      ₦{(user.walletBalance ?? 0).toLocaleString()}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={onOpenReportModal}
                  className="px-3 py-2 rounded-xl bg-orange-500 text-white font-bold text-xs cursor-pointer"
                >
                  Earn ₦5,000
                </button>
              </div>
            </div>

            {/* Edit Profile Form */}
            <form
              onSubmit={handleSaveProfile}
              className="bg-[#0C1626] border border-slate-800 rounded-2xl p-5 space-y-3"
            >
              <h3 className="text-sm font-extrabold text-white">Edit Profile</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <input
                  type="text"
                  placeholder="Full Name"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="px-3.5 py-2.5 rounded-xl bg-[#050B14] border border-slate-800 text-sm text-white"
                />
                <input
                  type="text"
                  placeholder="Username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="px-3.5 py-2.5 rounded-xl bg-[#050B14] border border-slate-800 text-sm text-white"
                />
                <input
                  type="tel"
                  placeholder="Phone Number"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="px-3.5 py-2.5 rounded-xl bg-[#050B14] border border-slate-800 text-sm text-white"
                />
                <input
                  type="text"
                  placeholder="City"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  className="px-3.5 py-2.5 rounded-xl bg-[#050B14] border border-slate-800 text-sm text-white"
                />
                <input
                  type="text"
                  placeholder="State (e.g. Lagos)"
                  value={userState}
                  onChange={(e) => setUserState(e.target.value)}
                  className="px-3.5 py-2.5 rounded-xl bg-[#050B14] border border-slate-800 text-sm text-white"
                />
                <input
                  type="text"
                  placeholder="Emergency Contact Phone"
                  value={emergencyContact}
                  onChange={(e) => setEmergencyContact(e.target.value)}
                  className="px-3.5 py-2.5 rounded-xl bg-[#050B14] border border-slate-800 text-sm text-white"
                />
              </div>
              <textarea
                rows={2}
                placeholder="Short safety bio..."
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl bg-[#050B14] border border-slate-800 text-sm text-white"
              />
              {profileSavedMsg && (
                <p className="text-xs font-semibold text-[#00E67A]">{profileSavedMsg}</p>
              )}
              <button
                type="submit"
                disabled={savingProfile}
                className="w-full py-3 rounded-xl bg-[#2E9BFF] text-white font-bold text-sm cursor-pointer"
              >
                {savingProfile ? 'Saving...' : 'Save Profile'}
              </button>
            </form>

            {/* My Incident Reports */}
            <div className="bg-[#0C1626] border border-slate-800 rounded-2xl p-4 space-y-2.5">
              <h3 className="text-sm font-extrabold text-white">My Incident Reports</h3>
              {myReports.length === 0 ? (
                <p className="text-xs text-slate-400">No incident reports submitted yet.</p>
              ) : (
                <div className="space-y-2">
                  {myReports.map((r) => (
                    <div
                      key={r.id}
                      className="p-3 rounded-xl bg-[#050B14] border border-slate-800 flex items-center justify-between gap-2.5 text-xs"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <UserAvatar
                          photoURL={displayPhoto}
                          name={displayName}
                          size="sm"
                          borderVariant="purple"
                          fallbackVariant="purple"
                        />
                        <div className="min-w-0">
                          <p className="font-bold text-white truncate">
                            {r.incidentType} • {r.incidentAddress}
                          </p>
                          <p className="text-[11px] text-slate-400">
                            {displayName} • Status: {r.status} • Reward:{' '}
                            {r.paymentStatus === 'paid' ? 'Paid ₦5,000' : 'Unpaid'}
                          </p>
                        </div>
                      </div>
                      <span
                        className={`px-2 py-1 rounded-lg font-bold text-[10px] shrink-0 ${
                          r.paymentStatus === 'paid'
                            ? 'bg-[#00E67A]/15 text-[#00E67A]'
                            : 'bg-[#FFC400]/15 text-[#FFC400]'
                        }`}
                      >
                        {r.paymentStatus === 'paid' ? '₦5,000 Paid' : 'Pending'}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Wallet Transactions */}
            {walletTxs.length > 0 && (
              <div className="bg-[#0C1626] border border-slate-800 rounded-2xl p-4 space-y-2">
                <h3 className="text-xs font-extrabold text-white">Wallet Credits</h3>
                {walletTxs.map((tx) => (
                  <div
                    key={tx.id}
                    className="flex justify-between text-xs text-slate-300 py-1 border-b border-slate-800/60"
                  >
                    <span>{tx.description}</span>
                    <span className="font-mono font-bold text-[#00E67A]">
                      +₦{tx.amount.toLocaleString()}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* SECTION 2: SUBSCRIPTIONS & MANUAL OPAY */}
        {section === 'subscriptions' && (
          <div className="space-y-4">
            <div className="bg-[#0C1626] border border-slate-800 rounded-2xl p-4 flex items-center justify-between text-xs">
              <span className="text-slate-300 font-semibold">
                Current Plan: <strong className="text-[#00E67A]">{activePlan}</strong>
              </span>
              <span className="font-mono font-bold text-[#2E9BFF]">
                Scans Today: {activePlan === 'Free' ? `${scansToday} / 2` : `${scansToday} / Unlimited`}
              </span>
            </div>

            {/* Exact 3 Plan Cards */}
            <div className="space-y-3">
              {/* Free */}
              <div className="bg-[#0C1626] border border-slate-800 rounded-2xl p-5 space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-base font-extrabold text-white">Free</h3>
                  <span className="text-xl font-extrabold font-mono text-white">₦0</span>
                </div>
                <p className="text-xs text-slate-400">
                  • 2 combined scans/day (Road, Vehicle &amp; Building) • 1 Family member
                </p>
                <div className="pt-1 text-xs font-bold text-slate-400">
                  {activePlan === 'Free' ? 'Current Active Plan' : 'Included'}
                </div>
              </div>

              {/* Monthly */}
              <div className="bg-[#0C1626] border-2 border-[#2E9BFF] rounded-2xl p-5 space-y-3 relative">
                <span className="absolute -top-2.5 right-4 px-2.5 py-0.5 rounded-md bg-[#2E9BFF] text-white text-[10px] font-extrabold">
                  MOST POPULAR
                </span>
                <div className="flex items-center justify-between">
                  <h3 className="text-base font-extrabold text-white">Monthly</h3>
                  <span className="text-xl font-extrabold font-mono text-[#2E9BFF]">
                    ₦5,000 / month
                  </span>
                </div>
                <p className="text-xs text-slate-300">
                  • Unlimited Daily Scans • 10 Family members • Report &amp; Earn ₦5,000 enabled
                </p>
                <button
                  type="button"
                  onClick={() => setPayModalPlan('Monthly')}
                  className="w-full py-3 rounded-xl bg-[#2E9BFF] text-white font-extrabold text-sm cursor-pointer"
                >
                  {activePlan === 'Monthly' ? 'Renew Monthly (₦5,000)' : 'Pay via OPay — ₦5,000'}
                </button>
              </div>

              {/* Yearly */}
              <div className="bg-[#0C1626] border-2 border-[#00E67A] rounded-2xl p-5 space-y-3 relative">
                <span className="absolute -top-2.5 right-4 px-2.5 py-0.5 rounded-md bg-[#00E67A] text-slate-950 text-[10px] font-extrabold">
                  BEST VALUE - SAVE ₦25,000
                </span>
                <div className="flex items-center justify-between">
                  <h3 className="text-base font-extrabold text-white">Yearly</h3>
                  <span className="text-xl font-extrabold font-mono text-[#00E67A]">
                    ₦35,000 / year
                  </span>
                </div>
                <p className="text-xs text-slate-300">
                  • Unlimited Daily Scans • 20 Family members • Priority Police Dispatch • 1 Free Safe Business Listing
                </p>
                <button
                  type="button"
                  onClick={() => setPayModalPlan('Yearly')}
                  className="w-full py-3 rounded-xl bg-[#00E67A] text-slate-950 font-extrabold text-sm cursor-pointer"
                >
                  {activePlan === 'Yearly' ? 'Renew Yearly (₦35,000)' : 'Pay via OPay — ₦35,000'}
                </button>
              </div>
            </div>

            {/* Payment Receipt History */}
            {myPayments.length > 0 && (
              <div className="bg-[#0C1626] border border-slate-800 rounded-2xl p-4 space-y-2">
                <h4 className="text-xs font-extrabold text-white">Your OPay Payment Receipts</h4>
                {myPayments.map((p) => (
                  <div
                    key={p.id}
                    className="flex items-center justify-between text-xs p-2.5 rounded-xl bg-[#050B14] border border-slate-800"
                  >
                    <span>
                      {p.plan} — ₦{p.amount.toLocaleString()}
                    </span>
                    <span
                      className={`font-bold ${
                        p.status === 'APPROVED'
                          ? 'text-[#00E67A]'
                          : p.status === 'REJECTED'
                          ? 'text-[#FF2D55]'
                          : 'text-[#FFC400]'
                      }`}
                    >
                      {p.status}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* SECTION 3: REAL TOP 10 MONTHLY LEADERBOARD */}
        {section === 'leaderboard' && (
          <div className="space-y-4">
            <div className="bg-[#0C1626] border border-slate-800 rounded-2xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-base font-extrabold text-white flex items-center gap-2">
                    <Trophy className="w-5 h-5 text-[#FFC400]" />
                    <span>Top 10 Monthly Leaderboard</span>
                  </h2>
                  <p className="text-xs text-slate-400 flex items-center gap-1 mt-0.5">
                    <Clock className="w-3.5 h-3.5" />
                    <span>Resets at end of month • {countdown}</span>
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setCountdown(getMonthCountdown())}
                  className="p-2 rounded-xl bg-[#050B14] border border-slate-800 text-slate-300 cursor-pointer"
                  aria-label="Refresh Leaderboard"
                >
                  <RefreshCw className="w-4 h-4" />
                </button>
              </div>

              <div className="grid grid-cols-3 gap-2">
                {[
                  { id: 'points', label: 'By Points' },
                  { id: 'scans', label: 'By Scans' },
                  { id: 'usage', label: 'By Usage' },
                ].map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setLbSort(tab.id as typeof lbSort)}
                    className={`py-2 rounded-xl text-xs font-bold cursor-pointer ${
                      lbSort === tab.id
                        ? 'bg-[#FFC400] text-slate-950'
                        : 'bg-[#050B14] text-slate-300 border border-slate-800'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Gold My Row Card: Always show MY picture + MY points at top */}
            <div className="p-4 rounded-2xl bg-[#FFC400]/10 border-2 border-[#FFC400]/60 space-y-2.5">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <UserAvatar
                    photoURL={displayPhoto}
                    name={displayName}
                    size="40"
                    borderVariant="purple"
                    fallbackVariant="purple"
                  />
                  <div className="min-w-0">
                    <p className="text-xs font-extrabold text-white truncate">{displayName}</p>
                    <p className="text-[11px] font-bold text-[#FFC400]">
                      {myStat ? `Your Current Rank: #${myIndex + 1}` : 'Your Score This Month'}
                    </p>
                  </div>
                </div>
                <span className="text-sm font-mono font-extrabold text-[#FFC400] shrink-0">
                  {myStat ? myStat.totalPoints : 20} pts
                </span>
              </div>
              {myStat && (
                <div className="w-full h-2 rounded-full bg-[#050B14] overflow-hidden">
                  <div
                    className="h-full bg-[#FFC400]"
                    style={{
                      width: `${Math.min(100, Math.round((myStat.totalPoints / leaderPoints) * 100))}%`,
                    }}
                  />
                </div>
              )}
            </div>

            {/* Real Table */}
            <div className="bg-[#0C1626] border border-slate-800 rounded-2xl overflow-hidden">
              {top10.length === 0 ? (
                <div className="p-8 text-center space-y-1.5">
                  <Award className="w-10 h-10 text-[#FFC400] mx-auto" />
                  <p className="text-sm font-bold text-white">No rankings yet this month.</p>
                  <p className="text-xs text-slate-400">
                    Start scanning to climb the Top 10!
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-[#050B14] text-slate-400 border-b border-slate-800">
                      <tr>
                        <th className="py-2.5 px-3">Rank</th>
                        <th className="py-2.5 px-3">Name</th>
                        <th className="py-2.5 px-2">Scans</th>
                        <th className="py-2.5 px-2">Usage</th>
                        <th className="py-2.5 px-2">Verified</th>
                        <th className="py-2.5 px-2">Points</th>
                        <th className="py-2.5 px-3">Prize</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/80">
                      {top10.map((row, idx) => {
                        const isMe = row.userId === user.uid;
                        const prize =
                          idx === 0
                            ? '₦10,000 + Gold'
                            : idx === 1
                            ? '₦5,000'
                            : idx === 2
                            ? '₦2,500'
                            : '1 Mo Free';
                        return (
                          <tr
                            key={row.id}
                            onClick={() => onOpenProfile(row.userId)}
                            className={`cursor-pointer ${
                              isMe ? 'bg-[#FFC400]/15' : 'hover:bg-slate-800/40'
                            }`}
                          >
                            <td className="py-2.5 px-3 font-mono font-bold text-white">
                              #{idx + 1}
                            </td>
                            <td className="py-2.5 px-3">
                              <div className="flex items-center gap-2">
                                <UserAvatar
                                  photoURL={isMe ? displayPhoto : row.avatar}
                                  name={isMe ? displayName : row.name}
                                  size="xs"
                                  borderVariant={isMe ? 'purple' : 'green'}
                                  fallbackVariant={isMe ? 'purple' : 'grey'}
                                />
                                <span className="font-semibold text-white truncate max-w-[110px]">
                                  {isMe ? displayName : row.name}
                                </span>
                              </div>
                            </td>
                            <td className="py-2.5 px-2 font-mono">{row.totalScans}</td>
                            <td className="py-2.5 px-2 font-mono">
                              {Math.round(row.totalUsageMinutes)}m
                            </td>
                            <td className="py-2.5 px-2 font-mono text-[#00E67A]">
                              {row.verifiedReports}
                            </td>
                            <td className="py-2.5 px-2 font-mono font-bold text-[#FFC400]">
                              {row.totalPoints}
                            </td>
                            <td className="py-2.5 px-3 text-[11px] font-semibold text-[#00E67A]">
                              {prize}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* SECTION 4: SETTINGS & REAL PERMISSIONS */}
        {section === 'settings' && (
          <div className="space-y-4">
            <div className="bg-[#0C1626] border border-slate-800 rounded-2xl p-5 space-y-4">
              <h3 className="text-sm font-extrabold text-white">App Preferences</h3>

              <label className="flex items-center justify-between text-sm text-slate-200">
                <span>Threat Notifications</span>
                <input
                  type="checkbox"
                  checked={notifEnabled}
                  onChange={(e) => setNotifEnabled(e.target.checked)}
                  className="w-5 h-5 accent-[#00E67A]"
                />
              </label>

              <label className="flex items-center justify-between text-sm text-slate-200">
                <span>Family Live Location Sharing</span>
                <input
                  type="checkbox"
                  checked={shareLocation}
                  onChange={(e) => setShareLocation(e.target.checked)}
                  className="w-5 h-5 accent-[#00E67A]"
                />
              </label>

              <label className="flex items-center justify-between text-sm text-slate-200">
                <span>Dark Safety Theme</span>
                <input
                  type="checkbox"
                  checked={darkMode}
                  onChange={onToggleDarkMode}
                  className="w-5 h-5 accent-[#00E67A]"
                />
              </label>

              <div className="flex items-center justify-between text-sm text-slate-200">
                <span>Language</span>
                <select
                  value={language}
                  onChange={(e) => setLanguage(e.target.value)}
                  className="px-3 py-1.5 rounded-xl bg-[#050B14] border border-slate-800 text-xs text-white"
                >
                  <option value="English">English</option>
                  <option value="Pidgin">Nigerian Pidgin</option>
                  <option value="Yoruba">Yoruba</option>
                  <option value="Igbo">Igbo</option>
                  <option value="Hausa">Hausa</option>
                </select>
              </div>
            </div>

            {/* Real Device Permissions Status */}
            <div className="bg-[#0C1626] border border-slate-800 rounded-2xl p-5 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-extrabold text-white flex items-center gap-2">
                  <Shield className="w-4 h-4 text-[#00E67A]" />
                  <span>Device Sensor Permissions</span>
                </h3>
                <button
                  type="button"
                  onClick={refreshPermStatuses}
                  className="text-xs text-[#2E9BFF] font-semibold cursor-pointer"
                >
                  Check Again
                </button>
              </div>
              <div className="flex items-center justify-between text-xs p-3 rounded-xl bg-[#050B14] border border-slate-800">
                <span className="text-slate-300">Location (GPS)</span>
                <span
                  className={`font-mono font-bold ${
                    geoPerm === 'GRANTED' ? 'text-[#00E67A]' : 'text-[#FFC400]'
                  }`}
                >
                  {geoPerm}
                </span>
              </div>
              <div className="flex items-center justify-between text-xs p-3 rounded-xl bg-[#050B14] border border-slate-800">
                <span className="text-slate-300">Microphone (Acoustic Threat Scan)</span>
                <span
                  className={`font-mono font-bold ${
                    micPerm === 'GRANTED' ? 'text-[#00E67A]' : 'text-[#FFC400]'
                  }`}
                >
                  {micPerm}
                </span>
              </div>
            </div>

            {/* Settings > Help: Replay Tutorial */}
            <div className="bg-[#0C1626] border border-slate-800 rounded-2xl p-5 space-y-3">
              <div className="flex items-center gap-2">
                <HelpCircle className="w-4 h-4 text-[#2E9BFF]" />
                <h3 className="text-sm font-extrabold text-white">Help</h3>
              </div>
              <p className="text-xs text-slate-400">
                Want to see how every button in Guard AI works again?
              </p>
              <button
                type="button"
                onClick={() => onReplayTutorial?.()}
                className="w-full py-3 rounded-xl bg-[#2E9BFF] hover:bg-[#1e88eb] text-white font-extrabold text-sm flex items-center justify-center gap-2 cursor-pointer"
              >
                <HelpCircle className="w-4 h-4" />
                <span>Replay Tutorial</span>
              </button>
            </div>

            <button
              type="button"
              onClick={() => signOut(auth)}
              className="w-full py-3.5 rounded-2xl bg-[#FF2D55]/15 border border-[#FF2D55]/40 text-[#FF2D55] font-extrabold text-sm flex items-center justify-center gap-2 cursor-pointer"
            >
              <LogOut className="w-4 h-4" />
              <span>Log Out</span>
            </button>
          </div>
        )}

        <button
          type="button"
          data-tutorial-target="report-earn-button"
          onClick={onOpenReportModal}
          className="w-full min-h-[48px] py-3 px-4 rounded-2xl bg-orange-500 hover:bg-orange-600 text-white font-extrabold text-sm cursor-pointer"
        >
          Report &amp; Earn ₦5,000
        </button>
      </div>

      <AdBanner />

      {/* Manual OPay Payment Modal */}
      {payModalPlan && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="w-full max-w-md bg-[#0C1626] border border-slate-800 rounded-t-3xl sm:rounded-3xl p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-extrabold text-white">
                Pay ₦{payModalPlan === 'Monthly' ? '5,000' : '35,000'} via OPay
              </h2>
              <button
                type="button"
                onClick={() => setPayModalPlan(null)}
                className="w-9 h-9 rounded-full bg-slate-800 text-slate-300 flex items-center justify-center cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {opaySettings ? (
              <div className="p-4 rounded-2xl bg-[#050B14] border border-[#00E67A]/40 space-y-2">
                <p className="text-xs text-slate-400">Transfer exact amount to:</p>
                <p className="text-sm font-bold text-white">{opaySettings.bankName}</p>
                <p className="text-xs text-slate-300">{opaySettings.accountName}</p>
                <div className="flex items-center justify-between pt-1">
                  <span className="text-lg font-mono font-extrabold text-[#00E67A]">
                    {opaySettings.accountNumber}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard?.writeText(opaySettings.accountNumber).catch(() => {});
                      setCopiedAccount(true);
                      window.setTimeout(() => setCopiedAccount(false), 2500);
                    }}
                    className="px-3 py-1.5 rounded-xl bg-[#00E67A] text-slate-950 font-extrabold text-xs flex items-center gap-1 cursor-pointer"
                  >
                    <Copy className="w-3.5 h-3.5" />
                    <span>{copiedAccount ? 'Copied!' : 'COPY ACCOUNT NUMBER'}</span>
                  </button>
                </div>
              </div>
            ) : (
              <div className="p-4 rounded-2xl bg-[#FFC400]/10 border border-[#FFC400]/40 text-xs text-[#FFC400]">
                OPay bank account details have not been configured by Admin yet. Please ask Admin to
                save OPay details in the Admin Tab.
              </div>
            )}

            <form onSubmit={handleSubmitOPayReceipt} className="space-y-3">
              <label className="w-full py-3 px-4 rounded-xl bg-[#050B14] border border-dashed border-slate-700 text-xs font-bold text-slate-200 flex items-center justify-center gap-2 cursor-pointer">
                <Upload className="w-4 h-4 text-[#2E9BFF]" />
                <span>
                  {receiptDataUrl ? 'Receipt Screenshot Selected' : 'Upload OPay Receipt Image'}
                </span>
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleReceiptFile}
                  className="hidden"
                />
              </label>

              {receiptDataUrl && (
                <img
                  src={receiptDataUrl}
                  alt="OPay Receipt Preview"
                  className="w-full h-36 object-contain rounded-xl bg-black border border-slate-800"
                />
              )}

              <button
                type="submit"
                disabled={!receiptDataUrl || submittingPayment}
                className="w-full py-3 rounded-xl bg-[#2E9BFF] disabled:bg-slate-800 text-white font-extrabold text-sm flex items-center justify-center gap-2 cursor-pointer"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>{submittingPayment ? 'Uploading...' : 'I HAVE PAID - UPLOAD RECEIPT'}</span>
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
