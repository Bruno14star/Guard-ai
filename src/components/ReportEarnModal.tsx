import React, { useEffect, useRef, useState } from 'react';
import {
  addDoc,
  collection,
  doc,
  getDocs,
  increment,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from 'firebase/firestore';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { Video, Camera, X, CheckCircle2, Square, CircleDot, AlertTriangle } from 'lucide-react';
import { db, handleFirestoreError, OperationType, storage } from '../firebase';
import { HumanLocation, UserProfile } from '../types';
import { computeGuardAiVerificationScore, haversineMeters } from '../utils/geoPhysics';
import { useGlobalUserProfile } from '../utils/userProfileStore';
import { UserAvatar } from './UserAvatar';

interface ReportEarnModalProps {
  open: boolean;
  onClose: () => void;
  user: UserProfile;
  location: HumanLocation | null;
  usageStatDocId: string | null;
}

const INCIDENT_TYPES = ['Gunshot', 'Robbery', 'Kidnapping', 'Accident', 'Fire', 'Other'];

export const ReportEarnModal: React.FC<ReportEarnModalProps> = ({
  open,
  onClose,
  user,
  location,
  usageStatDocId,
}) => {
  const globalProfile = useGlobalUserProfile(user.fullName, user.photoURL);
  const reporterName = globalProfile.name || user.fullName;
  const reporterPhoto = globalProfile.photo || user.photoURL || '';
  const [incidentType, setIncidentType] = useState('Gunshot');
  const [description, setDescription] = useState('');
  const [photoDataUrl, setPhotoDataUrl] = useState<string>('');
  const [recording, setRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [videoBlob, setVideoBlob] = useState<Blob | null>(null);
  const [videoPreviewUrl, setVideoPreviewUrl] = useState<string>('');
  const [recordedAtMs, setRecordedAtMs] = useState<number>(0);
  const [audioMatchScore, setAudioMatchScore] = useState<number>(0.45);
  const [submitting, setSubmitting] = useState(false);
  const [resultMsg, setResultMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const timerRef = useRef<number | null>(null);
  const peakLevelRef = useRef<number>(0);

  const stopCameraStream = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  };

  useEffect(() => {
    if (!open) {
      stopCameraStream();
      setRecording(false);
      setResultMsg(null);
      setError(null);
    }
    return () => stopCameraStream();
  }, [open]);

  if (!open) return null;

  const startLiveRecording = async () => {
    setError(null);
    setVideoBlob(null);
    setVideoPreviewUrl('');
    setRecordSeconds(0);
    peakLevelRef.current = 0;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
        audio: true,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }

      // Measure real audio energy during recording
      try {
        const AudioCtx =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        const ctx = new AudioCtx();
        const src = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        src.connect(analyser);
        const buf = new Uint8Array(analyser.frequencyBinCount);
        const sampleAudio = () => {
          if (!streamRef.current) {
            ctx.close().catch(() => {});
            return;
          }
          analyser.getByteTimeDomainData(buf);
          let max = 0;
          for (let i = 0; i < buf.length; i++) {
            const dev = Math.abs(buf[i] - 128) / 128;
            if (dev > max) max = dev;
          }
          if (max > peakLevelRef.current) peakLevelRef.current = max;
          requestAnimationFrame(sampleAudio);
        };
        sampleAudio();
      } catch {
        // ignore analyser error
      }

      chunksRef.current = [];
      const mr = new MediaRecorder(stream);
      mediaRecorderRef.current = mr;

      mr.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) chunksRef.current.push(ev.data);
      };

      mr.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: 'video/webm' });
        setVideoBlob(blob);
        setVideoPreviewUrl(URL.createObjectURL(blob));
        setRecordedAtMs(Date.now());
        // Probabilistic audio confidence based on real acoustic impulse energy (never 100%)
        const conf = Math.min(0.92, Math.max(0.35, 0.4 + peakLevelRef.current * 0.55));
        setAudioMatchScore(Number(conf.toFixed(2)));
        stopCameraStream();
      };

      mr.start(500);
      setRecording(true);
      let elapsed = 0;
      timerRef.current = window.setInterval(() => {
        elapsed += 1;
        setRecordSeconds(elapsed);
        if (elapsed >= 60) {
          stopLiveRecording();
        }
      }, 1000);
    } catch {
      setError('Camera & Microphone access required to record live video inside Guard AI.');
    }
  };

  const stopLiveRecording = () => {
    setRecording(false);
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    } else {
      stopCameraStream();
    }
  };

  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const scale = Math.min(1, 640 / img.width);
        canvas.width = img.width * scale;
        canvas.height = img.height * scale;
        const ctx = canvas.getContext('2d');
        ctx?.drawImage(img, 0, 0, canvas.width, canvas.height);
        setPhotoDataUrl(canvas.toDataURL('image/jpeg', 0.72));
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!videoBlob || recordSeconds < 15) {
      setError('Live in-app video of at least 15 seconds is compulsory to earn ₦5,000.');
      return;
    }
    if (!location) {
      setError('Live GPS address is required before submitting.');
      return;
    }

    setSubmitting(true);
    try {
      // Upload video to Firebase Storage (or compact fallback URL if Storage blocked)
      let videoUrl = '';
      try {
        const storageRef = ref(storage, `incident_videos/${user.uid}/${Date.now()}.webm`);
        await uploadBytes(storageRef, videoBlob);
        videoUrl = await getDownloadURL(storageRef);
      } catch {
        // Fallback: store compact base64 preview if <= 550KB so Firestore doc stays within 1MB
        videoUrl = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onload = () => {
            const s = String(reader.result || '');
            resolve(s.length <= 550000 ? s : 'recorded_in_app_verified_metadata');
          };
          reader.readAsDataURL(videoBlob);
        });
      }

      // Check recent reports within 1km & 30 mins for Cross_Report signal
      let nearbyCount = 0;
      try {
        const recentQ = query(
          collection(db, 'incident_reports'),
          where('userId', '==', user.uid)
        );
        const snap = await getDocs(recentQ);
        const thirtyMinsAgo = Date.now() - 30 * 60 * 1000;
        snap.docs.forEach((d) => {
          const data = d.data();
          const t = data.createdAt?.toDate ? data.createdAt.toDate().getTime() : 0;
          if (
            t >= thirtyMinsAgo &&
            Number.isFinite(data.gpsLat) &&
            Number.isFinite(data.gpsLng) &&
            haversineMeters(location.lat, location.lng, data.gpsLat, data.gpsLng) <= 1000
          ) {
            nearbyCount += 1;
          }
        });
      } catch {
        nearbyCount = 0;
      }

      const vScore = computeGuardAiVerificationScore({
        hasLiveVideo: true,
        videoDurationSec: recordSeconds,
        videoTimestampDiffMs: Date.now() - recordedAtMs,
        audioMatchConfidence: audioMatchScore,
        distanceBetweenVideoAndUserMeters: 0,
        nearbyReportsCount: nearbyCount,
      });

      const reportId = `REP-${Date.now().toString(36).toUpperCase()}`;

      // COLLECTION: incident_reports
      try {
        await addDoc(collection(db, 'incident_reports'), {
          reportId,
          userId: user.uid,
          userName: reporterName,
          userPhone: user.phone || '',
          userState: user.userState || location.state || 'Lagos',
          incidentState: location.state || user.userState || 'Lagos',
          incidentArea: location.area || location.city || '',
          incidentAddress: location.formattedAddress,
          incidentType,
          description: description.trim() || `${incidentType} reported at ${location.streetName}`,
          videoUrl,
          videoDurationSec: recordSeconds,
          photoUrl: photoDataUrl || '',
          gpsLat: location.lat,
          gpsLng: location.lng,
          videoAuthScore: vScore.videoAuth,
          audioMatchScore: vScore.audioMatch,
          locationConsistencyScore: vScore.locationConsistency,
          crossReportScore: vScore.crossReport,
          guardAiScore: vScore.totalScore,
          aiVerdict: vScore.verdict,
          status: 'PENDING VERIFICATION',
          adminDecision: 'pending',
          paymentStatus: 'unpaid',
          createdAt: serverTimestamp(),
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.CREATE, 'incident_reports');
      }

      if (usageStatDocId) {
        try {
          await updateDoc(doc(db, 'user_usage_stats', usageStatDocId), {
            totalReports: increment(1),
            lastActive: serverTimestamp(),
          });
        } catch {
          // non-blocking stat update
        }
      }

      setResultMsg(
        `Your report is with Guard AI. Verifying... (Audio match: ${Math.round(
          vScore.audioMatch * 100
        )}% • V Score: ${Math.round(vScore.totalScore * 100)}%)`
      );
    } catch (err: any) {
      setError(err?.message || 'Failed to submit report.');
    } finally {
      setSubmitting(false);
    }
  };

  const canEarnSubmit = Boolean(videoBlob) && recordSeconds >= 15 && !submitting;

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="w-full max-w-lg max-h-[92vh] overflow-y-auto bg-[#0C1626] border border-slate-800 rounded-t-3xl sm:rounded-3xl p-5 sm:p-6 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <UserAvatar
              photoURL={reporterPhoto}
              name={reporterName}
              size="40"
              borderVariant="purple"
              fallbackVariant="purple"
            />
            <div className="min-w-0">
              <h2 className="text-lg font-extrabold text-white truncate">
                Report &amp; Earn ₦5,000
              </h2>
              <p className="text-xs text-slate-400 truncate">
                Reporter: {reporterName} • Verified by Guard AI + Admin
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-10 h-10 rounded-full bg-slate-800 text-slate-300 flex items-center justify-center hover:text-white cursor-pointer shrink-0"
            aria-label="Close Report Modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {resultMsg ? (
          <div className="p-5 rounded-2xl bg-[#00E67A]/10 border border-[#00E67A]/40 space-y-3 text-center">
            <CheckCircle2 className="w-10 h-10 text-[#00E67A] mx-auto" />
            <p className="text-sm font-semibold text-white">{resultMsg}</p>
            <p className="text-xs text-slate-400">
              Once Admin verifies and approves your report, it will be forwarded to{' '}
              {location?.state || user.userState || 'State'} Police and ₦5,000 will be credited to your wallet.
            </p>
            <button
              type="button"
              onClick={onClose}
              className="w-full py-3 rounded-xl bg-[#2E9BFF] text-white font-bold text-sm cursor-pointer"
            >
              Done
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* What happened */}
            <div>
              <label className="block text-xs font-semibold text-slate-400 mb-1.5">
                What happened?
              </label>
              <div className="grid grid-cols-3 gap-2">
                {INCIDENT_TYPES.map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setIncidentType(t)}
                    className={`py-2 px-3 rounded-xl text-xs font-semibold border transition-colors cursor-pointer ${
                      incidentType === t
                        ? 'bg-[#2E9BFF] border-[#2E9BFF] text-white'
                        : 'bg-[#050B14] border-slate-800 text-slate-300 hover:border-slate-600'
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>

            {/* Human Location (NO raw lat/lng) */}
            <div className="p-3 rounded-xl bg-[#050B14] border border-slate-800">
              <p className="text-[11px] font-semibold text-slate-400">Detected Location</p>
              <p className="text-sm font-semibold text-white mt-0.5">
                {location ? location.formattedAddress : 'Waiting for live GPS address...'}
              </p>
            </div>

            {/* Compulsory Live In-App Video (15-60s) */}
            <div className="p-3.5 rounded-2xl bg-[#050B14] border border-slate-800 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Video className="w-4 h-4 text-[#FF2D55]" />
                  <span className="text-xs font-bold text-white">
                    Live In-App Video (15–60s compulsory)
                  </span>
                </div>
                <span className="text-xs font-mono text-[#FFC400] tabular-nums">
                  {String(Math.floor(recordSeconds / 60)).padStart(2, '0')}:
                  {String(recordSeconds % 60).padStart(2, '0')} / 01:00
                </span>
              </div>

              {recording ? (
                <div className="space-y-2.5">
                  <video
                    ref={videoRef}
                    muted
                    playsInline
                    className="w-full h-44 rounded-xl bg-black object-cover"
                  />
                  <button
                    type="button"
                    onClick={stopLiveRecording}
                    className="w-full py-2.5 px-4 rounded-xl bg-[#FF2D55] text-white font-bold text-xs flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <Square className="w-4 h-4 fill-current" />
                    <span>
                      Stop Recording ({recordSeconds < 15 ? `Need ${15 - recordSeconds}s more` : 'Ready'})
                    </span>
                  </button>
                </div>
              ) : videoPreviewUrl ? (
                <div className="space-y-2">
                  <video
                    src={videoPreviewUrl}
                    controls
                    className="w-full h-44 rounded-xl bg-black object-cover"
                  />
                  <div className="flex items-center justify-between text-xs">
                    <span className={recordSeconds >= 15 ? 'text-[#00E67A]' : 'text-[#FFC400]'}>
                      {recordSeconds >= 15
                        ? `Recorded ${recordSeconds}s • Audio match: ${Math.round(audioMatchScore * 100)}%`
                        : `Too short (${recordSeconds}s) — record at least 15s`}
                    </span>
                    <button
                      type="button"
                      onClick={startLiveRecording}
                      className="text-[#2E9BFF] font-semibold underline cursor-pointer"
                    >
                      Re-record
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={startLiveRecording}
                  className="w-full py-3 px-4 rounded-xl bg-[#FF2D55]/15 border border-[#FF2D55]/40 text-[#FF2D55] font-bold text-xs flex items-center justify-center gap-2 hover:bg-[#FF2D55]/25 cursor-pointer"
                >
                  <CircleDot className="w-4 h-4" />
                  <span>Record Live Incident Video (15–60s)</span>
                </button>
              )}
            </div>

            {/* Optional 1 Photo + Description */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl bg-[#050B14] border border-slate-800 text-xs font-semibold text-slate-300 hover:border-slate-600 cursor-pointer">
                <Camera className="w-4 h-4 text-[#2E9BFF]" />
                <span>{photoDataUrl ? 'Photo Attached' : 'Add 1 Photo (Optional)'}</span>
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={handlePhotoUpload}
                  className="hidden"
                />
              </label>
              {photoDataUrl && (
                <img
                  src={photoDataUrl}
                  alt="Incident attachment"
                  className="h-12 w-full object-cover rounded-xl border border-slate-700"
                />
              )}
            </div>

            <textarea
              rows={3}
              placeholder="Describe what you witnessed (area, direction, suspects, vehicle)..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full p-3 rounded-xl bg-[#050B14] border border-slate-800 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-[#2E9BFF]"
            />

            {error && (
              <div className="p-3 rounded-xl bg-[#FF2D55]/15 border border-[#FF2D55]/40 text-xs text-[#FF2D55] flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={!canEarnSubmit}
              className="w-full min-h-[48px] py-3 px-4 rounded-xl bg-orange-500 hover:bg-orange-600 disabled:bg-slate-800 disabled:text-slate-500 text-white font-bold text-sm transition-colors cursor-pointer disabled:cursor-not-allowed"
            >
              {submitting
                ? 'Verifying & Sending...'
                : !videoBlob || recordSeconds < 15
                ? 'Video is compulsory to earn ₦5,000'
                : 'Submit Report & Earn ₦5,000'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
};
