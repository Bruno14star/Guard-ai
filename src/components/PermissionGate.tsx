import React, { useEffect, useRef, useState } from 'react';
import { doc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { MapPin, Mic, ShieldCheck, AlertCircle, CheckCircle2 } from 'lucide-react';
import { db } from '../firebase';
import { reverseGeocodeHuman } from '../utils/geoPhysics';

export interface InitialGpsPayload {
  lat: number;
  lng: number;
  accuracy: number;
  address: string;
  streetName: string;
  area: string;
  city: string;
  state: string;
  landmark: string;
}

interface PermissionGateProps {
  uid: string;
  onComplete: (initialGps: InitialGpsPayload | null) => void;
}

export const PermissionGate: React.FC<PermissionGateProps> = ({ uid, onComplete }) => {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [locError, setLocError] = useState<string | null>(null);
  const [locLoading, setLocLoading] = useState(false);
  const [locSkipped, setLocSkipped] = useState(false);
  const [gpsData, setGpsData] = useState<InitialGpsPayload | null>(null);

  const [micError, setMicError] = useState<string | null>(null);
  const [micLoading, setMicLoading] = useState(false);
  const [micGranted, setMicGranted] = useState(false);
  const [micLevel, setMicLevel] = useState(0);

  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);

  const gpsWatchRef = useRef<number | null>(null);
  const gpsTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (gpsWatchRef.current !== null && navigator.geolocation) {
        navigator.geolocation.clearWatch(gpsWatchRef.current);
      }
      if (gpsTimerRef.current) clearTimeout(gpsTimerRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      audioCtxRef.current?.close().catch(() => {});
    };
  }, []);

  const requestLocation = () => {
    setLocError(null);
    setLocSkipped(false);
    if (!navigator.geolocation) {
      setLocError('Location Not Set — GPS not available on this device.');
      return;
    }

    if (gpsWatchRef.current !== null) {
      navigator.geolocation.clearWatch(gpsWatchRef.current);
      gpsWatchRef.current = null;
    }
    if (gpsTimerRef.current) {
      clearTimeout(gpsTimerRef.current);
      gpsTimerRef.current = null;
    }

    setLocLoading(true);
    let settled = false;

    const cleanupGps = () => {
      if (gpsWatchRef.current !== null) {
        navigator.geolocation.clearWatch(gpsWatchRef.current);
        gpsWatchRef.current = null;
      }
      if (gpsTimerRef.current) {
        clearTimeout(gpsTimerRef.current);
        gpsTimerRef.current = null;
      }
    };

    const handlePosition = async (pos: GeolocationPosition) => {
      if (settled) return;
      settled = true;
      cleanupGps();

      const { latitude, longitude, accuracy } = pos.coords;
      const coordFallback = `Lat: ${latitude.toFixed(5)}, Lng: ${longitude.toFixed(5)}`;
      let geo = {
        formattedAddress: coordFallback,
        streetName: coordFallback,
        area: '',
        city: '',
        state: '',
        landmark: '',
      };
      try {
        geo = await Promise.race([
          reverseGeocodeHuman(latitude, longitude),
          new Promise<typeof geo>((resolve) =>
            window.setTimeout(() => resolve(geo), 4500)
          ),
        ]);
      } catch {
        // Keep coordinate/PH hint fallback
      } finally {
        const resolvedGps: InitialGpsPayload = {
          lat: latitude,
          lng: longitude,
          accuracy: Math.round(accuracy || 25),
          address: geo.formattedAddress,
          streetName: geo.streetName,
          area: geo.area,
          city: geo.city,
          state: geo.state,
          landmark: geo.landmark,
        };
        setGpsData(resolvedGps);

        // Save GPS city/state/coordinates to Firestore (never default to Lagos)
        if (geo.city || geo.state) {
          updateDoc(doc(db, 'users', uid), {
            city: geo.city,
            state: geo.state,
            userState: geo.state,
            locationSource: 'gps',
            locationUpdatedAt: serverTimestamp(),
            lastLat: latitude,
            lastLng: longitude,
          }).catch(() => {});

          updateDoc(doc(db, 'public_profiles', uid), {
            city: geo.city,
            state: geo.state,
            userState: geo.state,
          }).catch(() => {});

          setDoc(
            doc(db, 'me_profiles', uid),
            {
              userId: uid,
              city: geo.city,
              state: geo.state,
              userState: geo.state,
              updatedAt: serverTimestamp(),
            },
            { merge: true }
          ).catch(() => {});
        } else {
          updateDoc(doc(db, 'users', uid), {
            lastLat: latitude,
            lastLng: longitude,
            locationSource: 'gps',
            locationUpdatedAt: serverTimestamp(),
          }).catch(() => {});
        }

        setLocLoading(false);
        setStep(2);
      }
    };

    const handleFinalFailure = (err?: GeolocationPositionError) => {
      if (settled) return;
      settled = true;
      cleanupGps();
      setLocLoading(false);
      if (err && err.code === err.PERMISSION_DENIED) {
        setLocError('Location Not Set — GPS access denied. Allow Location access and tap Set My Location.');
      } else {
        setLocError('Location Not Set — GPS unavailable right now. Turn on GPS and tap Set My Location.');
      }
    };

    const runFastFallback = () => {
      if (settled) return;
      gpsTimerRef.current = window.setTimeout(() => handleFinalFailure(), 7000);
      navigator.geolocation.getCurrentPosition(
        handlePosition,
        (err) => handleFinalFailure(err),
        { enableHighAccuracy: false, timeout: 6500, maximumAge: 60000 }
      );
    };

    gpsTimerRef.current = window.setTimeout(() => {
      if (!settled) runFastFallback();
    }, 6500);

    gpsWatchRef.current = navigator.geolocation.watchPosition(
      handlePosition,
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          handleFinalFailure(err);
        }
      },
      { enableHighAccuracy: true, maximumAge: 15000 }
    );

    navigator.geolocation.getCurrentPosition(
      handlePosition,
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          handleFinalFailure(err);
        } else if (!settled) {
          if (gpsTimerRef.current) clearTimeout(gpsTimerRef.current);
          runFastFallback();
        }
      },
      { enableHighAccuracy: true, timeout: 6000, maximumAge: 15000 }
    );
  };

  const requestMicrophone = async () => {
    setMicError(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setMicError('Microphone not available on this device.');
      return;
    }
    setMicLoading(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AudioCtx();
      audioCtxRef.current = ctx;
      await ctx.resume().catch(() => {});
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);

      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      const updateMeter = () => {
        analyser.getByteTimeDomainData(dataArray);
        let maxDev = 0;
        for (let i = 0; i < dataArray.length; i++) {
          const v = Math.abs(dataArray[i] - 128) / 128;
          if (v > maxDev) maxDev = v;
        }
        setMicLevel(Math.min(100, Math.round(maxDev * 250)));
        rafRef.current = requestAnimationFrame(updateMeter);
      };
      updateMeter();

      setMicGranted(true);
      setMicLoading(false);

      const syncPerms = async () => {
        if (gpsData) {
          try {
            await setDoc(
              doc(db, 'guard_users_live', uid),
              {
                userId: uid,
                lat: gpsData.lat,
                lng: gpsData.lng,
                accuracy: gpsData.accuracy,
                address: gpsData.address,
                locationEnabled: true,
                micEnabled: true,
                lastUpdated: serverTimestamp(),
                isOnline: true,
              },
              { merge: true }
            );
          } catch {
            // non-blocking
          }
        }
        try {
          await setDoc(
            doc(db, 'user_permissions', uid),
            {
              userId: uid,
              locationGranted: Boolean(gpsData),
              micGranted: true,
              timestamp: serverTimestamp(),
            },
            { merge: true }
          );
        } catch {
          // non-blocking
        }
      };
      void syncPerms();

      window.setTimeout(() => {
        setStep(3);
      }, 900);
    } catch {
      setMicLoading(false);
      setMicError('Microphone denied. Tap Try Again to allow audio protection.');
    }
  };

  const handleEnter = () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    audioCtxRef.current?.close().catch(() => {});
    try {
      window.sessionStorage.setItem('guard_perm_completed', '1');
    } catch {
      // ignore
    }
    onComplete(gpsData);
  };

  return (
    <div className="min-h-screen bg-[#050B14] flex items-center justify-center p-5">
      <div className="w-full max-w-md bg-[#0C1626] border border-slate-800 rounded-3xl p-6 sm:p-8 shadow-2xl space-y-6">
        <div className="flex items-center justify-between text-xs font-semibold text-slate-400">
          <span>Security Setup</span>
          <span className="font-mono text-[#2E9BFF]">Step {step} of 3</span>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <div className={`h-1.5 rounded-full ${step >= 1 ? 'bg-[#2E9BFF]' : 'bg-slate-800'}`} />
          <div className={`h-1.5 rounded-full ${step >= 2 ? 'bg-[#2E9BFF]' : 'bg-slate-800'}`} />
          <div className={`h-1.5 rounded-full ${step >= 3 ? 'bg-[#00E67A]' : 'bg-slate-800'}`} />
        </div>

        {step === 1 && (
          <div className="space-y-5 text-center">
            <div className="w-16 h-16 mx-auto rounded-2xl bg-[#2E9BFF]/15 border border-[#2E9BFF]/40 flex items-center justify-center text-[#2E9BFF]">
              <MapPin className="w-8 h-8" />
            </div>
            <div className="space-y-2">
              <h2 className="text-xl font-bold text-white">
                Allow Guard AI to use your exact location?
              </h2>
              <p className="text-sm text-slate-400">
                Guard AI uses your device GPS to show your real city &amp; street on the map and warn you about nearby danger. We never guess your city from IP.
              </p>
            </div>
            {locError && (
              <div className="p-3 rounded-xl bg-[#FF2D55]/15 border border-[#FF2D55]/40 text-xs text-[#FF2D55] flex items-center gap-2 text-left">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{locError}</span>
              </div>
            )}
            <button
              type="button"
              onClick={requestLocation}
              disabled={locLoading}
              className="w-full min-h-[48px] py-3.5 px-5 rounded-xl bg-[#2E9BFF] hover:bg-[#1e88eb] text-white font-bold text-sm transition-colors cursor-pointer disabled:opacity-60"
            >
              {locLoading
                ? 'Getting Real GPS...'
                : locError
                ? 'Set My Location'
                : 'Allow Exact Location'}
            </button>
            {locError && (
              <button
                type="button"
                onClick={() => {
                  setLocSkipped(true);
                  setStep(2);
                }}
                className="w-full py-2.5 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold text-xs cursor-pointer"
              >
                Continue as Location Not Set
              </button>
            )}
          </div>
        )}

        {step === 2 && (
          <div className="space-y-5 text-center">
            <div className="w-16 h-16 mx-auto rounded-2xl bg-[#00E67A]/15 border border-[#00E67A]/40 flex items-center justify-center text-[#00E67A]">
              <Mic className="w-8 h-8" />
            </div>
            <div className="space-y-2">
              <h2 className="text-2xl font-bold text-white">Enable Microphone</h2>
              <p className="text-sm text-slate-400">
                Guard AI listens for gunshot and danger sounds. Microphone is only used during Scan.
              </p>
            </div>

            {micGranted && (
              <div className="p-3.5 rounded-xl bg-[#050B14] border border-[#00E67A]/40 space-y-2">
                <div className="flex items-center justify-between text-xs font-semibold text-[#00E67A]">
                  <span>Microphone Connected - Listening...</span>
                  <span className="font-mono tabular-nums">{micLevel}%</span>
                </div>
                <div className="w-full h-2 rounded-full bg-slate-800 overflow-hidden">
                  <div
                    className="h-full bg-[#00E67A] transition-all duration-75"
                    style={{ width: `${micLevel}%` }}
                  />
                </div>
              </div>
            )}

            {micError && (
              <div className="p-3 rounded-xl bg-[#FF2D55]/15 border border-[#FF2D55]/40 text-xs text-[#FF2D55] flex items-center gap-2 text-left">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{micError}</span>
              </div>
            )}

            {!micGranted && (
              <button
                type="button"
                onClick={requestMicrophone}
                disabled={micLoading}
                className="w-full min-h-[48px] py-3.5 px-5 rounded-xl bg-[#00E67A] hover:bg-[#00cf6d] text-slate-950 font-bold text-sm transition-colors cursor-pointer disabled:opacity-60"
              >
                {micLoading ? 'Connecting Microphone...' : micError ? 'Try Again' : 'Enable Microphone'}
              </button>
            )}
          </div>
        )}

        {step === 3 && (
          <div className="space-y-5 text-center">
            <div className="w-16 h-16 mx-auto rounded-2xl bg-[#00E67A]/15 border border-[#00E67A]/40 flex items-center justify-center text-[#00E67A]">
              <ShieldCheck className="w-8 h-8" />
            </div>
            <div className="space-y-2">
              <h2 className="text-2xl font-bold text-white">You Are Protected</h2>
              {gpsData ? (
                <>
                  <p className="text-sm text-slate-300">
                    GPS: <span className="text-[#00E67A] font-semibold">ON</span> •{' '}
                    {gpsData.city ? `${gpsData.city}, ${gpsData.state}` : gpsData.streetName} • Mic:{' '}
                    <span className="text-[#00E67A] font-semibold">ON</span>
                  </p>
                  <p className="text-xs font-mono text-slate-400">
                    Lat: {gpsData.lat.toFixed(5)} • Lng: {gpsData.lng.toFixed(5)} • ±{gpsData.accuracy}m
                  </p>
                </>
              ) : (
                <p className="text-sm text-[#FFC400]">
                  Location: <span className="font-bold">{locSkipped ? 'Location Not Set' : 'Location Not Set'}</span> • Mic:{' '}
                  <span className="text-[#00E67A] font-semibold">ON</span>
                </p>
              )}
            </div>

            <div className="p-3 rounded-xl bg-[#050B14] border border-slate-800 flex items-center gap-2.5 text-left text-xs text-slate-300">
              <CheckCircle2 className="w-4 h-4 text-[#00E67A] shrink-0" />
              <span>
                {gpsData
                  ? 'Real GPS & Microphone verified and synced to Guard AI.'
                  : 'You can tap "Set My Location" anytime on Home or Profile.'}
              </span>
            </div>

            <button
              type="button"
              onClick={handleEnter}
              className="w-full min-h-[48px] py-3.5 px-5 rounded-xl bg-[#2E9BFF] hover:bg-[#1e88eb] text-white font-bold text-sm transition-colors cursor-pointer"
            >
              Enter Guard AI
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
