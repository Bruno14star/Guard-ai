import React, { useEffect, useMemo, useState } from 'react';
import {
  addDoc,
  collection,
  doc,
  onSnapshot,
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
  ChevronRight,
  Clock,
  Copy,
  CreditCard,
  Crown,
  Edit3,
  Gift,
  HelpCircle,
  LogOut,
  MapPin,
  MessageSquare,
  Navigation,
  RefreshCw,
  Search,
  Settings,
  Share2,
  Shield,
  Trophy,
  Upload,
  User as UserIcon,
  Wallet,
  X,
} from 'lucide-react';
import { auth, db, handleFirestoreError, OperationType, storage } from '../firebase';
import { NIGERIAN_STATES } from '../data/nigeriaPoliceSeed';
import {
  HumanLocation,
  IncidentReport,
  OPaySettings,
  PaymentDoc,
  PlanType,
  ReferralDoc,
  StarterGuardsSettings,
  UserProfile,
  UserUsageStat,
} from '../types';
import {
  formatCityStateLabel,
  getWatMonthKey,
  isLocationStale7Days,
} from '../utils/geoPhysics';
import {
  buildEndOfMonthWinnerSummary,
  buildTopUsersDisplayList,
  generateReferralCode,
  getEffectiveGuardScore,
  getEffectiveSubscription,
  isEndOfMonthFreezeWindowWat,
  isEligibleForTop10,
  sortTop10Guardians,
} from '../utils/guardScore';
import {
  compressImageToJpegBlob,
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
  onSetMyLocation: () => Promise<boolean>;
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

const CITY_PRESETS = ['Port Harcourt', 'Lagos', 'Abuja', 'Kano', 'Ibadan', 'Enugu', 'Benin City'];

export const MeTab: React.FC<MeTabProps> = ({
  user,
  location,
  scansToday,
  activePlan,
  usageStatDocId,
  darkMode,
  onToggleDarkMode,
  onSetMyLocation,
  onOpenReportModal,
  onOpenProfile,
  onReplayTutorial,
  openSubSectionSignal,
  openProfileSectionSignal,
  openSettingsSectionSignal,
}) => {
  const userPhoto = user.profilePicUrl || user.photoURL || '';
  const globalProfile = useGlobalUserProfile(user.fullName, userPhoto);
  const displayName = globalProfile.name || user.fullName;
  const displayPhoto = globalProfile.photo || userPhoto;

  const [section, setSection] = useState<'profile' | 'subscriptions' | 'leaderboard' | 'settings'>(
    'profile'
  );

  // Profile Edit State (NEVER default state to Lagos)
  const [fullName, setFullName] = useState(displayName || '');
  const [username, setUsername] = useState(user.username || '');
  const [phone, setPhone] = useState(user.phone || '');
  const [city, setCity] = useState(user.city || '');
  const [userState, setUserState] = useState(user.state || user.userState || '');
  const [bio, setBio] = useState(user.bio || '');
  const [emergencyContact, setEmergencyContact] = useState(user.emergencyContact || '');
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileSavedMsg, setProfileSavedMsg] = useState<string | null>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);

  // Manual Location Editor Modal/Drawer
  const [editLocOpen, setEditLocOpen] = useState(false);
  const [manualCity, setManualCity] = useState(user.city || '');
  const [manualState, setManualState] = useState(user.state || user.userState || '');
  const [savingLoc, setSavingLoc] = useState(false);
  const [locMsg, setLocMsg] = useState<string | null>(null);

  // My Reports, Wallet & Referrals
  const [myReports, setMyReports] = useState<IncidentReport[]>([]);
  const [walletTxs, setWalletTxs] = useState<{ id: string; amount: number; description: string }[]>([]);
  const [myReferrals, setMyReferrals] = useState<ReferralDoc[]>([]);
  const [copiedRefCode, setCopiedRefCode] = useState(false);
  const [copiedRefLink, setCopiedRefLink] = useState(false);

  // Subscriptions & Manual OPay Payment
  const [opaySettings, setOpaySettings] = useState<OPaySettings | null>(null);
  const [myPayments, setMyPayments] = useState<PaymentDoc[]>([]);
  const [payModalPlan, setPayModalPlan] = useState<'Monthly' | 'Yearly' | null>(null);
  const [receiptDataUrl, setReceiptDataUrl] = useState<string>('');
  const [submittingPayment, setSubmittingPayment] = useState(false);
  const [copiedAccount, setCopiedAccount] = useState(false);

  // Real Monthly Top 10 Guardians (Subscribers Only) + Starter Guards toggle
  const [monthlyStats, setMonthlyStats] = useState<UserUsageStat[]>([]);
  const [starterSettings, setStarterSettings] = useState<StarterGuardsSettings>({
    showInApp: true,
    starterRemoved: false,
  });
  const [showAllUsersModal, setShowAllUsersModal] = useState(false);
  const [allListSearch, setAllListSearch] = useState('');
  const [countdown, setCountdown] = useState<string>(getMonthCountdown());

  // Settings & Real Device Permissions
  const [notifEnabled, setNotifEnabled] = useState(true);
  const [shareLocation, setShareLocation] = useState(true);
  const [language, setLanguage] = useState('English');
  const [geoPerm, setGeoPerm] = useState<string>('checking');
  const [micPerm, setMicPerm] = useState<string>('checking');

  const subInfo = useMemo(() => getEffectiveSubscription(user), [user]);
  const myReferralCode = useMemo(
    () => user.referralCode || generateReferralCode(user.fullName, user.uid),
    [user.referralCode, user.fullName, user.uid]
  );
  const referralLink = `https://guardaitech.netlify.app/?ref=${myReferralCode}`;
  const whatsappInviteText = `I use Guard AI to scan roads, buildings, vehicles before I enter. Stay safe. Join with my code ${myReferralCode}: ${referralLink}`;

  useEffect(() => {
    setCity(user.city || '');
    setUserState(user.state || user.userState || '');
    setManualCity(user.city || '');
    setManualState(user.state || user.userState || '');
  }, [user.city, user.state, user.userState]);

  useEffect(() => {
    if (openSubSectionSignal && openSubSectionSignal > 0) setSection('subscriptions');
  }, [openSubSectionSignal]);

  useEffect(() => {
    if (openProfileSectionSignal && openProfileSectionSignal > 0) setSection('profile');
  }, [openProfileSectionSignal]);

  useEffect(() => {
    if (openSettingsSectionSignal && openSettingsSectionSignal > 0) setSection('settings');
  }, [openSettingsSectionSignal]);

  useEffect(() => {
    const id = window.setInterval(() => setCountdown(getMonthCountdown()), 30000);
    return () => clearInterval(id);
  }, []);

  // Load my incident reports
  useEffect(() => {
    const q = query(collection(db, 'incident_reports'), where('userId', '==', user.uid));
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
    const q = query(collection(db, 'wallet_transactions'), where('userId', '==', user.uid));
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

  // Load my referrals (where referrerUid == user.uid)
  useEffect(() => {
    const q = query(collection(db, 'referrals'), where('referrerUid', '==', user.uid));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const list = snap.docs
          .map((d) => ({
            id: d.id,
            ...(d.data() as Omit<ReferralDoc, 'id'>),
          }))
          .sort((a, b) => {
            const ta = a.createdAt?.toMillis ? a.createdAt.toMillis() : 0;
            const tb = b.createdAt?.toMillis ? b.createdAt.toMillis() : 0;
            return tb - ta;
          });
        setMyReferrals(list);
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
        setOpaySettings(snap.exists() ? (snap.data() as OPaySettings) : null);
      },
      () => {}
    );
    return () => unsub();
  }, []);

  // Load my OPay payments
  useEffect(() => {
    const q = query(collection(db, 'payments'), where('userId', '==', user.uid));
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

  // Load monthly user_usage_stats
  useEffect(() => {
    const month = getWatMonthKey();
    const q = query(collection(db, 'user_usage_stats'), where('month', '==', month));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const list = snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<UserUsageStat, 'id'>),
        }));
        setMonthlyStats(list);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'user_usage_stats')
    );
    return () => unsub();
  }, []);

  // Load Starter Guards display toggle & monthly freeze state
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

  // Permanent Profile Picture Upload ONLY to Firebase Storage `profilePictures/{userId}.jpg` -> Firestore profilePicUrl
  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingPhoto(true);
    setProfileSavedMsg(null);
    try {
      const jpegBlob = await compressImageToJpegBlob(file);
      const storageRef = ref(storage, `profilePictures/${user.uid}.jpg`);
      await uploadBytes(storageRef, jpegBlob, { contentType: 'image/jpeg' });
      const downloadUrl = await getDownloadURL(storageRef);

      saveUserProfilePhoto(downloadUrl);
      saveUserProfileName(fullName.trim() || displayName || user.fullName);

      await updateDoc(doc(db, 'users', user.uid), {
        profilePicUrl: downloadUrl,
        photoURL: downloadUrl,
        profilePicUpdatedAt: serverTimestamp(),
      });

      updateDoc(doc(db, 'public_profiles', user.uid), {
        profilePicUrl: downloadUrl,
        photoURL: downloadUrl,
      }).catch(() => {});

      setDoc(
        doc(db, 'me_profiles', user.uid),
        {
          userId: user.uid,
          photoURL: downloadUrl,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      ).catch(() => {});

      if (usageStatDocId) {
        updateDoc(doc(db, 'user_usage_stats', usageStatDocId), {
          profilePicUrl: downloadUrl,
          avatar: downloadUrl,
        }).catch(() => {});
      }

      setProfileSavedMsg('Profile picture saved permanently to cloud!');
    } catch (err) {
      console.error('Profile picture upload error:', err);
      setProfileSavedMsg('Upload failed — please check connection and try again.');
    } finally {
      setUploadingPhoto(false);
    }
  };

  const handleSaveManualLocation = async (e: React.FormEvent) => {
    e.preventDefault();
    const nextCity = manualCity.trim();
    const nextState = manualState.trim();
    if (!nextCity && !nextState) return;
    setSavingLoc(true);
    setLocMsg(null);
    try {
      await updateDoc(doc(db, 'users', user.uid), {
        city: nextCity,
        state: nextState,
        userState: nextState,
        locationSource: 'manual',
        locationUpdatedAt: serverTimestamp(),
      });
      await updateDoc(doc(db, 'public_profiles', user.uid), {
        city: nextCity,
        state: nextState,
        userState: nextState,
      }).catch(() => {});
      await setDoc(
        doc(db, 'me_profiles', user.uid),
        {
          userId: user.uid,
          city: nextCity,
          state: nextState,
          userState: nextState,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      ).catch(() => {});
      if (usageStatDocId) {
        await updateDoc(doc(db, 'user_usage_stats', usageStatDocId), {
          city: nextCity,
          state: nextState,
        }).catch(() => {});
      }
      setCity(nextCity);
      setUserState(nextState);
      setEditLocOpen(false);
      setLocMsg(`Location updated to ${formatCityStateLabel(nextCity, nextState)} (Manual).`);
      window.setTimeout(() => setLocMsg(null), 3500);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `users/${user.uid}`);
    } finally {
      setSavingLoc(false);
    }
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingProfile(true);
    setProfileSavedMsg(null);
    const nextName = fullName.trim() || user.fullName;
    const nextCity = city.trim();
    const nextState = userState.trim();
    const locationChanged =
      nextCity !== (user.city || '') || nextState !== (user.state || user.userState || '');
    saveUserProfileName(nextName);
    try {
      await updateDoc(doc(db, 'users', user.uid), {
        fullName: nextName,
        username: username.trim(),
        phone: phone.trim(),
        city: nextCity,
        state: nextState,
        userState: nextState,
        ...(locationChanged ? { locationSource: 'manual', locationUpdatedAt: serverTimestamp() } : {}),
        bio: bio.trim(),
        emergencyContact: emergencyContact.trim(),
      });
      await updateDoc(doc(db, 'public_profiles', user.uid), {
        fullName: nextName,
        username: username.trim(),
        city: nextCity,
        state: nextState,
        userState: nextState,
        bio: bio.trim(),
      });
      await setDoc(
        doc(db, 'me_profiles', user.uid),
        {
          userId: user.uid,
          fullName: nextName,
          phone: phone.trim(),
          city: nextCity,
          state: nextState,
          userState: nextState,
          bio: bio.trim(),
          emergencyContact: emergencyContact.trim(),
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
      if (usageStatDocId) {
        await updateDoc(doc(db, 'user_usage_stats', usageStatDocId), {
          name: nextName,
          city: nextCity,
          state: nextState,
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

  const currentMonthKey = getWatMonthKey();
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

  // All eligible real subscribers sorted by Guard Score descending (for true prize eligibility)
  const allEligibleSubscribers = useMemo(() => {
    return monthlyStats
      .filter((s) => isEligibleForTop10(s))
      .map((s) => ({ ...s, guardScore: getEffectiveGuardScore(s) }))
      .sort((a, b) => (b.guardScore ?? 0) - (a.guardScore ?? 0));
  }, [monthlyStats]);

  const realTop10 = useMemo(() => sortTop10Guardians(monthlyStats), [monthlyStats]);

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

  const top10 = useMemo(() => allTopUsersDisplay.slice(0, 10), [allTopUsersDisplay]);
  const myRankIndex = allEligibleSubscribers.findIndex((x) => x.userId === user.uid);
  const myStatRow = monthlyStats.find((x) => x.userId === user.uid) || null;
  const myGuardScore = myStatRow ? getEffectiveGuardScore(myStatRow) : user.guardScore ?? 0;
  const tenthPlaceScore = realTop10.length >= 10 ? realTop10[9].guardScore ?? 0 : 0;
  const pointsNeededToEnterTop10 =
    realTop10.length < 10
      ? subInfo.isSubscriber
        ? 0
        : Math.max(0, tenthPlaceScore - myGuardScore)
      : myRankIndex >= 0 && myRankIndex < 10
      ? 0
      : Math.max(1, tenthPlaceScore + 1 - myGuardScore);

  const availableNaira = user.availableBalanceNaira ?? user.walletBalance ?? 0;
  const totalEarnedNaira = user.totalEarnedNaira ?? user.walletBalance ?? 0;
  const totalReferralEarnings = myReferrals.reduce(
    (sum, r) => sum + (r.rewardPaid ? Number(r.rewardAmount || 0) : 0),
    0
  );

  const displayedCityState = formatCityStateLabel(
    user.city || location?.city,
    user.state || user.userState || location?.state
  );
  const locationIsStale = isLocationStale7Days(user.locationUpdatedAt);
  const currentMonthYearLabel = new Date().toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
  });

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

        {/* SECTION 1: PROFILE + LOCATION + MONTHLY RANK + WALLET + MY REPORTS */}
        {section === 'profile' && (
          <div className="space-y-4">
            {/* Avatar + Monthly Rank + Wallet Card */}
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
                    {activePlan} Plan • {uploadingPhoto ? 'Uploading to Cloud...' : subInfo.isSubscriber ? 'Active Subscriber' : 'Free Plan'}
                  </span>
                </div>
              </div>

              {/* Location Display Card with GPS / Manual Badge, Edit Location, & 7-Day Update Location */}
              <div className="p-3.5 rounded-2xl bg-[#050B14] border border-slate-800 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <MapPin className="w-4 h-4 text-[#2E9BFF] shrink-0" />
                    <span className="text-sm font-bold text-white truncate">
                      {displayedCityState}
                    </span>
                    {displayedCityState !== 'Location Not Set' && (
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-extrabold shrink-0 flex items-center gap-1 ${
                          user.locationSource === 'manual'
                            ? 'bg-[#FFC400]/15 text-[#FFC400]'
                            : 'bg-[#00E67A]/15 text-[#00E67A]'
                        }`}
                      >
                        {user.locationSource === 'manual' ? (
                          'Manual'
                        ) : (
                          <>
                            <Navigation className="w-2.5 h-2.5" />
                            GPS
                          </>
                        )}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {displayedCityState === 'Location Not Set' ? (
                      <button
                        type="button"
                        onClick={() => void onSetMyLocation()}
                        className="px-2.5 py-1 rounded-lg bg-[#2E9BFF] text-white text-[11px] font-bold cursor-pointer"
                      >
                        Set My Location
                      </button>
                    ) : locationIsStale ? (
                      <button
                        type="button"
                        onClick={() => void onSetMyLocation()}
                        className="px-2.5 py-1 rounded-lg bg-[#FFC400] text-slate-950 text-[11px] font-extrabold cursor-pointer"
                      >
                        Update Location
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => setEditLocOpen(!editLocOpen)}
                      className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] font-bold flex items-center gap-1 cursor-pointer"
                    >
                      <Edit3 className="w-3 h-3" />
                      <span>Edit Location</span>
                    </button>
                  </div>
                </div>

                {locMsg && <p className="text-xs text-[#00E67A] font-semibold">{locMsg}</p>}

                {editLocOpen && (
                  <form onSubmit={handleSaveManualLocation} className="pt-2 border-t border-slate-800 space-y-2.5">
                    <div className="flex flex-wrap gap-1.5">
                      {CITY_PRESETS.map((preset) => (
                        <button
                          key={preset}
                          type="button"
                          onClick={() => {
                            setManualCity(preset);
                            if (preset === 'Port Harcourt') setManualState('Rivers');
                            else if (preset === 'Lagos') setManualState('Lagos');
                            else if (preset === 'Abuja') setManualState('FCT Abuja');
                            else if (preset === 'Kano') setManualState('Kano');
                            else if (preset === 'Enugu') setManualState('Enugu');
                            else if (preset === 'Ibadan') setManualState('Oyo');
                            else if (preset === 'Benin City') setManualState('Edo');
                          }}
                          className={`px-2 py-1 rounded-lg text-[10px] font-bold border cursor-pointer ${
                            manualCity === preset
                              ? 'bg-[#2E9BFF] border-[#2E9BFF] text-white'
                              : 'bg-[#0C1626] border-slate-700 text-slate-300'
                          }`}
                        >
                          {preset}
                        </button>
                      ))}
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        type="text"
                        placeholder="City (e.g. Port Harcourt)"
                        value={manualCity}
                        onChange={(e) => setManualCity(e.target.value)}
                        className="px-3 py-2 rounded-xl bg-[#0C1626] border border-slate-700 text-xs text-white"
                      />
                      <select
                        value={manualState}
                        onChange={(e) => setManualState(e.target.value)}
                        className="px-3 py-2 rounded-xl bg-[#0C1626] border border-slate-700 text-xs text-white"
                      >
                        <option value="">Select State</option>
                        {NIGERIAN_STATES.map((st) => (
                          <option key={st} value={st}>
                            {st}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="submit"
                        disabled={savingLoc}
                        className="flex-1 py-2 rounded-xl bg-[#00E67A] text-slate-950 font-extrabold text-xs cursor-pointer"
                      >
                        {savingLoc ? 'Saving...' : 'Save Location'}
                      </button>
                      <button
                        type="button"
                        onClick={() => void onSetMyLocation()}
                        className="px-3 py-2 rounded-xl bg-[#2E9BFF]/15 border border-[#2E9BFF]/40 text-[#2E9BFF] font-bold text-xs cursor-pointer"
                      >
                        Use Live GPS
                      </button>
                    </div>
                  </form>
                )}
              </div>

              {/* Monthly Rank Status Banner */}
              <div className="p-3.5 rounded-2xl bg-[#FFC400]/10 border border-[#FFC400]/50 space-y-1.5">
                <p className="text-xs font-extrabold text-[#FFC400]">
                  {subInfo.isSubscriber
                    ? `Your Monthly Rank: #${myRankIndex >= 0 ? myRankIndex + 1 : 'Unranked'} - Guard Score: ${myGuardScore} - Prize If You Stay In Top 10: ₦10,000 - Points Needed To Enter Top 10: ${pointsNeededToEnterTop10}`
                    : `Your Monthly Rank: Subscriber Only - Guard Score: ${myGuardScore} - Prize If You Stay In Top 10: ₦10,000 - Points Needed To Enter Top 10: ${pointsNeededToEnterTop10}`}
                </p>
              </div>

              {/* Wallet Balance: Available + Total Earned */}
              <div className="p-3.5 rounded-2xl bg-[#050B14] border border-slate-800 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2.5">
                  <Wallet className="w-5 h-5 text-[#00E67A]" />
                  <div>
                    <p className="text-[11px] text-slate-400">Guard AI Wallet</p>
                    <p className="text-base font-extrabold font-mono text-white">
                      Available: ₦{availableNaira.toLocaleString()} • Total Earned: ₦
                      {totalEarnedNaira.toLocaleString()}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={onOpenReportModal}
                  className="px-3 py-2 rounded-xl bg-orange-500 text-white font-bold text-xs cursor-pointer shrink-0"
                >
                  Report &amp; Earn
                </button>
              </div>

              {/* Report & Earn Subscribers-Only Banner */}
              <div className="p-2.5 rounded-xl bg-orange-500/10 border border-orange-500/35 text-xs font-bold text-orange-300 text-center">
                Report &amp; Earn: ₦5,000 per verified report - Subscribers Only
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
                <select
                  value={userState}
                  onChange={(e) => setUserState(e.target.value)}
                  className="px-3.5 py-2.5 rounded-xl bg-[#050B14] border border-slate-800 text-sm text-white"
                >
                  <option value="">Select State</option>
                  {NIGERIAN_STATES.map((st) => (
                    <option key={st} value={st}>
                      {st}
                    </option>
                  ))}
                </select>
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
                            {r.paymentStatus === 'paid' ? 'Paid ₦5,000' : 'Unpaid (₦0)'}
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
                        {r.paymentStatus === 'paid' ? '₦5,000 Paid' : r.adminDecision === 'approved' ? 'Verified' : r.adminDecision === 'rejected' ? 'Rejected' : 'Pending'}
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

            <div className="space-y-3">
              {/* Free */}
              <div className="bg-[#0C1626] border border-slate-800 rounded-2xl p-5 space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-base font-extrabold text-white">Free</h3>
                  <span className="text-xl font-extrabold font-mono text-white">₦0</span>
                </div>
                <p className="text-xs text-slate-400">
                  • 2 combined scans/day (Road, Vehicle &amp; Building) • 1 Family member • Community reporting only (₦0 reward)
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
                  • Unlimited Daily Scans • 10 Family members • Report &amp; Earn ₦5,000 • Eligible for Top 10 (₦10,000 Prize) • Referral Payouts Enabled
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
                  • Unlimited Daily Scans • 20 Family members • Priority Police Dispatch • Report &amp; Earn ₦5,000 • Top 10 &amp; Referral Rewards Enabled
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

        {/* SECTION 3: TOP 10 USERS OF THE MONTH */}
        {section === 'leaderboard' && (
          <div className="space-y-4">
            <div className="bg-[#0C1626] border border-slate-800 rounded-2xl p-4 space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-base font-extrabold text-white flex items-center gap-2">
                    <Trophy className="w-5 h-5 text-[#FFC400]" />
                    <span>Top 10 Users - {currentMonthYearLabel}</span>
                  </h2>
                  <p className="text-xs font-semibold text-[#00E67A] mt-0.5">
                    Top 10 Users of the Month Win ₦10,000 - Real Subscribers Only.
                  </p>
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
              {frozenWinnerSummary && (
                <div className="p-3 rounded-xl bg-[#00E67A]/15 border border-[#00E67A]/50 text-xs font-extrabold text-white flex items-center gap-2">
                  <Crown className="w-4 h-4 text-[#FFC400] shrink-0" />
                  <span>
                    {frozenWinnerSummary.topUsers[0]
                      ? `Top User of ${frozenWinnerSummary.monthName}: ${frozenWinnerSummary.topUsers[0].name} - ₦10,000`
                      : `Top User of ${frozenWinnerSummary.monthName}: Real Subscribers Only`}
                  </span>
                </div>
              )}
              {!subInfo.isSubscriber && (
                <div className="p-3 rounded-xl bg-[#FF2D55]/10 border border-[#FF2D55]/40 text-xs font-bold text-white flex items-center justify-between gap-2">
                  <span>Top 10 is for subscribers only. Subscribe to ₦5,000 to compete for ₦10,000</span>
                  <button
                    type="button"
                    onClick={() => setSection('subscriptions')}
                    className="px-3 py-1.5 rounded-lg bg-[#2E9BFF] text-white text-xs font-extrabold shrink-0 cursor-pointer"
                  >
                    Subscribe
                  </button>
                </div>
              )}
            </div>

            {/* Gold My Row Card */}
            <div className="p-4 rounded-2xl bg-[#FFC400]/10 border-2 border-[#FFC400]/60 space-y-2">
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
                      {subInfo.isSubscriber
                        ? `Your Monthly Rank: #${myRankIndex >= 0 ? myRankIndex + 1 : 'Unranked'}`
                        : 'Subscribers Only'}
                    </p>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <span className="text-sm font-mono font-extrabold text-[#2E9BFF]">
                    {myGuardScore} Score
                  </span>
                  <p className="text-[10px] font-bold text-[#00E67A]">
                    Prize: ₦10,000
                  </p>
                </div>
              </div>
              <p className="text-[11px] text-slate-300 font-semibold">
                Guard Score To Enter Top 10: {pointsNeededToEnterTop10}
              </p>
            </div>

            {/* Top 10 Users Table */}
            <div className="bg-[#0C1626] border border-slate-800 rounded-2xl overflow-hidden">
              {top10.length === 0 ? (
                <div className="p-8 text-center space-y-1.5">
                  <Award className="w-10 h-10 text-[#FFC400] mx-auto" />
                  <p className="text-sm font-bold text-white">No ranked subscribers yet this month.</p>
                  <p className="text-xs text-slate-400">
                    Subscribe and use Guard AI scanners to climb into Top 10!
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-[#050B14] text-slate-400 border-b border-slate-800">
                      <tr>
                        <th className="py-2.5 px-3">Rank</th>
                        <th className="py-2.5 px-3">User</th>
                        <th className="py-2.5 px-3">State</th>
                        <th className="py-2.5 px-3 text-right">Guard Score</th>
                        <th className="py-2.5 px-3 text-right">Prize</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/80">
                      {top10.map((row, idx) => {
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
                            <td className="py-2.5 px-3 font-mono font-bold text-[#FFC400] whitespace-nowrap">
                              {idx === 0 ? (
                                <span className="inline-flex items-center gap-1">
                                  <Crown className="w-3.5 h-3.5 text-[#FFC400] fill-[#FFC400]/30" />
                                  #1
                                </span>
                              ) : (
                                `#${idx + 1}`
                              )}
                            </td>
                            <td className="py-2.5 px-3">
                              <div className="flex items-center gap-2">
                                <UserAvatar
                                  photoURL={rowAvatar}
                                  name={isMe ? displayName : row.name}
                                  size="xs"
                                  borderVariant={isMe ? 'purple' : 'green'}
                                  fallbackVariant={isMe ? 'purple' : 'letter'}
                                />
                                <span className="font-semibold text-white truncate max-w-[110px]">
                                  {isMe ? displayName : row.name}
                                </span>
                              </div>
                            </td>
                            <td className="py-2.5 px-3 text-slate-300">
                              {row.state || row.city || 'Nigeria'}
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono font-extrabold text-[#2E9BFF]">
                              {(row.guardScore ?? 0).toLocaleString()}
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono font-extrabold text-[#00E67A]">
                              ₦10,000
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {allTopUsersDisplay.length > 10 && (
              <button
                type="button"
                onClick={() => {
                  setAllListSearch('');
                  setShowAllUsersModal(true);
                }}
                className="w-full min-h-[44px] py-2.5 px-4 rounded-xl bg-[#0C1626] hover:bg-slate-900 border border-slate-700 text-xs font-extrabold text-[#2E9BFF] flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <span>See All Users ({allTopUsersDisplay.length})</span>
                <ChevronRight className="w-4 h-4" />
              </button>
            )}
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

        {/* BOTTOM OF ME TAB (AFTER SETTINGS): INVITE & EARN - REFERRAL */}
        <div className="bg-[#0C1626] border-2 border-[#00E67A]/40 rounded-2xl p-5 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Gift className="w-5 h-5 text-[#00E67A]" />
              <h3 className="text-base font-extrabold text-white">
                Invite &amp; Earn - Referral
              </h3>
            </div>
            <span className="px-2.5 py-1 rounded-lg bg-[#00E67A]/15 text-[#00E67A] text-[11px] font-extrabold">
              +₦1,000 + 200 Guard Score
            </span>
          </div>

          {!subInfo.isSubscriber && (
            <div className="p-3 rounded-xl bg-[#FFC400]/10 border border-[#FFC400]/40 text-xs font-bold text-[#FFC400]">
              Referral rewards only pay when YOU are subscribed.
            </div>
          )}

          {/* Code + Copy + KPI Stats */}
          <div className="grid grid-cols-3 gap-2">
            <div className="col-span-3 sm:col-span-1 p-3 rounded-xl bg-[#050B14] border border-slate-800 flex items-center justify-between gap-2">
              <div>
                <p className="text-[10px] text-slate-400 uppercase font-bold">Referral Code</p>
                <p className="text-base font-mono font-extrabold text-[#00E67A]">
                  {myReferralCode}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard?.writeText(myReferralCode).catch(() => {});
                  setCopiedRefCode(true);
                  window.setTimeout(() => setCopiedRefCode(false), 2000);
                }}
                className="px-2.5 py-1.5 rounded-lg bg-slate-800 text-white text-xs font-bold flex items-center gap-1 cursor-pointer"
              >
                <Copy className="w-3.5 h-3.5" />
                <span>{copiedRefCode ? 'Copied' : 'Copy'}</span>
              </button>
            </div>
            <div className="p-3 rounded-xl bg-[#050B14] border border-slate-800 text-center">
              <p className="text-lg font-mono font-extrabold text-white">{myReferrals.length}</p>
              <p className="text-[10px] text-slate-400">People Invited</p>
            </div>
            <div className="p-3 rounded-xl bg-[#050B14] border border-slate-800 text-center">
              <p className="text-lg font-mono font-extrabold text-[#00E67A]">
                ₦{totalReferralEarnings.toLocaleString()}
              </p>
              <p className="text-[10px] text-slate-400">Referral Earnings</p>
            </div>
          </div>

          {/* Referral Link with Copy / SMS / Share */}
          <div className="p-3 rounded-xl bg-[#050B14] border border-slate-800 space-y-2">
            <p className="text-[11px] font-bold text-slate-400">Your Referral Link</p>
            <p className="text-xs font-mono text-[#2E9BFF] break-all">{referralLink}</p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard?.writeText(referralLink).catch(() => {});
                  setCopiedRefLink(true);
                  window.setTimeout(() => setCopiedRefLink(false), 2000);
                }}
                className="px-3 py-1.5 rounded-lg bg-slate-800 text-white text-xs font-bold flex items-center gap-1 cursor-pointer"
              >
                <Copy className="w-3.5 h-3.5" />
                <span>{copiedRefLink ? 'Link Copied!' : 'Copy Link'}</span>
              </button>
              <a
                href={`sms:?body=${encodeURIComponent(whatsappInviteText)}`}
                className="px-3 py-1.5 rounded-lg bg-[#2E9BFF] text-white text-xs font-bold flex items-center gap-1"
              >
                <MessageSquare className="w-3.5 h-3.5" />
                <span>SMS</span>
              </a>
              <button
                type="button"
                onClick={() => {
                  if (navigator.share) {
                    void navigator.share({ title: 'Join Guard AI', text: whatsappInviteText }).catch(() => {});
                  } else {
                    navigator.clipboard?.writeText(whatsappInviteText).catch(() => {});
                  }
                }}
                className="px-3 py-1.5 rounded-lg bg-slate-800 text-slate-200 text-xs font-bold flex items-center gap-1 cursor-pointer"
              >
                <Share2 className="w-3.5 h-3.5" />
                <span>Share</span>
              </button>
            </div>
          </div>

          {/* Big Green Invite Friends on WhatsApp Button */}
          <a
            href={`https://wa.me/?text=${encodeURIComponent(whatsappInviteText)}`}
            target="_blank"
            rel="noreferrer"
            className="w-full min-h-[48px] py-3 px-4 rounded-xl bg-[#00E67A] hover:bg-[#00cf6d] text-slate-950 font-extrabold text-sm flex items-center justify-center gap-2 shadow-lg"
          >
            <Share2 className="w-4 h-4" />
            <span>Invite Friends on WhatsApp</span>
          </a>

          {/* How It Works */}
          <div className="p-3 rounded-xl bg-[#050B14] border border-slate-800 space-y-1 text-xs text-slate-300">
            <p className="font-extrabold text-white">How It Works</p>
            <p>1. Share your referral code ({myReferralCode}) or link with friends &amp; family.</p>
            <p>2. They sign up on Guard AI using your link or referral code.</p>
            <p>3. When they subscribe (₦5,000/mo or ₦35,000/yr) and you are subscribed, you earn ₦1,000 wallet credit + 200 Monthly Guard Score!</p>
          </div>

          {/* My Referrals List */}
          <div className="space-y-2">
            <p className="text-xs font-extrabold text-white">
              My Referrals ({myReferrals.length})
            </p>
            {myReferrals.length === 0 ? (
              <p className="text-xs text-slate-400">
                No invited users yet. Tap Invite Friends on WhatsApp to start earning.
              </p>
            ) : (
              <div className="space-y-1.5">
                {myReferrals.map((r) => (
                  <div
                    key={r.id}
                    className="p-2.5 rounded-xl bg-[#050B14] border border-slate-800 flex items-center justify-between gap-2 text-xs"
                  >
                    <div className="min-w-0">
                      <p className="font-bold text-white truncate">
                        {r.referredName || `User ${r.referredUid.slice(0, 6)}`}
                      </p>
                      <p className="text-[11px] text-slate-400">
                        {r.rewardPaid
                          ? `Reward Paid: ₦${Number(r.rewardAmount || 1000).toLocaleString()}`
                          : r.rewardNote || 'Awaiting friend subscription'}
                      </p>
                    </div>
                    <span
                      className={`px-2 py-0.5 rounded-md text-[10px] font-extrabold shrink-0 ${
                        r.status === 'Reward Paid'
                          ? 'bg-[#00E67A]/15 text-[#00E67A]'
                          : r.status === 'SUBSCRIBED'
                          ? 'bg-[#2E9BFF]/15 text-[#2E9BFF]'
                          : 'bg-[#FFC400]/15 text-[#FFC400]'
                      }`}
                    >
                      {r.status}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

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
                        <span className="w-8 text-xs font-mono font-extrabold text-[#FFC400] shrink-0">
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
    </div>
  );
};
