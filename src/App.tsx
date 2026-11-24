import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { onAuthStateChanged, User as FirebaseUser } from 'firebase/auth';
import {
  addDoc,
  collection,
  doc,
  getDoc,
  increment,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import {
  Home,
  Users,
  Crosshair,
  Bell,
  Building2,
  User as UserIcon,
  ShieldAlert,
} from 'lucide-react';
import { ADMIN_EMAILS, auth, db, handleFirestoreError, OperationType } from './firebase';
import {
  AppTab,
  HumanLocation,
  PlanType,
  ScannerSubTab,
  SubscriptionDoc,
  UserProfile,
} from './types';
import {
  computeLeaderboardPoints,
  detectMovementMode,
  getWatDateKey,
  getWatMonthKey,
  haversineMeters,
  isCoordsInRiversState,
  isTimestampTodayWat,
  reverseGeocodeHuman,
} from './utils/geoPhysics';
import {
  EMPTY_MONTHLY_BREAKDOWN,
  generateReferralCode,
  getEffectiveSubscription,
} from './utils/guardScore';
import { seedAllStarterGuardsToFirestore } from './data/starterGuardsSeed';
import { SplashAndAuth } from './components/SplashAndAuth';
import { PermissionGate } from './components/PermissionGate';
import { HomeTab } from './components/HomeTab';
import { FamilyTab } from './components/FamilyTab';
import { ScannerTab } from './components/ScannerTab';
import { AlertsTab } from './components/AlertsTab';
import { SafeBusinessTab } from './components/SafeBusinessTab';
import { MeTab } from './components/MeTab';
import { AdminTab } from './components/AdminTab';
import { ReportEarnModal } from './components/ReportEarnModal';
import { UserProfileModal } from './components/UserProfileModal';
import { TutorialOverlay } from './components/TutorialOverlay';
import {
  clearInMemoryUserProfileOnSignOut,
  getSavedTutorialStep,
  getTutorialSeenLocal,
  seedGlobalUserProfile,
  setTutorialSeenLocal,
  useGlobalUserProfile,
} from './utils/userProfileStore';

export default function App() {
  const [fbUser, setFbUser] = useState<FirebaseUser | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [userDocExists, setUserDocExists] = useState<boolean>(false);
  const [permissionsReady, setPermissionsReady] = useState<boolean>(false);
  const [checkingPermissions, setCheckingPermissions] = useState<boolean>(true);

  const [activeTab, setActiveTab] = useState<AppTab>('home');
  const [scannerSubTab, setScannerSubTab] = useState<ScannerSubTab>('road');
  const [darkMode, setDarkMode] = useState<boolean>(true);
  const [openSubSignal, setOpenSubSignal] = useState<number>(0);

  // Real GPS + Motion Sensor Location
  const [location, setLocation] = useState<HumanLocation | null>(null);
  const [gpsStatusMsg, setGpsStatusMsg] = useState<string | null>(null);
  const lastGeocodedPosRef = useRef<{ lat: number; lng: number; time: number } | null>(null);
  const accelSamplesRef = useRef<number[]>([]);
  const stationarySinceRef = useRef<number>(Date.now());
  const lastHeadingRef = useRef<number | null>(null);
  const migratedUidRef = useRef<string | null>(null);
  const refEnsuredUidRef = useRef<string | null>(null);
  const expiryCheckedUidRef = useRef<string | null>(null);

  // Real Scans Today (Road + Vehicle + Building combined) + Subscriptions + Usage Stats
  const [roadToday, setRoadToday] = useState(0);
  const [vehicleToday, setVehicleToday] = useState(0);
  const [buildingToday, setBuildingToday] = useState(0);
  const [subCollectionPlan, setSubCollectionPlan] = useState<PlanType>('Free');
  const [usageStatDocId, setUsageStatDocId] = useState<string | null>(null);
  const [currentStats, setCurrentStats] = useState({
    verifiedReports: 0,
    totalScans: 0,
    totalUsageDays: 1,
    totalUsageMinutes: 0,
  });

  // Modals & First-Time Tutorial State
  const [reportModalOpen, setReportModalOpen] = useState(false);
  const [profileModalUid, setProfileModalUid] = useState<string | null>(null);
  const [openSosSignal, setOpenSosSignal] = useState<number>(0);
  const [openProfileSectionSignal, setOpenProfileSectionSignal] = useState<number>(0);
  const [openSettingsSectionSignal, setOpenSettingsSectionSignal] = useState<number>(0);
  const [tutorialOpen, setTutorialOpen] = useState<boolean>(false);
  const [tutorialStep, setTutorialStep] = useState<number>(() => getSavedTutorialStep());
  const tutorialEvaluatedUidRef = useRef<string | null>(null);

  const primaryPhoto = userProfile?.profilePicUrl || userProfile?.photoURL || '';
  const globalProfile = useGlobalUserProfile(userProfile?.fullName, primaryPhoto);

  // Dark Mode class toggle
  useEffect(() => {
    const root = document.documentElement;
    if (darkMode) root.classList.add('dark');
    else root.classList.remove('dark');
  }, [darkMode]);

  // Capture referral code early if opened directly while signed out or signing in
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const urlRef = (params.get('ref') || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (urlRef) {
        window.sessionStorage.setItem('guard_pending_ref', urlRef);
      }
    } catch {
      // ignore
    }
  }, []);

  // Auth listener
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setFbUser(u);
      setAuthReady(true);
      if (!u) {
        setUserProfile(null);
        setPermissionsReady(false);
        setTutorialOpen(false);
        setLocation(null);
        tutorialEvaluatedUidRef.current = null;
        migratedUidRef.current = null;
        refEnsuredUidRef.current = null;
        expiryCheckedUidRef.current = null;
        clearInMemoryUserProfileOnSignOut();
      }
    });
    return () => unsub();
  }, []);

  // Check real device permissions whenever signed in
  useEffect(() => {
    if (!fbUser) {
      setCheckingPermissions(false);
      return;
    }
    let mounted = true;
    const verifyPerms = async () => {
      setCheckingPermissions(true);
      const sessionBypass = (() => {
        try {
          return window.sessionStorage.getItem('guard_perm_completed') === '1';
        } catch {
          return false;
        }
      })();

      if (!navigator.permissions) {
        if (mounted) {
          setPermissionsReady(sessionBypass);
          setCheckingPermissions(false);
        }
        return;
      }
      try {
        const [g, m] = await Promise.all([
          navigator.permissions.query({ name: 'geolocation' as PermissionName }),
          navigator.permissions.query({ name: 'microphone' as PermissionName }),
        ]);
        if (mounted) {
          setPermissionsReady((g.state === 'granted' && m.state === 'granted') || (m.state === 'granted' && sessionBypass));
          setCheckingPermissions(false);
        }
      } catch {
        if (mounted) {
          setPermissionsReady(sessionBypass);
          setCheckingPermissions(false);
        }
      }
    };
    verifyPerms();
    return () => {
      mounted = false;
    };
  }, [fbUser]);

  // Listen to users/{uid} & drive global avatar STRICTLY from Firestore profilePicUrl || photoURL
  useEffect(() => {
    if (!fbUser) {
      setUserDocExists(false);
      return;
    }
    const unsub = onSnapshot(
      doc(db, 'users', fbUser.uid),
      (snap) => {
        if (snap.exists()) {
          const data = snap.data() as UserProfile;
          setUserDocExists(true);
          setUserProfile(data);
          seedGlobalUserProfile(data.fullName, data.profilePicUrl || data.photoURL || '');
        } else {
          setUserDocExists(false);
          const fallbackName = fbUser.displayName || 'Guard AI Member';
          const fallbackPhoto = fbUser.photoURL || '';
          seedGlobalUserProfile(fallbackName, fallbackPhoto);
          setUserProfile({
            uid: fbUser.uid,
            fullName: fallbackName,
            email: fbUser.email || '',
            photoURL: fallbackPhoto,
            profilePicUrl: fallbackPhoto,
            role: ADMIN_EMAILS.includes((fbUser.email || '').toLowerCase()) ? 'admin' : 'user',
            safetyScore: 100,
            trust_score: 100,
            streak: 1,
            walletBalance: 0,
            availableBalanceNaira: 0,
            totalEarnedNaira: 0,
            guardScore: 0,
          });
        }
      },
      (err) => handleFirestoreError(err, OperationType.GET, `users/${fbUser.uid}`)
    );
    return () => unsub();
  }, [fbUser]);

  // One-time Migration: Fix Lagos-in-Rivers mismatch (e.g. Amscream in Port Harcourt showing as Lagos)
  useEffect(() => {
    if (!fbUser || !userDocExists || !userProfile) return;
    if (userProfile.locationMigrated || migratedUidRef.current === fbUser.uid) return;

    const currentCity = (userProfile.city || '').trim().toLowerCase();
    const currentState = (userProfile.state || userProfile.userState || '').trim().toLowerCase();
    const hasLagosBug = currentCity === 'lagos' || currentState === 'lagos';

    const checkLat = location?.lat ?? userProfile.lastLat;
    const checkLng = location?.lng ?? userProfile.lastLng;
    const coordsInRivers =
      typeof checkLat === 'number' &&
      typeof checkLng === 'number' &&
      isCoordsInRiversState(checkLat, checkLng);

    if (hasLagosBug && coordsInRivers) {
      migratedUidRef.current = fbUser.uid;
      const month = getWatMonthKey();
      const statId = `${fbUser.uid}_${month}`;

      updateDoc(doc(db, 'users', fbUser.uid), {
        city: 'Port Harcourt',
        state: 'Rivers',
        userState: 'Rivers',
        locationSource: 'gps',
        locationMigrated: true,
        locationUpdatedAt: serverTimestamp(),
      }).catch(() => {});

      updateDoc(doc(db, 'public_profiles', fbUser.uid), {
        city: 'Port Harcourt',
        state: 'Rivers',
        userState: 'Rivers',
      }).catch(() => {});

      setDoc(
        doc(db, 'me_profiles', fbUser.uid),
        {
          userId: fbUser.uid,
          city: 'Port Harcourt',
          state: 'Rivers',
          userState: 'Rivers',
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      ).catch(() => {});

      updateDoc(doc(db, 'user_usage_stats', statId), {
        city: 'Port Harcourt',
        state: 'Rivers',
      }).catch(() => {});
    }
  }, [fbUser, userDocExists, userProfile, location?.lat, location?.lng]);

  // Ensure every existing user has a persistent referralCode & check subscription expiry mid-month
  useEffect(() => {
    if (!fbUser || !userDocExists || !userProfile) return;

    if (!userProfile.referralCode && refEnsuredUidRef.current !== fbUser.uid) {
      refEnsuredUidRef.current = fbUser.uid;
      const code = generateReferralCode(userProfile.fullName, fbUser.uid);
      updateDoc(doc(db, 'users', fbUser.uid), { referralCode: code }).catch(() => {});
      setDoc(
        doc(db, 'referral_codes', code),
        {
          ownerUid: fbUser.uid,
          code,
          createdAt: serverTimestamp(),
        },
        { merge: true }
      ).catch(() => {});
    }

    if (expiryCheckedUidRef.current !== fbUser.uid) {
      const sub = getEffectiveSubscription(userProfile);
      if (sub.isExpired && (userProfile.subscription === 'active' || userProfile.subscriptionStatus === 'active')) {
        expiryCheckedUidRef.current = fbUser.uid;
        updateDoc(doc(db, 'users', fbUser.uid), {
          subscription: 'expired',
          subscriptionStatus: 'expired',
        }).catch(() => {});

        const statId = `${fbUser.uid}_${getWatMonthKey()}`;
        updateDoc(doc(db, 'user_usage_stats', statId), {
          subscriptionStatus: 'expired',
        }).catch(() => {});
      }
    }
  }, [fbUser, userDocExists, userProfile]);

  // Auto-open First-Time Tutorial once after Sign Up / Sign In if not seen yet
  useEffect(() => {
    if (!fbUser || !userDocExists || !permissionsReady || !userProfile) return;
    if (tutorialEvaluatedUidRef.current === fbUser.uid) return;
    tutorialEvaluatedUidRef.current = fbUser.uid;

    const alreadySeen = userProfile.tutorialSeen === true || getTutorialSeenLocal();
    if (!alreadySeen) {
      setTutorialStep(getSavedTutorialStep());
      setTutorialOpen(true);
    }
  }, [fbUser, userDocExists, permissionsReady, userProfile]);

  // Ensure monthly user_usage_stats doc & update daily streak
  useEffect(() => {
    if (!fbUser || !userProfile || !userDocExists) return;
    const month = getWatMonthKey();
    const todayKey = getWatDateKey();
    const statId = `${fbUser.uid}_${month}`;
    setUsageStatDocId(statId);

    const ref = doc(db, 'user_usage_stats', statId);
    const effectivePic = userProfile.profilePicUrl || userProfile.photoURL || '';
    const sub = getEffectiveSubscription(userProfile);

    const authProvider = fbUser.providerData?.some((p) => p.providerId === 'google.com')
      ? 'gmail'
      : 'email';

    getDoc(ref)
      .then(async (snap) => {
        if (!snap.exists()) {
          await setDoc(ref, {
            userId: fbUser.uid,
            name: userProfile.fullName,
            avatar: effectivePic,
            profilePicUrl: effectivePic,
            city: userProfile.city || '',
            state: userProfile.state || userProfile.userState || '',
            subscriptionPlan: 'FREE',
            subscriptionStatus: 'free',
            totalScans: 0,
            totalReports: 0,
            verifiedReports: 0,
            totalUsageDays: 1,
            lastActiveDate: todayKey,
            totalUsageMinutes: 0,
            totalPoints: 20,
            guardScore: 0,
            monthlyBreakdown: EMPTY_MONTHLY_BREAKDOWN,
            scoreHistory: [],
            month,
            cheatingFlagged: false,
            isStarter: false,
            isRealUser: true,
            authProvider,
            lastActive: serverTimestamp(),
            lastActiveAt: serverTimestamp(),
          });
        } else {
          const data = snap.data();
          const patch: Record<string, unknown> = {};
          if (effectivePic && data.profilePicUrl !== effectivePic) {
            patch.avatar = effectivePic;
            patch.profilePicUrl = effectivePic;
          }
          if (userProfile.city && !data.city) {
            patch.city = userProfile.city;
          }
          if ((userProfile.state || userProfile.userState) && !data.state) {
            patch.state = userProfile.state || userProfile.userState;
          }
          if (data.lastActiveDate !== todayKey) {
            const nextDays = (data.totalUsageDays || 1) + 1;
            const nextPts = computeLeaderboardPoints({
              verifiedReports: data.verifiedReports || 0,
              totalScans: data.totalScans || 0,
              totalUsageDays: nextDays,
              totalUsageMinutes: data.totalUsageMinutes || 0,
            });
            patch.totalUsageDays = nextDays;
            patch.lastActiveDate = todayKey;
            patch.totalPoints = nextPts;
            patch.lastActive = serverTimestamp();
            patch.lastActiveAt = serverTimestamp();
          }
          if (Object.keys(patch).length > 0) {
            await updateDoc(ref, patch);
          }
          // Self-downgrade expired stat doc if needed
          if (sub.isExpired && data.subscriptionStatus === 'active' && data.subscriptionExpiresAt) {
            updateDoc(ref, { subscriptionStatus: 'expired' }).catch(() => {});
          }
        }
      })
      .catch(() => {});

    // Daily streak check on users/{uid}
    if (userProfile.lastStreakDate !== todayKey) {
      updateDoc(doc(db, 'users', fbUser.uid), {
        streak: increment(1),
        lastStreakDate: todayKey,
        lastActive: serverTimestamp(),
        lastActiveAt: serverTimestamp(),
      }).catch(() => {});
    }

    const unsubStat = onSnapshot(
      ref,
      (snap) => {
        if (snap.exists()) {
          const d = snap.data();
          setCurrentStats({
            verifiedReports: Number(d.verifiedReports || 0),
            totalScans: Number(d.totalScans || 0),
            totalUsageDays: Number(d.totalUsageDays || 1),
            totalUsageMinutes: Number(d.totalUsageMinutes || 0),
          });
        }
      },
      () => {}
    );
    return () => unsubStat();
  }, [fbUser, userProfile?.uid, userDocExists]);

  // Listen to active subscription plan & scans today (Road + Vehicle + Building)
  useEffect(() => {
    if (!fbUser) return;
    const uSub = onSnapshot(
      query(collection(db, 'subscriptions'), where('userId', '==', fbUser.uid)),
      (snap) => {
        const now = Date.now();
        const activeDocs = snap.docs
          .map((d) => ({ id: d.id, ...(d.data() as Omit<SubscriptionDoc, 'id'>) }))
          .filter((s) => {
            if (s.status !== 'active') return false;
            const exp = s.expiresAt?.toMillis ? s.expiresAt.toMillis() : 0;
            return !exp || exp > now;
          });
        if (activeDocs.some((s) => s.plan === 'Yearly' || s.plan === 'YEARLY_35000')) {
          setSubCollectionPlan('Yearly');
        } else if (activeDocs.some((s) => s.plan === 'Monthly' || s.plan === 'MONTHLY_5000')) {
          setSubCollectionPlan('Monthly');
        } else {
          setSubCollectionPlan('Free');
        }
      }
    );
    const uRoad = onSnapshot(
      query(collection(db, 'road_scanner'), where('userId', '==', fbUser.uid)),
      (snap) => setRoadToday(snap.docs.filter((d) => isTimestampTodayWat(d.data().createdAt)).length)
    );
    const uVeh = onSnapshot(
      query(collection(db, 'vehicle_scanner'), where('userId', '==', fbUser.uid)),
      (snap) => setVehicleToday(snap.docs.filter((d) => isTimestampTodayWat(d.data().createdAt)).length)
    );
    const uBld = onSnapshot(
      query(collection(db, 'building_scanner'), where('userId', '==', fbUser.uid)),
      (snap) => setBuildingToday(snap.docs.filter((d) => isTimestampTodayWat(d.data().createdAt)).length)
    );
    return () => {
      uSub();
      uRoad();
      uVeh();
      uBld();
    };
  }, [fbUser]);

  // Effective Active Plan derived primarily from userProfile.subscriptionPlan/Status & expiry
  const activePlan: PlanType = useMemo(() => {
    if (userProfile) {
      const sub = getEffectiveSubscription(userProfile);
      if (sub.isSubscriber) return sub.legacyPlan;
      if (sub.isExpired) return 'Free';
    }
    return subCollectionPlan;
  }, [userProfile, subCollectionPlan]);

  // DeviceMotion variance collector for Walking / In Vehicle / In Building
  useEffect(() => {
    const onMotion = (ev: DeviceMotionEvent) => {
      const a = ev.accelerationIncludingGravity;
      if (!a) return;
      const mag = Math.sqrt((a.x || 0) ** 2 + (a.y || 0) ** 2 + (a.z || 0) ** 2);
      accelSamplesRef.current.push(Math.abs(mag - 9.81));
      if (accelSamplesRef.current.length > 30) accelSamplesRef.current.shift();
    };
    window.addEventListener('devicemotion', onMotion);
    return () => window.removeEventListener('devicemotion', onMotion);
  }, []);

  const updateHumanLocationFromCoords = useCallback(
    async (
      lat: number,
      lng: number,
      accuracy: number,
      speedMps = 0,
      heading: number | null = null,
      forceGeocode = false
    ) => {
      if (speedMps > 0.5) stationarySinceRef.current = Date.now();
      const samples = accelSamplesRef.current;
      const mean = samples.length > 0 ? samples.reduce((a, b) => a + b, 0) / samples.length : 0;
      const variance =
        samples.length > 0
          ? samples.reduce((acc, v) => acc + (v - mean) ** 2, 0) / samples.length
          : 0;
      const headingStable =
        heading !== null &&
        lastHeadingRef.current !== null &&
        Math.abs(heading - lastHeadingRef.current) < 25;
      lastHeadingRef.current = heading;

      const movementMode = detectMovementMode({
        speedMps,
        accelVariance: variance,
        accuracyMeters: accuracy,
        stationaryMs: Date.now() - stationarySinceRef.current,
        headingStable,
      });

      const coordLabel = `Lat: ${lat.toFixed(5)}, Lng: ${lng.toFixed(5)}`;

      setLocation((prev) => ({
        lat,
        lng,
        accuracy: Math.round(accuracy),
        formattedAddress: prev?.formattedAddress || coordLabel,
        streetName: prev?.streetName || coordLabel,
        area: prev?.area || '',
        city: prev?.city || '',
        state: prev?.state || '',
        landmark: prev?.landmark || '',
        heading,
        speedMps,
        movementMode,
      }));

      const lastGeo = lastGeocodedPosRef.current;
      const shouldGeocode =
        forceGeocode ||
        !lastGeo ||
        Date.now() - lastGeo.time > 20000 ||
        haversineMeters(lastGeo.lat, lastGeo.lng, lat, lng) > 40;

      if (shouldGeocode) {
        lastGeocodedPosRef.current = { lat, lng, time: Date.now() };
        const human = await reverseGeocodeHuman(lat, lng);
        setLocation((prev) => ({
          lat,
          lng,
          accuracy: Math.round(accuracy),
          formattedAddress: human.formattedAddress,
          streetName: human.streetName,
          area: human.area,
          city: human.city,
          state: human.state,
          landmark: human.landmark,
          heading: prev?.heading ?? heading,
          speedMps: prev?.speedMps ?? speedMps,
          movementMode: prev?.movementMode ?? movementMode,
        }));

        // Sync GPS coordinates + city/state to Firestore ONLY if not manually overridden (or when forced via Set/Update Location button)
        if (fbUser && userDocExists) {
          const shouldOverwriteCity =
            forceGeocode ||
            !userProfile?.city ||
            userProfile?.locationSource === 'gps' ||
            (isCoordsInRiversState(lat, lng) && (userProfile?.city || '').toLowerCase() === 'lagos');

          const patch: Record<string, unknown> = {
            lastLat: lat,
            lastLng: lng,
          };
          if (shouldOverwriteCity && (human.city || human.state)) {
            patch.city = human.city;
            patch.state = human.state;
            patch.userState = human.state;
            patch.locationSource = 'gps';
            patch.locationUpdatedAt = serverTimestamp();

            updateDoc(doc(db, 'public_profiles', fbUser.uid), {
              city: human.city,
              state: human.state,
              userState: human.state,
            }).catch(() => {});

            const statId = `${fbUser.uid}_${getWatMonthKey()}`;
            updateDoc(doc(db, 'user_usage_stats', statId), {
              city: human.city,
              state: human.state,
            }).catch(() => {});
          }
          updateDoc(doc(db, 'users', fbUser.uid), patch).catch(() => {});
        }
      }
    },
    [fbUser, userDocExists, userProfile?.city, userProfile?.locationSource]
  );

  // Explicit "Set My Location" / "Update Location" action (GPS ONLY — never IP, never guesses Lagos)
  const handleSetMyLocation = useCallback(async (): Promise<boolean> => {
    if (!navigator.geolocation) {
      setGpsStatusMsg('GPS is not supported by this browser.');
      return false;
    }
    setGpsStatusMsg('Getting live GPS coordinates...');
    return new Promise<boolean>((resolve) => {
      const onSuccess = async (pos: GeolocationPosition) => {
        await updateHumanLocationFromCoords(
          pos.coords.latitude,
          pos.coords.longitude,
          pos.coords.accuracy,
          pos.coords.speed || 0,
          pos.coords.heading,
          true
        );
        setGpsStatusMsg('Location updated from GPS!');
        window.setTimeout(() => setGpsStatusMsg(null), 3000);
        resolve(true);
      };

      navigator.geolocation.getCurrentPosition(
        onSuccess,
        () => {
          navigator.geolocation.getCurrentPosition(
            onSuccess,
            () => {
              setGpsStatusMsg('Location Not Set — Please enable GPS in browser settings and try again.');
              window.setTimeout(() => setGpsStatusMsg(null), 4000);
              resolve(false);
            },
            { enableHighAccuracy: false, maximumAge: 0, timeout: 8000 }
          );
        },
        { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 }
      );
    });
  }, [updateHumanLocationFromCoords]);

  // Real GPS getCurrentPosition + watchPosition once permissionsReady
  useEffect(() => {
    if (!permissionsReady || !navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        updateHumanLocationFromCoords(
          pos.coords.latitude,
          pos.coords.longitude,
          pos.coords.accuracy,
          pos.coords.speed || 0,
          pos.coords.heading,
          true
        );
      },
      () => {
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            updateHumanLocationFromCoords(
              pos.coords.latitude,
              pos.coords.longitude,
              pos.coords.accuracy,
              pos.coords.speed || 0,
              pos.coords.heading,
              true
            );
          },
          () => {},
          { enableHighAccuracy: false, maximumAge: 30000, timeout: 8000 }
        );
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 }
    );
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        updateHumanLocationFromCoords(
          pos.coords.latitude,
          pos.coords.longitude,
          pos.coords.accuracy,
          pos.coords.speed || 0,
          pos.coords.heading
        );
      },
      () => {},
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, [permissionsReady, updateHumanLocationFromCoords]);

  // 10-second guard_users_live sync
  useEffect(() => {
    if (!fbUser || !location) return;
    const syncLive = () => {
      setDoc(
        doc(db, 'guard_users_live', fbUser.uid),
        {
          userId: fbUser.uid,
          lat: location.lat,
          lng: location.lng,
          accuracy: location.accuracy,
          address: location.formattedAddress,
          locationEnabled: true,
          micEnabled: permissionsReady,
          isOnline: true,
          lastUpdated: serverTimestamp(),
        },
        { merge: true }
      ).catch(() => {});
    };
    syncLive();
    const id = window.setInterval(syncLive, 10000);
    return () => clearInterval(id);
  }, [fbUser, location, permissionsReady]);

  // Real 5-minute usage tracker + screen time analytics
  useEffect(() => {
    if (!fbUser || !usageStatDocId) return;
    const id = window.setInterval(async () => {
      try {
        const nextMins = currentStats.totalUsageMinutes + 5;
        const nextPts = computeLeaderboardPoints({
          verifiedReports: currentStats.verifiedReports,
          totalScans: currentStats.totalScans,
          totalUsageDays: currentStats.totalUsageDays,
          totalUsageMinutes: nextMins,
        });
        await updateDoc(doc(db, 'user_usage_stats', usageStatDocId), {
          totalUsageMinutes: increment(5),
          totalPoints: nextPts,
          lastActive: serverTimestamp(),
          lastActiveAt: serverTimestamp(),
        });
        await updateDoc(doc(db, 'users', fbUser.uid), {
          lastActive: serverTimestamp(),
          lastActiveAt: serverTimestamp(),
        }).catch(() => {});
        await addDoc(collection(db, 'user_sessions'), {
          userId: fbUser.uid,
          durationMinutes: 5,
          startedAt: serverTimestamp(),
        });
        await addDoc(collection(db, 'screen_time'), {
          userId: fbUser.uid,
          screen: activeTab,
          seconds: 300,
          updatedAt: serverTimestamp(),
        });
      } catch {
        // non-blocking telemetry
      }
    }, 5 * 60 * 1000);
    return () => clearInterval(id);
  }, [fbUser, usageStatDocId, activeTab, currentStats]);

  const isAdmin = useMemo(() => {
    if (!userProfile && !fbUser) return false;
    const email = (userProfile?.email || fbUser?.email || '').toLowerCase();
    return userProfile?.role === 'admin' || ADMIN_EMAILS.includes(email);
  }, [userProfile, fbUser]);

  // First-time Starter Guards initialization when Admin signs in (only if not previously removed)
  const starterInitCheckedRef = useRef<boolean>(false);
  useEffect(() => {
    if (!isAdmin || !fbUser || starterInitCheckedRef.current) return;
    starterInitCheckedRef.current = true;
    getDoc(doc(db, 'app_settings', 'starter_guards'))
      .then((snap) => {
        if (!snap.exists()) {
          void seedAllStarterGuardsToFirestore().catch(() => {});
        }
      })
      .catch(() => {});
  }, [isAdmin, fbUser]);

  const markTutorialSeen = useCallback(
    (targetTab: AppTab = 'home', openHelp = false) => {
      setTutorialOpen(false);
      setTutorialSeenLocal(true);
      setActiveTab(targetTab);
      if (openHelp) {
        setOpenSettingsSectionSignal((n) => n + 1);
      }
      if (fbUser) {
        updateDoc(doc(db, 'users', fbUser.uid), {
          tutorialSeen: true,
        }).catch(() => {});
      }
    },
    [fbUser]
  );

  const handleReplayTutorial = useCallback(() => {
    setTutorialSeenLocal(false);
    setTutorialStep(0);
    setActiveTab('home');
    setTutorialOpen(true);
    if (fbUser) {
      updateDoc(doc(db, 'users', fbUser.uid), {
        tutorialSeen: false,
      }).catch(() => {});
    }
  }, [fbUser]);

  const handleInterruptTutorialForSos = useCallback(() => {
    setTutorialOpen(false);
    setActiveTab('home');
    setOpenSosSignal((n) => n + 1);
  }, []);

  const handleEnsureMeProfileSection = useCallback(() => {
    setOpenProfileSectionSignal((n) => n + 1);
  }, []);

  const scansToday = roadToday + vehicleToday + buildingToday;

  // Loading auth
  if (!authReady || checkingPermissions) {
    return (
      <div className="min-h-screen bg-[#050B14] flex items-center justify-center text-sm text-slate-400">
        Connecting Guard AI...
      </div>
    );
  }

  // Signed Out -> Splash + Auth
  if (!fbUser || !userProfile) {
    return <SplashAndAuth onAuthenticated={() => {}} />;
  }

  // Signed In but Permissions Not Granted -> Real 3-Step Permission Gate
  if (!permissionsReady) {
    return (
      <PermissionGate
        uid={fbUser.uid}
        onComplete={(init) => {
          if (init) {
            setLocation({
              lat: init.lat,
              lng: init.lng,
              accuracy: init.accuracy,
              formattedAddress: init.address,
              streetName: init.streetName,
              area: init.area,
              city: init.city,
              state: init.state,
              landmark: init.landmark,
              heading: null,
              speedMps: 0,
              movementMode: 'Walking',
            });
          } else {
            setLocation(null);
          }
          setPermissionsReady(true);
        }}
      />
    );
  }

  const navItems: { id: AppTab; label: string; icon: React.ComponentType<any> }[] = [
    { id: 'home', label: 'Home', icon: Home },
    { id: 'family', label: 'Family', icon: Users },
    { id: 'weapon', label: 'Weapon', icon: Crosshair },
    { id: 'alerts', label: 'Alerts', icon: Bell },
    { id: 'safe_business', label: 'Safe Haven', icon: Building2 },
    { id: 'me', label: 'Me', icon: UserIcon },
    ...(isAdmin ? [{ id: 'admin' as AppTab, label: 'Admin', icon: ShieldAlert }] : []),
  ];

  return (
    <div className="min-h-screen h-screen flex flex-col bg-[#050B14] text-slate-100">
      <main className="flex-1 overflow-y-auto">
        {gpsStatusMsg && (
          <div className="max-w-2xl mx-auto px-4 pt-3">
            <div className="px-3 py-2 rounded-xl bg-[#2E9BFF]/15 border border-[#2E9BFF]/40 text-xs font-semibold text-[#2E9BFF]">
              {gpsStatusMsg}
            </div>
          </div>
        )}

        {activeTab === 'home' && (
          <HomeTab
            user={userProfile}
            location={location}
            scansToday={scansToday}
            activePlan={activePlan}
            usageStatDocId={usageStatDocId}
            onRefreshLocation={(lat, lng, acc) =>
              updateHumanLocationFromCoords(lat, lng, acc, 0, null, true)
            }
            onSetMyLocation={handleSetMyLocation}
            onNavigateScanner={(sub) => {
              setScannerSubTab(sub);
              setActiveTab('weapon');
            }}
            onOpenSubscriptions={() => {
              setOpenSubSignal((n) => n + 1);
              setActiveTab('me');
            }}
            onOpenReportModal={() => setReportModalOpen(true)}
            onOpenProfile={(uid) => setProfileModalUid(uid)}
            openSosSignal={openSosSignal}
          />
        )}

        {activeTab === 'family' && (
          <FamilyTab
            user={userProfile}
            location={location}
            activePlan={activePlan}
            onRefreshLocation={(lat, lng, acc) =>
              updateHumanLocationFromCoords(lat, lng, acc, 0, null, true)
            }
            onOpenReportModal={() => setReportModalOpen(true)}
            onOpenSubscriptions={() => {
              setOpenSubSignal((n) => n + 1);
              setActiveTab('me');
            }}
          />
        )}

        {activeTab === 'weapon' && (
          <ScannerTab
            user={userProfile}
            location={location}
            subTab={scannerSubTab}
            onChangeSubTab={setScannerSubTab}
            scansToday={scansToday}
            activePlan={activePlan}
            usageStatDocId={usageStatDocId}
            currentStats={currentStats}
            onRefreshLocation={(lat, lng, acc) =>
              updateHumanLocationFromCoords(lat, lng, acc, 0, null, true)
            }
            onOpenReportModal={() => setReportModalOpen(true)}
            onOpenSubscriptions={() => {
              setOpenSubSignal((n) => n + 1);
              setActiveTab('me');
            }}
          />
        )}

        {activeTab === 'alerts' && (
          <AlertsTab
            user={userProfile}
            location={location}
            onRefreshLocation={(lat, lng, acc) =>
              updateHumanLocationFromCoords(lat, lng, acc, 0, null, true)
            }
            onOpenReportModal={() => setReportModalOpen(true)}
          />
        )}

        {activeTab === 'safe_business' && (
          <SafeBusinessTab
            user={userProfile}
            location={location}
            onRefreshLocation={(lat, lng, acc) =>
              updateHumanLocationFromCoords(lat, lng, acc, 0, null, true)
            }
            onOpenReportModal={() => setReportModalOpen(true)}
          />
        )}

        {activeTab === 'me' && (
          <MeTab
            user={userProfile}
            location={location}
            scansToday={scansToday}
            activePlan={activePlan}
            usageStatDocId={usageStatDocId}
            darkMode={darkMode}
            onToggleDarkMode={() => setDarkMode((d) => !d)}
            onSetMyLocation={handleSetMyLocation}
            onOpenReportModal={() => setReportModalOpen(true)}
            onOpenProfile={(uid) => setProfileModalUid(uid)}
            onReplayTutorial={handleReplayTutorial}
            openSubSectionSignal={openSubSignal}
            openProfileSectionSignal={openProfileSectionSignal}
            openSettingsSectionSignal={openSettingsSectionSignal}
          />
        )}

        {activeTab === 'admin' && isAdmin && <AdminTab adminUser={userProfile} />}
      </main>

      {/* Bottom Navigation Bar (6 tabs + 7th Admin tab only for Admin) */}
      <nav
        aria-label="Primary Navigation"
        className="shrink-0 bg-[#08101D] border-t border-slate-800 px-1 py-1.5"
      >
        <div className="max-w-2xl mx-auto flex items-center justify-around">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                data-tutorial-target={`nav-${item.id}`}
                onClick={() => setActiveTab(item.id)}
                className={`flex flex-col items-center justify-center py-1 px-2 rounded-xl min-w-[48px] transition-colors cursor-pointer ${
                  active
                    ? item.id === 'admin'
                      ? 'text-[#FF2D55]'
                      : 'text-[#00E67A]'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Icon className="w-5 h-5" />
                <span className="text-[10px] font-bold mt-0.5">{item.label}</span>
              </button>
            );
          })}
        </div>
      </nav>

      {/* First-Time Spotlight Tutorial Overlay (Never blocks SOS) */}
      <TutorialOverlay
        open={tutorialOpen}
        stepIndex={tutorialStep}
        userName={globalProfile.name || userProfile.fullName}
        userPhotoURL={globalProfile.photo || primaryPhoto}
        onChangeStep={setTutorialStep}
        onSwitchTab={setActiveTab}
        onEnsureMeProfileSection={handleEnsureMeProfileSection}
        onOpenMeHelp={() => markTutorialSeen('me', true)}
        onComplete={() => markTutorialSeen('home', false)}
        onSkip={() => markTutorialSeen('home', false)}
        onInterruptForSos={handleInterruptTutorialForSos}
      />

      {/* Global Report & Earn ₦5,000 Modal */}
      <ReportEarnModal
        open={reportModalOpen}
        onClose={() => setReportModalOpen(false)}
        user={userProfile}
        location={location}
        usageStatDocId={usageStatDocId}
        onOpenSubscriptions={() => {
          setReportModalOpen(false);
          setOpenSubSignal((n) => n + 1);
          setActiveTab('me');
        }}
      />

      {/* Global User Public Profile & Chat Modal */}
      <UserProfileModal
        targetUserId={profileModalUid}
        currentUid={userProfile.uid}
        currentUserName={globalProfile.name || userProfile.fullName}
        onClose={() => setProfileModalUid(null)}
      />
    </div>
  );
}
