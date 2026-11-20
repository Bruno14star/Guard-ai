import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { APIProvider } from '@vis.gl/react-google-maps';
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
  X,
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
  isTimestampTodayWat,
  reverseGeocodeHuman,
} from './utils/geoPhysics';
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

  // Maps API key + Case A Quota Banner
  const [mapsApiKey, setMapsApiKey] = useState<string>(
    import.meta.env.VITE_GOOGLE_MAPS_API_KEY || ''
  );
  const [quotaBannerVisible, setQuotaBannerVisible] = useState(false);

  // Real GPS + Motion Sensor Location
  const [location, setLocation] = useState<HumanLocation | null>(null);
  const lastGeocodedPosRef = useRef<{ lat: number; lng: number; time: number } | null>(null);
  const accelSamplesRef = useRef<number[]>([]);
  const stationarySinceRef = useRef<number>(Date.now());
  const lastHeadingRef = useRef<number | null>(null);

  // Real Scans Today (Road + Vehicle + Building combined) + Subscriptions + Usage Stats
  const [roadToday, setRoadToday] = useState(0);
  const [vehicleToday, setVehicleToday] = useState(0);
  const [buildingToday, setBuildingToday] = useState(0);
  const [activePlan, setActivePlan] = useState<PlanType>('Free');
  const [usageStatDocId, setUsageStatDocId] = useState<string | null>(null);
  const [currentStats, setCurrentStats] = useState({
    verifiedReports: 0,
    totalScans: 0,
    totalUsageDays: 1,
    totalUsageMinutes: 0,
  });

  // Modals
  const [reportModalOpen, setReportModalOpen] = useState(false);
  const [profileModalUid, setProfileModalUid] = useState<string | null>(null);

  // Dark Mode class toggle
  useEffect(() => {
    const root = document.documentElement;
    if (darkMode) root.classList.add('dark');
    else root.classList.remove('dark');
  }, [darkMode]);

  // Fetch /api/maps-config so runtime key from server works in dev & production
  useEffect(() => {
    fetch('/api/maps-config')
      .then((r) => {
        const ct = r.headers.get('content-type') || '';
        return r.ok && ct.includes('application/json') ? r.json() : null;
      })
      .then((d) => {
        if (d?.apiKey) setMapsApiKey(String(d.apiKey));
      })
      .catch(() => {});

    const onQuota = () => setQuotaBannerVisible(true);
    window.addEventListener('gmp-quota-exceeded', onQuota);
    return () => window.removeEventListener('gmp-quota-exceeded', onQuota);
  }, []);

  // Auth listener
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setFbUser(u);
      setAuthReady(true);
      if (!u) {
        setUserProfile(null);
        setPermissionsReady(false);
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
      if (!navigator.permissions) {
        if (mounted) {
          setPermissionsReady(false);
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
          setPermissionsReady(g.state === 'granted' && m.state === 'granted');
          setCheckingPermissions(false);
        }
      } catch {
        if (mounted) {
          setPermissionsReady(false);
          setCheckingPermissions(false);
        }
      }
    };
    verifyPerms();
    return () => {
      mounted = false;
    };
  }, [fbUser]);

  // Listen to users/{uid}
  useEffect(() => {
    if (!fbUser) {
      setUserDocExists(false);
      return;
    }
    const unsub = onSnapshot(
      doc(db, 'users', fbUser.uid),
      (snap) => {
        if (snap.exists()) {
          setUserDocExists(true);
          setUserProfile(snap.data() as UserProfile);
        } else {
          setUserDocExists(false);
          // Minimal transient profile while SplashAndAuth provisions Firestore doc
          setUserProfile({
            uid: fbUser.uid,
            fullName: fbUser.displayName || 'Guard AI Member',
            email: fbUser.email || '',
            photoURL: fbUser.photoURL || '',
            role: ADMIN_EMAILS.includes((fbUser.email || '').toLowerCase()) ? 'admin' : 'user',
            safetyScore: 100,
            trust_score: 100,
            streak: 1,
            walletBalance: 0,
          });
        }
      },
      (err) => handleFirestoreError(err, OperationType.GET, `users/${fbUser.uid}`)
    );
    return () => unsub();
  }, [fbUser]);

  // Ensure monthly user_usage_stats doc & update daily streak
  useEffect(() => {
    if (!fbUser || !userProfile || !userDocExists) return;
    const month = getWatMonthKey();
    const todayKey = getWatDateKey();
    const statId = `${fbUser.uid}_${month}`;
    setUsageStatDocId(statId);

    const ref = doc(db, 'user_usage_stats', statId);
    getDoc(ref)
      .then(async (snap) => {
        if (!snap.exists()) {
          await setDoc(ref, {
            userId: fbUser.uid,
            name: userProfile.fullName,
            avatar: userProfile.photoURL || '',
            totalScans: 0,
            totalReports: 0,
            verifiedReports: 0,
            totalUsageDays: 1,
            lastActiveDate: todayKey,
            totalUsageMinutes: 0,
            totalPoints: 20,
            month,
            cheatingFlagged: false,
            lastActive: serverTimestamp(),
          });
        } else {
          const data = snap.data();
          if (data.lastActiveDate !== todayKey) {
            const nextDays = (data.totalUsageDays || 1) + 1;
            const nextPts = computeLeaderboardPoints({
              verifiedReports: data.verifiedReports || 0,
              totalScans: data.totalScans || 0,
              totalUsageDays: nextDays,
              totalUsageMinutes: data.totalUsageMinutes || 0,
            });
            await updateDoc(ref, {
              totalUsageDays: nextDays,
              lastActiveDate: todayKey,
              totalPoints: nextPts,
              lastActive: serverTimestamp(),
            });
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
        const activeDocs = snap.docs
          .map((d) => ({ id: d.id, ...(d.data() as Omit<SubscriptionDoc, 'id'>) }))
          .filter((s) => s.status === 'active');
        if (activeDocs.some((s) => s.plan === 'Yearly')) setActivePlan('Yearly');
        else if (activeDocs.some((s) => s.plan === 'Monthly')) setActivePlan('Monthly');
        else setActivePlan('Free');
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
    async (lat: number, lng: number, accuracy: number, speedMps = 0, heading: number | null = null) => {
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

      const lastGeo = lastGeocodedPosRef.current;
      const shouldGeocode =
        !lastGeo ||
        Date.now() - lastGeo.time > 20000 ||
        haversineMeters(lastGeo.lat, lastGeo.lng, lat, lng) > 40;

      if (shouldGeocode) {
        lastGeocodedPosRef.current = { lat, lng, time: Date.now() };
        const human = await reverseGeocodeHuman(lat, lng);
        setLocation({
          lat,
          lng,
          accuracy: Math.round(accuracy),
          formattedAddress: human.formattedAddress,
          streetName: human.streetName,
          area: human.area,
          city: human.city,
          state: human.state,
          landmark: human.landmark,
          heading,
          speedMps,
          movementMode,
        });
      } else {
        setLocation((prev) =>
          prev
            ? {
                ...prev,
                lat,
                lng,
                accuracy: Math.round(accuracy),
                heading,
                speedMps,
                movementMode,
              }
            : null
        );
      }
    },
    []
  );

  // Real watchPosition once permissionsReady
  useEffect(() => {
    if (!permissionsReady || !navigator.geolocation) return;
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
        });
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
    <APIProvider apiKey={mapsApiKey} language="en" region="NG">
      <div className="min-h-screen h-screen flex flex-col bg-[#050B14] text-slate-100">
        {/* Case A Demo Quota Banner */}
        {quotaBannerVisible && (
          <div className="bg-amber-50 border-b border-amber-200 text-amber-900 px-4 py-2.5 text-xs md:text-sm flex items-center justify-between gap-2 sticky top-0 z-50 shadow-sm shrink-0">
            <span className="flex-1 text-center">
              Google Maps Platform quota reached. If you are the app owner, visit{' '}
              <a
                href="https://developers.google.com/maps/ai/ai-studio?utm_campaign=gmp_mcp_codeassist_v1_aistudio#quota_exceeded_errors"
                target="_blank"
                rel="noopener noreferrer"
                className="underline font-semibold text-amber-950 hover:text-amber-800"
              >
                maps developer site
              </a>{' '}
              for instructions to update your account.
            </span>
            <button
              type="button"
              onClick={() => setQuotaBannerVisible(false)}
              className="p-1 cursor-pointer shrink-0"
              aria-label="Dismiss quota notice"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Main Active Tab Content */}
        <main className="flex-1 overflow-y-auto">
          {activeTab === 'home' && (
            <HomeTab
              user={userProfile}
              location={location}
              scansToday={scansToday}
              activePlan={activePlan}
              usageStatDocId={usageStatDocId}
              onRefreshLocation={(lat, lng, acc) => updateHumanLocationFromCoords(lat, lng, acc)}
              onNavigateScanner={(sub) => {
                setScannerSubTab(sub);
                setActiveTab('weapon');
              }}
              onOpenReportModal={() => setReportModalOpen(true)}
              onOpenProfile={(uid) => setProfileModalUid(uid)}
            />
          )}

          {activeTab === 'family' && (
            <FamilyTab
              user={userProfile}
              location={location}
              activePlan={activePlan}
              onRefreshLocation={(lat, lng, acc) => updateHumanLocationFromCoords(lat, lng, acc)}
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
              onRefreshLocation={(lat, lng, acc) => updateHumanLocationFromCoords(lat, lng, acc)}
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
              onRefreshLocation={(lat, lng, acc) => updateHumanLocationFromCoords(lat, lng, acc)}
              onOpenReportModal={() => setReportModalOpen(true)}
            />
          )}

          {activeTab === 'safe_business' && (
            <SafeBusinessTab
              user={userProfile}
              location={location}
              onRefreshLocation={(lat, lng, acc) => updateHumanLocationFromCoords(lat, lng, acc)}
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
              onOpenReportModal={() => setReportModalOpen(true)}
              onOpenProfile={(uid) => setProfileModalUid(uid)}
              openSubSectionSignal={openSubSignal}
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

        {/* Global Report & Earn ₦5,000 Modal */}
        <ReportEarnModal
          open={reportModalOpen}
          onClose={() => setReportModalOpen(false)}
          user={userProfile}
          location={location}
          usageStatDocId={usageStatDocId}
        />

        {/* Global User Public Profile & Chat Modal */}
        <UserProfileModal
          targetUserId={profileModalUid}
          currentUid={userProfile.uid}
          currentUserName={userProfile.fullName}
          onClose={() => setProfileModalUid(null)}
        />
      </div>
    </APIProvider>
  );
}
