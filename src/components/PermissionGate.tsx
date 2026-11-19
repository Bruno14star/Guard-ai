import React, { useEffect, useRef, useState } from 'react';
import { doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { MapPin, Mic, ShieldCheck, AlertCircle, CheckCircle2 } from 'lucide-react';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { reverseGeocodeHuman } from '../utils/geoPhysics';

interface PermissionGateProps {
  uid: string;
  onComplete: (initialGps: {
    lat: number;
    lng: number;
    accuracy: number;
    address: string;
    streetName: string;
    area: string;
    city: string;
    state: string;
    landmark: string;
  }) => void;
}

export const PermissionGate: React.FC<PermissionGateProps> = ({ uid, onComplete }) => {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [locError, setLocError] = useState<string | null>(null);
  const [locLoading, setLocLoading] = useState(false);
  const [gpsData, setGpsData] = useState<{
    lat: number;
    lng: number;
    accuracy: number;
    address: string;
    streetName: string;
    area: string;
    city: string;
    state: string;
    landmark: string;
  } | null>(null);

  const [micError, setMicError] = useState<string | null>(null);
  const [micLoading, setMicLoading] = useState(false);
  const [micGranted, setMicGranted] = useState(false);
  const [micLevel, setMicLevel] = useState(0);

  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      audioCtxRef.current?.close().catch(() => {});
    };
  }, []);

  const requestLocation = () => {
    setLocError(null);
    if (!navigator.geolocation) {
      setLocError('GPS not available on this device.');
      return;
    }
    setLocLoading(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude, longitude, accuracy } = pos.coords;
        const geo = await reverseGeocodeHuman(latitude, longitude);
        setGpsData({
          lat: latitude,
          lng: longitude,
          accuracy: Math.round(accuracy),
          address: geo.formattedAddress,
          streetName: geo.streetName,
          area: geo.area,
          city: geo.city,
          state: geo.state,
          landmark: geo.landmark,
        });
        setLocLoading(false);
        setStep(2);
      },
      (err) => {
        setLocLoading(false);
        if (err.code === err.PERMISSION_DENIED) {
          setLocError('Location denied. Guard AI cannot work without location.');
        } else {
          setLocError('GPS signal unavailable. Please enable device Location and try again.');
        }
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
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

      // Save live permissions & live location to Firestore immediately
      if (gpsData) {
        // COLLECTION: guard_users_live
        try {
          await setDoc(
            doc(db, 'guard_users_live', uid),
            {
              userId: uid,
              lat: gpsData.lat,
              lng: gpsData.lng,
              accuracy: gpsData.accuracy,
              locationEnabled: true,
              micEnabled: true,
              lastUpdated: serverTimestamp(),
              isOnline: true,
            },
            { merge: true }
          );
        } catch (err) {
          handleFirestoreError(err, OperationType.WRITE, `guard_users_live/${uid}`);
        }

        // COLLECTION: user_permissions
        try {
          await setDoc(
            doc(db, 'user_permissions', uid),
            {
              userId: uid,
              locationGranted: true,
              micGranted: true,
              timestamp: serverTimestamp(),
            },
            { merge: true }
          );
        } catch (err) {
          handleFirestoreError(err, OperationType.WRITE, `user_permissions/${uid}`);
        }
      }

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
    if (gpsData) {
      onComplete(gpsData);
    }
  };

  return (
    <div className="min-h-screen bg-[#050B14] flex items-center justify-center p-5">
      <div className="w-full max-w-md bg-[#0C1626] border border-slate-800 rounded-3xl p-6 sm:p-8 shadow-2xl space-y-6">
        {/* Step Progress */}
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
              <h2 className="text-2xl font-bold text-white">Enable Location</h2>
              <p className="text-sm text-slate-400">
                Guard AI needs your live location to warn you about danger near you and to show you on the map.
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
              {locLoading ? 'Getting Real GPS...' : locError ? 'Try Again' : 'Enable Location'}
            </button>
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

        {step === 3 && gpsData && (
          <div className="space-y-5 text-center">
            <div className="w-16 h-16 mx-auto rounded-2xl bg-[#00E67A]/15 border border-[#00E67A]/40 flex items-center justify-center text-[#00E67A]">
              <ShieldCheck className="w-8 h-8" />
            </div>
            <div className="space-y-2">
              <h2 className="text-2xl font-bold text-white">You Are Protected</h2>
              <p className="text-sm text-slate-300">
                GPS: <span className="text-[#00E67A] font-semibold">ON</span> •{' '}
                {gpsData.streetName}, {gpsData.city} • Mic:{' '}
                <span className="text-[#00E67A] font-semibold">ON</span>
              </p>
              <p className="text-xs font-mono text-slate-400">
                Lat: {gpsData.lat.toFixed(5)} • Lng: {gpsData.lng.toFixed(5)} • ±{gpsData.accuracy}m
              </p>
            </div>

            <div className="p-3 rounded-xl bg-[#050B14] border border-slate-800 flex items-center gap-2.5 text-left text-xs text-slate-300">
              <CheckCircle2 className="w-4 h-4 text-[#00E67A] shrink-0" />
              <span>Real GPS &amp; Microphone verified and synced to Guard AI.</span>
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
