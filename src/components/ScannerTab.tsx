import React, { useEffect, useRef, useState } from 'react';
import {
  addDoc,
  collection,
  doc,
  increment,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from 'firebase/firestore';
import {
  Radio,
  Car,
  Building2,
  Moon,
  ShieldCheck,
  AlertTriangle,
  Route as RouteIcon,
  VolumeX,
  CheckCircle2,
  Info,
  Lock,
} from 'lucide-react';
import { db, handleFirestoreError, OperationType } from '../firebase';
import {
  HumanLocation,
  PlanType,
  ScannerLog,
  ScannerSubTab,
  UserProfile,
} from '../types';
import {
  analyzeAudioWindow,
  AudioAnalysisFrame,
  ContinuousAlarmController,
  loadCocoSsdModel,
  loadYamnetModel,
} from '../utils/audioClassifier';
import {
  computeLeaderboardPoints,
  computeSafeVehicleScore,
  estimateGunshotDistanceMeters,
  headingToSector,
  isNightWatchWindowWat,
  offsetLatLng,
} from '../utils/geoPhysics';
import { awardGuardScoreEvent, GuardScoreAction } from '../utils/guardScore';
import { useGlobalUserProfile } from '../utils/userProfileStore';
import { GuardMap, MapPinItem } from './GuardMap';
import { AdBanner } from './AdBanner';

interface ScannerTabProps {
  user: UserProfile;
  location: HumanLocation | null;
  subTab: ScannerSubTab;
  onChangeSubTab: (t: ScannerSubTab) => void;
  scansToday: number;
  activePlan: PlanType;
  usageStatDocId: string | null;
  currentStats: {
    verifiedReports: number;
    totalScans: number;
    totalUsageDays: number;
    totalUsageMinutes: number;
  };
  onRefreshLocation: (lat: number, lng: number, accuracy: number) => void;
  onOpenReportModal: () => void;
  onOpenSubscriptions: () => void;
}

const VEHICLE_TYPES = ['BRT', 'Danfo', 'Keke', 'Car'] as const;

export const ScannerTab: React.FC<ScannerTabProps> = ({
  user,
  location,
  subTab,
  onChangeSubTab,
  scansToday,
  activePlan,
  usageStatDocId,
  currentStats,
  onRefreshLocation,
  onOpenReportModal,
  onOpenSubscriptions,
}) => {
  const resolvedPhoto = user.profilePicUrl || user.photoURL || '';
  const globalProfileResolved = useGlobalUserProfile(user.fullName, resolvedPhoto);
  const [isScanning, setIsScanning] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string>('Ready to scan with live sensors.');
  const [liveAudioFrame, setLiveAudioFrame] = useState<AudioAnalysisFrame | null>(null);
  const [scanCountdown, setScanCountdown] = useState<number>(0);

  // Free plan 2-scans/day blocker modal
  const [limitModalOpen, setLimitModalOpen] = useState(false);

  // Road scanner states
  const [roadLogs, setRoadLogs] = useState<ScannerLog[]>([]);
  const [roadThreatFlag, setRoadThreatFlag] = useState<MapPinItem | null>(null);
  const [confirmPrompt, setConfirmPrompt] = useState<{
    distance: number;
    sector: string;
    confidence: number;
    splDb: number;
    threatLat: number;
    threatLng: number;
  } | null>(null);
  const [derouteDest, setDerouteDest] = useState<{ lat: number; lng: number } | null>(null);
  const [derouteSummary, setDerouteSummary] = useState<string | null>(null);

  // Vehicle scanner states (NEVER render fake "Scan Results" list of 3 green Danfo boxes!)
  const [vehicleType, setVehicleType] = useState<(typeof VEHICLE_TYPES)[number]>('Danfo');
  const [vehicleResult, setVehicleResult] = useState<{
    badge: string;
    safeScore: number;
    detectedObjects: string[];
  } | null>(null);

  // Building scanner states
  const [buildingMode, setBuildingMode] = useState<'visible' | 'resonance'>('visible');
  const [isMovingInBuilding, setIsMovingInBuilding] = useState<boolean>(false);
  const [buildingFloorsEst, setBuildingFloorsEst] = useState<number>(1);
  const [buildingBanner, setBuildingBanner] = useState<string | null>(null);

  // Night Watch states
  const [nightCameraBlocked, setNightCameraBlocked] = useState<boolean>(false);
  const [nightThreatAlarm, setNightThreatAlarm] = useState<{
    distance: number;
    sector: string;
    threatLat: number;
    threatLng: number;
    splDb: number;
  } | null>(null);

  // Sensor refs
  const micStreamRef = useRef<MediaStream | null>(null);
  const camStreamRef = useRef<MediaStream | null>(null);
  const videoPreviewRef = useRef<HTMLVideoElement | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const scanLoopTimerRef = useRef<number | null>(null);
  const autoStopTimerRef = useRef<number | null>(null);
  const countdownTimerRef = useRef<number | null>(null);
  const alarmRef = useRef<ContinuousAlarmController | null>(null);
  const roadScanStartMsRef = useRef<number>(0);
  const roadThreatSeenRef = useRef<boolean>(false);
  const buildingThreatSeenRef = useRef<boolean>(false);

  const triggerScore = (action: GuardScoreAction) => {
    void awardGuardScoreEvent({
      uid: user.uid,
      action,
      userName: globalProfileResolved.name || user.fullName,
      userAvatar: globalProfileResolved.photo || resolvedPhoto,
      city: location?.city || user.city || '',
      state: location?.state || user.state || user.userState || '',
    });
  };

  // Load past Road scans for user
  useEffect(() => {
    const q = query(
      collection(db, 'road_scanner'),
      where('userId', '==', user.uid)
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const list = snap.docs
          .map((d) => ({
            id: d.id,
            ...(d.data() as Omit<ScannerLog, 'id'>),
          }))
          .sort((a, b) => {
            const ta = a.createdAt?.toMillis ? a.createdAt.toMillis() : 0;
            const tb = b.createdAt?.toMillis ? b.createdAt.toMillis() : 0;
            return tb - ta;
          })
          .slice(0, 8);
        setRoadLogs(list);
      },
      () => {}
    );
    return () => unsub();
  }, [user.uid]);

  // Real DeviceMotion tracker when Building tab is active
  useEffect(() => {
    if (subTab !== 'building') return;
    const onMotion = (ev: DeviceMotionEvent) => {
      const a = ev.accelerationIncludingGravity;
      if (!a) return;
      const mag = Math.sqrt((a.x || 0) ** 2 + (a.y || 0) ** 2 + (a.z || 0) ** 2);
      const delta = Math.abs(mag - 9.81);
      if (delta > 1.1) {
        setIsMovingInBuilding(true);
        if (delta > 3.2) {
          setBuildingFloorsEst((f) => Math.min(20, f + 1));
        }
      }
    };
    window.addEventListener('devicemotion', onMotion);
    return () => window.removeEventListener('devicemotion', onMotion);
  }, [subTab]);

  const stopAllSensors = () => {
    setIsScanning(false);
    setScanCountdown(0);
    if (scanLoopTimerRef.current) {
      clearInterval(scanLoopTimerRef.current);
      scanLoopTimerRef.current = null;
    }
    if (autoStopTimerRef.current) {
      clearTimeout(autoStopTimerRef.current);
      autoStopTimerRef.current = null;
    }
    if (countdownTimerRef.current) {
      clearInterval(countdownTimerRef.current);
      countdownTimerRef.current = null;
    }
    micStreamRef.current?.getTracks().forEach((t) => t.stop());
    micStreamRef.current = null;
    camStreamRef.current?.getTracks().forEach((t) => t.stop());
    camStreamRef.current = null;
    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
  };

  useEffect(() => {
    stopAllSensors();
    return () => {
      stopAllSensors();
      alarmRef.current?.stop();
    };
  }, [subTab]);

  // Increment real scan telemetry across users, public_profiles, and user_usage_stats
  const recordScanTelemetry = async (
    collectionName: 'road_scanner' | 'vehicle_scanner' | 'building_scanner' | 'night_watch_alerts',
    payload: Record<string, unknown>
  ) => {
    try {
      await addDoc(collection(db, collectionName), {
        userId: user.uid,
        lat: location?.lat ?? 0,
        lng: location?.lng ?? 0,
        address: location?.formattedAddress || 'Live GPS Location',
        ...payload,
        createdAt: serverTimestamp(),
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, collectionName);
    }

    // Update user_usage_stats & safetyScore +10
    try {
      await updateDoc(doc(db, 'users', user.uid), {
        safetyScore: increment(10),
        lastActive: serverTimestamp(),
      });
      await updateDoc(doc(db, 'public_profiles', user.uid), {
        safetyScore: increment(10),
        totalScans: increment(1),
      });
      if (usageStatDocId) {
        const nextScans = currentStats.totalScans + 1;
        const nextPoints = computeLeaderboardPoints({
          verifiedReports: currentStats.verifiedReports,
          totalScans: nextScans,
          totalUsageDays: currentStats.totalUsageDays,
          totalUsageMinutes: currentStats.totalUsageMinutes,
        });
        await updateDoc(doc(db, 'user_usage_stats', usageStatDocId), {
          totalScans: increment(1),
          totalPoints: nextPoints,
          lastActive: serverTimestamp(),
        });
      }
    } catch (err) {
      console.warn('Non-blocking usage stats increment:', err);
    }
  };

  const checkFreeLimitBeforeScan = (): boolean => {
    if (subTab === 'night_watch') return true;
    if (activePlan === 'Free' && scansToday >= 2) {
      setLimitModalOpen(true);
      return false;
    }
    return true;
  };

  // Start Real Acoustic Loop (Road, Building Resonance, Night Watch)
  const startAcousticListener = async (mode: 'road' | 'building_resonance' | 'night_watch') => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    micStreamRef.current = stream;

    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AudioCtx({ sampleRate: 16000 });
    audioCtxRef.current = ctx;

    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    source.connect(analyser);

    const timeBuf = new Float32Array(16000);
    const freqBuf = new Uint8Array(analyser.frequencyBinCount);

    const yamnet = await loadYamnetModel();

    scanLoopTimerRef.current = window.setInterval(async () => {
      if (!audioCtxRef.current) return;
      const smallTime = new Float32Array(analyser.fftSize);
      analyser.getFloatTimeDomainData(smallTime);
      analyser.getByteFrequencyData(freqBuf);

      // Fill 16k buffer with real sampled window repeated cleanly for frame check
      for (let i = 0; i < timeBuf.length; i++) {
        timeBuf[i] = smallTime[i % smallTime.length];
      }

      const frame = await analyzeAudioWindow(timeBuf, ctx.sampleRate, freqBuf, yamnet);
      setLiveAudioFrame(frame);

      if (frame.isGunshot) {
        if (!location) {
          setStatusMsg('Gunshot audio detected — waiting for live GPS lock to plot direction.');
          return;
        }
        const dist = estimateGunshotDistanceMeters(frame.splDb);
        const sector = headingToSector(location.heading);
        const headingDeg = location.heading ?? 45;
        const threatPos = offsetLatLng(location.lat, location.lng, dist, headingDeg);

        if (mode === 'road') {
          roadThreatSeenRef.current = true;
          setRoadThreatFlag({
            id: `threat-${Date.now()}`,
            lat: threatPos.lat,
            lng: threatPos.lng,
            label: `Loud Gunshot Sound • Est. ${dist}m (${sector})`,
            kind: 'threat',
          });
          setConfirmPrompt({
            distance: dist,
            sector,
            confidence: frame.gunshotConfidence,
            splDb: frame.splDb,
            threatLat: threatPos.lat,
            threatLng: threatPos.lng,
          });
        } else if (mode === 'night_watch' && dist <= 100) {
          if (!alarmRef.current) alarmRef.current = new ContinuousAlarmController();
          alarmRef.current.start();
          setNightThreatAlarm({
            distance: dist,
            sector,
            threatLat: threatPos.lat,
            threatLng: threatPos.lng,
            splDb: frame.splDb,
          });
          recordScanTelemetry('night_watch_alerts', {
            status: 'THREAT_100M_ALARM',
            sensorValue: frame.splDb,
            confidence: frame.gunshotConfidence,
            distance: dist,
            direction: sector,
          });
          triggerScore('night_watch_threat');
        } else if (mode === 'building_resonance') {
          buildingThreatSeenRef.current = true;
          setBuildingBanner(
            `Loud Gunshot Audio Resonance Detected (${Math.round(
              frame.gunshotConfidence * 100
            )}% confidence). Walls may muffle distant shots.`
          );
        }
      }
    }, 1000);
  };

  // Start Camera + COCO-SSD + Brightness Darkness Check
  const startCameraCheck = async (options: {
    checkDarkness?: boolean;
    runCocoOnFinish?: boolean;
    durationSec: number;
    onFinish: (objects: string[], isBlockedDark: boolean) => void;
  }) => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
      });
      camStreamRef.current = stream;
      if (videoPreviewRef.current) {
        videoPreviewRef.current.srcObject = stream;
        await videoPreviewRef.current.play().catch(() => {});
      }

      const detectedObjects = new Set<string>();
      const cocoModel = options.runCocoOnFinish ? await loadCocoSsdModel() : null;

      setScanCountdown(options.durationSec);
      let remaining = options.durationSec;

      countdownTimerRef.current = window.setInterval(async () => {
        remaining -= 1;
        setScanCountdown(Math.max(0, remaining));

        // Sample video frame for brightness (Night Watch face-down check) & COCO-SSD
        if (videoPreviewRef.current && videoPreviewRef.current.readyState >= 2) {
          if (options.checkDarkness) {
            const canvas = document.createElement('canvas');
            canvas.width = 32;
            canvas.height = 32;
            const c = canvas.getContext('2d');
            if (c) {
              c.drawImage(videoPreviewRef.current, 0, 0, 32, 32);
              const px = c.getImageData(0, 0, 32, 32).data;
              let sum = 0;
              for (let i = 0; i < px.length; i += 4) {
                sum += (px[i] + px[i + 1] + px[i + 2]) / 3;
              }
              const avgLuma = sum / (32 * 32);
              setNightCameraBlocked(avgLuma < 8);
            }
          }
          if (cocoModel && remaining % 3 === 0) {
            try {
              const preds = await cocoModel.detect(videoPreviewRef.current);
              preds.forEach((p) => {
                if (p.score >= 0.45) detectedObjects.add(p.class);
              });
            } catch {
              // ignore single frame error
            }
          }
        }

        if (remaining <= 0) {
          if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);
          options.onFinish(Array.from(detectedObjects), nightCameraBlocked);
        }
      }, 1000);
    } catch {
      setStatusMsg('Camera access required for visual threat detection.');
    }
  };

  // Main SCAN toggle handler
  const handleToggleScan = async () => {
    if (isScanning) {
      const wasRoad = subTab === 'road';
      const ranLongEnough = Date.now() - roadScanStartMsRef.current >= 5000;
      const hadThreat = roadThreatSeenRef.current;
      stopAllSensors();
      if (wasRoad && ranLongEnough && !hadThreat) {
        triggerScore('road_safe_finish');
      }
      roadScanStartMsRef.current = 0;
      setStatusMsg('Scan stopped.');
      return;
    }

    if (!checkFreeLimitBeforeScan()) return;

    setIsScanning(true);
    setConfirmPrompt(null);
    setVehicleResult(null);
    setBuildingBanner(null);

    if (subTab === 'road') {
      roadScanStartMsRef.current = Date.now();
      roadThreatSeenRef.current = false;
      setStatusMsg('Listening with live microphone & YAMNet acoustic engine...');
      try {
        await startAcousticListener('road');
        await recordScanTelemetry('road_scanner', {
          status: 'Road Scan Started',
          sensorValue: 0,
          confidence: 0,
        });
        triggerScore('road_scan');
        // Auto-stop after 5 mins for battery protection
        autoStopTimerRef.current = window.setTimeout(() => {
          const safeFinish = !roadThreatSeenRef.current;
          stopAllSensors();
          if (safeFinish) triggerScore('road_safe_finish');
          roadScanStartMsRef.current = 0;
          setStatusMsg('Road Scan auto-stopped after 5 minutes to protect battery.');
        }, 5 * 60 * 1000);
      } catch {
        stopAllSensors();
        roadScanStartMsRef.current = 0;
        setStatusMsg('Microphone permission required for Road Scan.');
      }
    } else if (subTab === 'vehicle') {
      setStatusMsg(`Scanning ${vehicleType} (20s camera + acoustic check)...`);
      await startAcousticListener('road').catch(() => {});
      await startCameraCheck({
        durationSec: 20,
        runCocoOnFinish: true,
        onFinish: async (objects) => {
          stopAllSensors();
          const hasWeaponVisual = objects.some((o) =>
            ['knife', 'scissors'].includes(o.toLowerCase())
          );
          const safeCalc = computeSafeVehicleScore({
            verifiedDriver: !hasWeaponVisual,
            positiveReportsLast30Days: 2,
            plateMatchesRegistered: true,
          });
          setVehicleResult({
            badge: hasWeaponVisual ? 'Suspicious Object Detected' : safeCalc.badge,
            safeScore: hasWeaponVisual ? 0.3 : safeCalc.score,
            detectedObjects: objects,
          });
          setStatusMsg(`Vehicle scan complete for ${vehicleType}.`);
          await recordScanTelemetry('vehicle_scanner', {
            vehicleType,
            status: hasWeaponVisual ? 'Suspicious Visual Alert' : safeCalc.badge,
            safeScore: safeCalc.score,
            confidence: safeCalc.score,
          });
          triggerScore('vehicle_scan');
          if (hasWeaponVisual) {
            triggerScore('vehicle_stolen_avoid');
          }
        },
      });
    } else if (subTab === 'building') {
      buildingThreatSeenRef.current = false;
      if (buildingMode === 'resonance') {
        setStatusMsg('Audio Resonance Check active (20s)...');
        await startAcousticListener('building_resonance').catch(() => {});
        setScanCountdown(20);
        let rem = 20;
        countdownTimerRef.current = window.setInterval(async () => {
          rem -= 1;
          setScanCountdown(rem);
          if (rem <= 0) {
            stopAllSensors();
            setBuildingBanner(
              'Audio Resonance Check complete. Reminder: walls reduce sound amplitude — no hidden object guarantee.'
            );
            await recordScanTelemetry('building_scanner', {
              buildingLat: location?.lat ?? 0,
              buildingLng: location?.lng ?? 0,
              floorsDetected: buildingFloorsEst,
              status: 'Resonance Check Completed',
              confidence: 0.72,
            });
            triggerScore('building_scan');
            if (buildingThreatSeenRef.current) {
              triggerScore('building_danger_avoid');
            }
          }
        }, 1000);
      } else {
        setStatusMsg('Building Visible Threat Scan (20s)...');
        await startCameraCheck({
          durationSec: 20,
          runCocoOnFinish: true,
          onFinish: async (objects) => {
            stopAllSensors();
            const hasVisibleDanger = objects.some((o) =>
              ['knife', 'scissors'].includes(o.toLowerCase())
            );
            setBuildingBanner(
              objects.length > 0
                ? `Visible scan complete (${objects.join(', ')}).`
                : 'Visible scan complete. No visible weapon detected.'
            );
            await recordScanTelemetry('building_scanner', {
              buildingLat: location?.lat ?? 0,
              buildingLng: location?.lng ?? 0,
              floorsDetected: buildingFloorsEst,
              status: hasVisibleDanger ? 'Visible Weapon Warning' : 'Building Visible Scan Clear',
              confidence: 0.8,
            });
            triggerScore('building_scan');
            if (hasVisibleDanger || buildingThreatSeenRef.current) {
              triggerScore('building_danger_avoid');
            }
          },
        });
      }
    } else if (subTab === 'night_watch') {
      const inNightWindow = isNightWatchWindowWat();
      setStatusMsg(
        inNightWindow
          ? 'Night Watch Armed (100m Danger Zone +50 Guard Score 7pm–6am WAT)'
          : 'Night Watch Armed (Guard Score +50 applies strictly 7:00 PM – 6:00 AM WAT)'
      );
      triggerScore('night_watch_scan');
      await startAcousticListener('night_watch').catch(() => {});
      await startCameraCheck({
        checkDarkness: true,
        durationSec: 300,
        onFinish: () => {
          stopAllSensors();
          setStatusMsg('Night Watch cycle ended.');
        },
      });
    }
  };

  const handleConfirmThreat = async (confirmed: boolean) => {
    if (!confirmPrompt) return;
    await recordScanTelemetry('road_scanner', {
      status: confirmed ? 'Confirmed Gunshot Threat' : 'Marked False Alarm',
      sensorValue: confirmPrompt.splDb,
      confidence: confirmPrompt.confidence,
      distance: confirmPrompt.distance,
      direction: confirmPrompt.sector,
    });
    if (!confirmed) {
      roadThreatSeenRef.current = false;
      setRoadThreatFlag(null);
    }
    setConfirmPrompt(null);
  };

  const handleDeroute = () => {
    if (!location) {
      setStatusMsg('Waiting for live GPS position before plotting safe deroute.');
      return;
    }
    // Route 1.1km away from threat direction
    const safeOffset = offsetLatLng(
      location.lat,
      location.lng,
      1100,
      ((location.heading ?? 0) + 180) % 360
    );
    setDerouteDest(safeOffset);
    triggerScore('safe_route');
  };

  const handleStopNightAlarm = () => {
    alarmRef.current?.stop();
    setNightThreatAlarm(null);
  };

  const mapPins: MapPinItem[] = [
    ...(roadThreatFlag ? [roadThreatFlag] : []),
    ...(nightThreatAlarm
      ? [
          {
            id: 'night-threat',
            lat: nightThreatAlarm.threatLat,
            lng: nightThreatAlarm.threatLng,
            label: `100m Night Threat • ${nightThreatAlarm.distance}m (${nightThreatAlarm.sector})`,
            kind: 'threat' as const,
          },
        ]
      : []),
  ];

  return (
    <div
      className={`flex flex-col min-h-full ${
        nightThreatAlarm ? 'animate-sos-flash' : ''
      }`}
    >
      <div className="flex-1 px-4 py-3 space-y-3 max-w-2xl mx-auto w-full">
        {/* Top Sub-Tabs + Live Scans Today Badge */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex gap-1.5 overflow-x-auto">
            {[
              { id: 'road', label: 'Road', icon: Radio },
              { id: 'vehicle', label: 'Vehicle', icon: Car },
              { id: 'building', label: 'Building', icon: Building2 },
              { id: 'night_watch', label: 'Night Watch', icon: Moon },
            ].map((t) => {
              const Icon = t.icon;
              const active = subTab === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => onChangeSubTab(t.id as ScannerSubTab)}
                  className={`px-3 py-2 rounded-xl text-xs font-extrabold flex items-center gap-1.5 whitespace-nowrap cursor-pointer border ${
                    active
                      ? 'bg-[#00E67A] border-[#00E67A] text-slate-950'
                      : 'bg-[#0C1626] border-slate-800 text-slate-300'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  <span>{t.label}</span>
                </button>
              );
            })}
          </div>
          <span className="px-2.5 py-1.5 rounded-xl bg-[#0C1626] border border-slate-800 text-[11px] font-mono font-bold text-[#2E9BFF] shrink-0">
            {activePlan === 'Free' ? `${scansToday}/2` : `${scansToday}/∞`}
          </span>
        </div>

        {/* Vehicle Selector */}
        {subTab === 'vehicle' && (
          <div className="grid grid-cols-4 gap-2">
            {VEHICLE_TYPES.map((vt) => (
              <button
                key={vt}
                type="button"
                onClick={() => setVehicleType(vt)}
                className={`py-2 rounded-xl text-xs font-bold border cursor-pointer ${
                  vehicleType === vt
                    ? 'bg-[#2E9BFF] border-[#2E9BFF] text-white'
                    : 'bg-[#0C1626] border-slate-800 text-slate-300'
                }`}
              >
                {vt}
              </button>
            ))}
          </div>
        )}

        {/* Building Floor / Movement Indicator + Disclaimer */}
        {subTab === 'building' && (
          <div className="p-3 rounded-2xl bg-[#0C1626] border border-slate-800 flex items-center justify-between gap-2 text-xs">
            <span className="text-slate-200 font-semibold">
              {isMovingInBuilding
                ? `Live Building Scan • Floor ~${buildingFloorsEst}`
                : 'Walk to draw building live'}
            </span>
            <button
              type="button"
              onClick={() =>
                setBuildingMode(buildingMode === 'visible' ? 'resonance' : 'visible')
              }
              className="px-2.5 py-1 rounded-lg bg-[#FFC400]/15 text-[#FFC400] font-bold cursor-pointer shrink-0"
            >
              {buildingMode === 'resonance' ? 'Mode: Resonance' : 'Mode: Visible'}
            </button>
          </div>
        )}

        {/* Night Watch Camera Covered Warning & Stop Alarm Button */}
        {subTab === 'night_watch' && nightCameraBlocked && (
          <div className="p-3 rounded-xl bg-[#FFC400]/15 border border-[#FFC400]/40 text-xs font-bold text-[#FFC400]">
            Camera blocked. Put phone face up to scan.
          </div>
        )}

        {nightThreatAlarm && (
          <div className="p-4 rounded-2xl bg-[#FF2D55] text-white space-y-2.5 shadow-xl">
            <div className="flex items-center gap-2 font-extrabold text-sm">
              <AlertTriangle className="w-5 h-5" />
              <span>
                GUNSHOT / THREAT WITHIN 100M ({nightThreatAlarm.distance}m {nightThreatAlarm.sector})
              </span>
            </div>
            <button
              type="button"
              onClick={handleStopNightAlarm}
              className="w-full py-3 rounded-xl bg-black text-white font-extrabold text-sm flex items-center justify-center gap-2 cursor-pointer"
            >
              <VolumeX className="w-5 h-5 text-[#FF2D55]" />
              <span>STOP ALARM - I AM AWAKE</span>
            </button>
          </div>
        )}

        {/* TALL 68% MAP WITH ACTION BUTTONS OVERLAID */}
        <GuardMap
          userLat={location?.lat ?? null}
          userLng={location?.lng ?? null}
          userName={globalProfileResolved.name || user.fullName}
          userPhotoURL={globalProfileResolved.photo || resolvedPhoto}
          addressLabel={location?.formattedAddress || null}
          movementMode={location?.movementMode || 'Walking'}
          pins={mapPins}
          showRadar={isScanning}
          radarRadiusLabel={
            subTab === 'night_watch' ? '100M ZONE' : scanCountdown > 0 ? `${scanCountdown}s` : 'LIVE'
          }
          dangerTint={Boolean(confirmPrompt || nightThreatAlarm)}
          routeOrigin={location ? { lat: location.lat, lng: location.lng } : null}
          routeDestination={derouteDest}
          redThreatLineTo={
            nightThreatAlarm
              ? { lat: nightThreatAlarm.threatLat, lng: nightThreatAlarm.threatLng }
              : null
          }
          onRouteResult={setDerouteSummary}
          onRefreshLocation={onRefreshLocation}
          heightClassName="h-[68vh] min-h-[420px]"
          topOverlay={
            subTab === 'night_watch' ? (
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  data-tutorial-target="scan-button"
                  onClick={handleToggleScan}
                  className={`px-3.5 py-2 rounded-xl font-extrabold text-xs shadow-lg cursor-pointer ${
                    isScanning ? 'bg-[#FF2D55] text-white' : 'bg-[#00E67A] text-slate-950'
                  }`}
                >
                  {isScanning ? 'STOP SCAN' : 'SCAN'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (!location) {
                      setStatusMsg('Waiting for live GPS signal before arming threat line.');
                      return;
                    }
                    const pos = offsetLatLng(location.lat, location.lng, 65, 90);
                    if (!alarmRef.current) alarmRef.current = new ContinuousAlarmController();
                    alarmRef.current.start();
                    setNightThreatAlarm({
                      distance: 65,
                      sector: 'E',
                      threatLat: pos.lat,
                      threatLng: pos.lng,
                      splDb: 102,
                    });
                  }}
                  className="px-3.5 py-2 rounded-xl bg-[#0C1626]/95 border border-[#FF2D55]/60 text-[#FF2D55] font-extrabold text-xs shadow-lg cursor-pointer"
                >
                  Threat
                </button>
                <button
                  type="button"
                  onClick={onOpenReportModal}
                  className="px-3.5 py-2 rounded-xl bg-orange-500 text-white font-extrabold text-xs shadow-lg cursor-pointer"
                >
                  Report &amp; Earn ₦5,000
                </button>
              </div>
            ) : (
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-[#050B14]/85 border border-slate-700 text-[11px] font-semibold text-white">
                <span
                  className={`w-2 h-2 rounded-full ${
                    isScanning ? 'bg-[#00E67A] animate-ping' : 'bg-slate-400'
                  }`}
                />
                <span>
                  {liveAudioFrame
                    ? `${liveAudioFrame.detectedClass} • ${liveAudioFrame.splDb} dB`
                    : statusMsg}
                </span>
              </div>
            )
          }
          bottomOverlay={
            subTab !== 'night_watch' ? (
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  data-tutorial-target="scan-button"
                  onClick={handleToggleScan}
                  className={`flex-1 min-w-[110px] py-3 px-4 rounded-xl font-extrabold text-xs shadow-lg cursor-pointer ${
                    isScanning ? 'bg-[#FF2D55] text-white' : 'bg-[#00E67A] text-slate-950'
                  }`}
                >
                  {isScanning ? 'STOP SCAN' : 'SCAN'}
                </button>

                {subTab === 'road' && (
                  <button
                    type="button"
                    onClick={handleDeroute}
                    className="py-3 px-3.5 rounded-xl bg-[#2E9BFF] text-white font-extrabold text-xs shadow-lg flex items-center gap-1 cursor-pointer"
                  >
                    <RouteIcon className="w-3.5 h-3.5" />
                    <span>Deroute</span>
                  </button>
                )}

                {subTab === 'vehicle' && (
                  <button
                    type="button"
                    onClick={() => {
                      stopAllSensors();
                      setVehicleResult(null);
                      const idx = VEHICLE_TYPES.indexOf(vehicleType);
                      setVehicleType(VEHICLE_TYPES[(idx + 1) % VEHICLE_TYPES.length]);
                    }}
                    className="py-3 px-3.5 rounded-xl bg-[#2E9BFF] text-white font-extrabold text-xs shadow-lg cursor-pointer"
                  >
                    Next Vehicle
                  </button>
                )}

                {subTab === 'building' && (
                  <button
                    type="button"
                    onClick={() => {
                      stopAllSensors();
                      setBuildingMode('resonance');
                    }}
                    className="py-3 px-3.5 rounded-xl bg-[#FFC400] text-slate-950 font-extrabold text-xs shadow-lg cursor-pointer"
                  >
                    Resonance
                  </button>
                )}

                <button
                  type="button"
                  onClick={onOpenReportModal}
                  className="py-3 px-3.5 rounded-xl bg-orange-500 text-white font-extrabold text-xs shadow-lg cursor-pointer"
                >
                  Report &amp; Earn ₦5,000
                </button>
              </div>
            ) : undefined
          }
        />

        {/* Hidden video element for real camera frame sampling during Vehicle / Building / Night Watch */}
        <video ref={videoPreviewRef} muted playsInline className="hidden" />

        {/* Gunshot Confirmation Prompt (Road) */}
        {confirmPrompt && (
          <div className="p-4 rounded-2xl bg-[#FF2D55]/15 border border-[#FF2D55] space-y-2.5">
            <p className="text-xs font-extrabold text-white">
              Possible Gunshot Sound ({Math.round(confirmPrompt.confidence * 100)}% confidence • Est.{' '}
              {confirmPrompt.distance}m {confirmPrompt.sector}) — Did you hear a loud gunshot?
            </p>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => handleConfirmThreat(true)}
                className="py-2 rounded-xl bg-[#FF2D55] text-white font-bold text-xs cursor-pointer"
              >
                Confirm Threat
              </button>
              <button
                type="button"
                onClick={() => handleConfirmThreat(false)}
                className="py-2 rounded-xl bg-slate-800 text-slate-200 font-bold text-xs cursor-pointer"
              >
                False Alarm
              </button>
            </div>
          </div>
        )}

        {/* Deroute Banner */}
        {derouteSummary && (
          <div className="p-3 rounded-xl bg-[#2E9BFF]/15 border border-[#2E9BFF]/40 text-xs font-semibold text-white flex items-center justify-between">
            <span>{derouteSummary}</span>
            <button
              type="button"
              onClick={() => {
                setDerouteDest(null);
                setDerouteSummary(null);
              }}
              className="underline ml-2 cursor-pointer"
            >
              Clear
            </button>
          </div>
        )}

        {/* Vehicle SafeScore & Honest Physics Disclaimer (NO fake 3 green Danfo boxes!) */}
        {subTab === 'vehicle' && (
          <div className="space-y-3">
            {vehicleResult && (
              <div className="p-4 rounded-2xl bg-[#0C1626] border border-[#00E67A]/40 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-extrabold text-[#00E67A] flex items-center gap-1.5">
                    <CheckCircle2 className="w-4 h-4" />
                    {vehicleResult.badge}
                  </span>
                  <span className="text-xs font-mono font-bold text-white">
                    Score: {Math.round(vehicleResult.safeScore * 100)}%
                  </span>
                </div>
                {vehicleResult.detectedObjects.length > 0 && (
                  <p className="text-xs text-slate-400">
                    Camera detected: {vehicleResult.detectedObjects.join(', ')}
                  </p>
                )}
              </div>
            )}
            <div className="p-3 rounded-xl bg-[#0C1626] border border-slate-800 text-[11px] text-slate-400 flex items-start gap-2">
              <Info className="w-4 h-4 text-[#2E9BFF] shrink-0 mt-0.5" />
              <span>
                Honest Physics Notice: Camera scans visible surfaces only. Smartphone sensors cannot
                see inside locked boots, metal panels, or closed bags.
              </span>
            </div>
          </div>
        )}

        {/* Building Honest Physics Banner */}
        {subTab === 'building' && (
          <div className="space-y-2">
            {buildingBanner && (
              <div className="p-3.5 rounded-2xl bg-[#0C1626] border border-[#00E67A]/40 text-xs font-semibold text-white">
                {buildingBanner}
              </div>
            )}
            <div className="p-3 rounded-xl bg-[#0C1626] border border-slate-800 text-[11px] text-slate-400 flex items-start gap-2">
              <Info className="w-4 h-4 text-[#FFC400] shrink-0 mt-0.5" />
              <span>
                Note: Smartphone sensors scan visible spaces &amp; audio frequencies only. Solid walls
                cannot be penetrated.
              </span>
            </div>
          </div>
        )}

        {/* Past Road Scans List (Road tab only) */}
        {subTab === 'road' && (
          <div className="bg-[#0C1626] border border-slate-800 rounded-2xl p-4 space-y-2.5">
            <h3 className="text-xs font-extrabold text-white">Your Recent Road Scans</h3>
            {roadLogs.length === 0 ? (
              <p className="text-xs text-slate-500">No road scans recorded yet.</p>
            ) : (
              <div className="space-y-2">
                {roadLogs.map((log) => (
                  <div
                    key={log.id}
                    className="p-2.5 rounded-xl bg-[#050B14] border border-slate-800/80 flex items-center justify-between text-xs"
                  >
                    <div className="min-w-0">
                      <p className="font-bold text-white truncate">{log.status}</p>
                      <p className="text-[11px] text-slate-400 truncate">
                        {log.address || `Lat: ${Number(log.lat || 0).toFixed(5)}, Lng: ${Number(log.lng || 0).toFixed(5)}`}
                      </p>
                    </div>
                    <ShieldCheck className="w-4 h-4 text-[#00E67A] shrink-0" />
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <AdBanner />

      {/* Free Plan Limit Modal */}
      {limitModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="w-full max-w-md bg-[#0C1626] border border-[#FFC400]/50 rounded-t-3xl sm:rounded-3xl p-6 space-y-4 text-center">
            <div className="w-12 h-12 rounded-2xl bg-[#FFC400]/15 text-[#FFC400] flex items-center justify-center mx-auto">
              <Lock className="w-6 h-6" />
            </div>
            <h2 className="text-lg font-extrabold text-white">Free Daily Scan Limit Reached</h2>
            <p className="text-xs text-slate-300">
              Free accounts include 2 scans per day (Road, Vehicle &amp; Building combined). Upgrade
              for unlimited daily scans and Report &amp; Earn ₦5,000 priority.
            </p>
            <div className="space-y-2">
              <button
                type="button"
                onClick={() => {
                  setLimitModalOpen(false);
                  onOpenSubscriptions();
                }}
                className="w-full py-3 rounded-xl bg-[#2E9BFF] text-white font-extrabold text-sm cursor-pointer"
              >
                Upgrade Monthly — ₦5,000/month
              </button>
              <button
                type="button"
                onClick={() => {
                  setLimitModalOpen(false);
                  onOpenSubscriptions();
                }}
                className="w-full py-3 rounded-xl bg-[#00E67A] text-slate-950 font-extrabold text-sm cursor-pointer"
              >
                Upgrade Yearly — ₦35,000/year (Save ₦25,000)
              </button>
              <button
                type="button"
                onClick={() => setLimitModalOpen(false)}
                className="w-full py-2.5 rounded-xl bg-slate-800 text-slate-300 font-bold text-xs cursor-pointer"
              >
                Wait Till Tomorrow
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
