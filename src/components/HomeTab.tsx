import React, { useEffect, useRef, useState } from 'react';
import {
  addDoc,
  collection,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from 'firebase/firestore';
import {
  ShieldCheck,
  MapPin,
  Radio,
  Car,
  Building2,
  Moon,
  Heart,
  Share2,
  MessageCircle,
  Send,
  AlertOctagon,
  Award,
  Flame,
  Sparkles,
  PhoneCall,
  X,
} from 'lucide-react';
import { db, handleFirestoreError, OperationType } from '../firebase';
import {
  HomeVideo,
  HumanLocation,
  PlanType,
  PublicProfile,
  ScannerSubTab,
  UserProfile,
  UserUsageStat,
} from '../types';
import { findNearestSafePlaceFree, getWatMonthKey } from '../utils/geoPhysics';
import { useGlobalUserProfile } from '../utils/userProfileStore';
import { GuardMap } from './GuardMap';
import { UserAvatar } from './UserAvatar';
import { AdBanner } from './AdBanner';

interface HomeTabProps {
  user: UserProfile;
  location: HumanLocation | null;
  scansToday: number;
  activePlan: PlanType;
  usageStatDocId: string | null;
  onRefreshLocation: (lat: number, lng: number, accuracy: number) => void;
  onNavigateScanner: (sub: ScannerSubTab) => void;
  onOpenReportModal: () => void;
  onOpenProfile: (uid: string) => void;
  openSosSignal?: number;
}

interface CommentItem {
  id: string;
  videoId: string;
  userId: string;
  userName: string;
  text: string;
}

export const HomeTab: React.FC<HomeTabProps> = ({
  user,
  location,
  scansToday,
  activePlan,
  onRefreshLocation,
  onNavigateScanner,
  onOpenReportModal,
  onOpenProfile,
  openSosSignal,
}) => {
  const globalProfile = useGlobalUserProfile(user.fullName, user.photoURL);
  const displayName = globalProfile.name || user.fullName;
  const displayPhoto = globalProfile.photo || user.photoURL || '';
  const [sansaTips, setSansaTips] = useState<{ id: string; message: string; title?: string }[]>([]);
  const [goodWishBanner, setGoodWishBanner] = useState<string | null>(null);
  const [homeVideos, setHomeVideos] = useState<HomeVideo[]>([]);
  const [topTrusted, setTopTrusted] = useState<PublicProfile[]>([]);
  const [topReporters, setTopReporters] = useState<UserUsageStat[]>([]);
  const [openCommentsFor, setOpenCommentsFor] = useState<string | null>(null);
  const [comments, setComments] = useState<CommentItem[]>([]);
  const [commentInput, setCommentInput] = useState('');
  const [sosOpen, setSosOpen] = useState(false);
  const [sosDispatching, setSosDispatching] = useState(false);
  const [sosSafePlaceName, setSosSafePlaceName] = useState<string>('Nearest Public Safe Place');
  const [sosSentConfirmation, setSosSentConfirmation] = useState(false);
  const viewIncrementedRef = useRef<Set<string>>(new Set());

  // 1. Live Daily Tip from Sansa (sansa_memory where isPublicTip == true)
  useEffect(() => {
    const q = query(collection(db, 'sansa_memory'), where('isPublicTip', '==', true), limit(5));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const list = snap.docs.map((d) => ({
          id: d.id,
          message: String(d.data().message || d.data().tip || ''),
          title: d.data().title ? String(d.data().title) : undefined,
        }));
        setSansaTips(list.filter((t) => t.message));
      },
      (err) => {
        console.warn('Sansa tip listener:', err.message);
      }
    );
    return () => unsub();
  }, []);

  // 2. Live Broadcast / Good Wish notification
  useEffect(() => {
    const q = query(collection(db, 'notifications'), where('targetAll', '==', true), limit(5));
    const unsub = onSnapshot(
      q,
      (snap) => {
        if (snap.empty) {
          setGoodWishBanner(null);
          return;
        }
        const sorted = [...snap.docs].sort((a, b) => {
          const ta = a.data().createdAt?.toMillis ? a.data().createdAt.toMillis() : 0;
          const tb = b.data().createdAt?.toMillis ? b.data().createdAt.toMillis() : 0;
          return tb - ta;
        });
        const top = sorted[0]?.data();
        setGoodWishBanner(top?.message ? String(top.message) : null);
      },
      () => {}
    );
    return () => unsub();
  }, []);

  // 3. Verified By Guard AI - Real Videos (home_videos)
  useEffect(() => {
    const q = query(collection(db, 'home_videos'), orderBy('verifiedAt', 'desc'), limit(20));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const list: HomeVideo[] = snap.docs.map((d) => {
          const data = d.data();
          return {
            id: d.id,
            reportId: data.reportId || d.id,
            userId: data.userId || '',
            userName: data.userName || 'Verified User',
            userProfilePic: data.userProfilePic || '',
            videoUrl: data.videoUrl || '',
            incidentType: data.incidentType || 'Incident',
            incidentState: data.incidentState || '',
            incidentArea: data.incidentArea || '',
            incidentAddress: data.incidentAddress || '',
            views: Number(data.views || 0),
            likes: Number(data.likes || 0),
            likedBy: Array.isArray(data.likedBy) ? data.likedBy : [],
            verifiedAt: data.verifiedAt,
          };
        });
        setHomeVideos(list);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'home_videos')
    );
    return () => unsub();
  }, []);

  // 4. Top 5 Users - Most Trusted (from public_profiles)
  useEffect(() => {
    const q = query(collection(db, 'public_profiles'), orderBy('trust_score', 'desc'), limit(5));
    const unsub = onSnapshot(
      q,
      (snap) => {
        setTopTrusted(snap.docs.map((d) => d.data() as PublicProfile));
      },
      () => {}
    );
    return () => unsub();
  }, []);

  // 5. Top 5 Reporters - Most Verified Reports this month (from user_usage_stats)
  useEffect(() => {
    const currentMonth = getWatMonthKey();
    const q = query(
      collection(db, 'user_usage_stats'),
      where('month', '==', currentMonth)
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const list = snap.docs
          .map((d) => ({ id: d.id, ...(d.data() as Omit<UserUsageStat, 'id'>) }))
          .filter((u) => !u.cheatingFlagged && u.verifiedReports > 0)
          .sort((a, b) => b.verifiedReports - a.verifiedReports)
          .slice(0, 5);
        setTopReporters(list);
      },
      () => {}
    );
    return () => unsub();
  }, []);

  // 6. Live comments for opened video
  useEffect(() => {
    if (!openCommentsFor) return;
    const q = query(
      collection(db, 'report_comments'),
      where('videoId', '==', openCommentsFor)
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const sorted = [...snap.docs].sort((a, b) => {
          const ta = a.data().createdAt?.toMillis ? a.data().createdAt.toMillis() : 0;
          const tb = b.data().createdAt?.toMillis ? b.data().createdAt.toMillis() : 0;
          return ta - tb;
        });
        setComments(
          sorted.map((d) => ({
            id: d.id,
            videoId: String(d.data().videoId || ''),
            userId: String(d.data().userId || ''),
            userName: String(d.data().userName || 'User'),
            text: String(d.data().text || ''),
          }))
        );
      },
      () => {}
    );
    return () => unsub();
  }, [openCommentsFor]);

  const handleToggleLike = async (vid: HomeVideo) => {
    const likedBy = Array.isArray(vid.likedBy) ? vid.likedBy : [];
    const already = likedBy.includes(user.uid);
    const nextLikedBy = already
      ? likedBy.filter((id) => id !== user.uid)
      : [...likedBy, user.uid];
    try {
      await updateDoc(doc(db, 'home_videos', vid.id), {
        likedBy: nextLikedBy,
        likes: nextLikedBy.length,
      });
    } catch (err) {
      console.error('Like update failed:', err);
    }
  };

  const handleVideoPlay = async (vid: HomeVideo) => {
    if (viewIncrementedRef.current.has(vid.id)) return;
    viewIncrementedRef.current.add(vid.id);
    try {
      await updateDoc(doc(db, 'home_videos', vid.id), {
        views: (vid.views || 0) + 1,
      });
    } catch {
      // ignore non-critical view count failure
    }
  };

  const handleShareVideo = async (vid: HomeVideo) => {
    const text = `Guard AI Verified Alert (${vid.incidentType}) at ${vid.incidentAddress}. Stay safe!`;
    if (navigator.share) {
      await navigator.share({ title: 'Guard AI Verified Video', text }).catch(() => {});
    } else if (navigator.clipboard) {
      await navigator.clipboard.writeText(text).catch(() => {});
    }
  };

  const handleAddComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!openCommentsFor || !commentInput.trim()) return;
    try {
      await addDoc(collection(db, 'report_comments'), {
        videoId: openCommentsFor,
        userId: user.uid,
        userName: user.fullName,
        text: commentInput.trim().slice(0, 500),
        createdAt: serverTimestamp(),
      });
      setCommentInput('');
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'report_comments');
    }
  };

  const handleTriggerSos = async () => {
    setSosOpen(true);
    setSosDispatching(true);
    setSosSentConfirmation(false);

    // 1. Lookup nearest real safe building using free OpenStreetMap Overpass API
    if (location) {
      const placeName = await findNearestSafePlaceFree(location.lat, location.lng);
      setSosSafePlaceName(placeName);
    }

    // 2. Write real SOS incident report for Admin + Police dispatch
    if (location) {
      try {
        await addDoc(collection(db, 'incident_reports'), {
          reportId: `SOS-${Date.now().toString(36).toUpperCase()}`,
          userId: user.uid,
          userName: user.fullName,
          userPhone: user.phone || '',
          userState: user.userState || location.state || 'Lagos',
          incidentState: location.state || user.userState || 'Lagos',
          incidentArea: location.area || location.city || '',
          incidentAddress: location.formattedAddress,
          incidentType: 'SOS Emergency',
          description: `LIVE SOS triggered by ${user.fullName} while ${location.movementMode} at ${location.formattedAddress}`,
          gpsLat: location.lat,
          gpsLng: location.lng,
          guardAiScore: 0.9,
          aiVerdict: 'LIKELY TRUE',
          status: 'PENDING VERIFICATION',
          adminDecision: 'pending',
          paymentStatus: 'unpaid',
          createdAt: serverTimestamp(),
        });
        setSosSentConfirmation(true);
      } catch (err) {
        console.error('SOS write failed:', err);
      }
    }
    setSosDispatching(false);
  };

  useEffect(() => {
    if (openSosSignal && openSosSignal > 0) {
      void handleTriggerSos();
    }
  }, [openSosSignal]);

  const scanCapLabel = activePlan === 'Free' ? `${scansToday} / 2` : `${scansToday} / Unlimited`;

  return (
    <div className="flex flex-col min-h-full">
      <div className="flex-1 px-4 py-4 space-y-4 max-w-2xl mx-auto w-full">
        {/* Good Wish / Admin Broadcast */}
        {goodWishBanner && (
          <div className="p-3 rounded-2xl bg-[#00E67A]/10 border border-[#00E67A]/35 flex items-center gap-2.5">
            <Sparkles className="w-4 h-4 text-[#00E67A] shrink-0" />
            <p className="text-xs font-medium text-slate-100">{goodWishBanner}</p>
          </div>
        )}

        {/* Top Welcome Header: 40px Round Global Picture + "Hello, [Name]" */}
        <div className="flex items-center justify-between gap-3 px-1">
          <button
            type="button"
            onClick={() => onOpenProfile(user.uid)}
            className="flex items-center gap-3 min-w-0 text-left cursor-pointer"
          >
            <UserAvatar
              photoURL={displayPhoto}
              name={displayName}
              size="40"
              borderVariant="purple"
              fallbackVariant="purple"
            />
            <div className="min-w-0">
              <p className="text-base font-extrabold text-white truncate">
                Hello, {displayName}
              </p>
              <p className="text-[11px] text-[#00E67A] font-semibold truncate">
                Protected • {activePlan} Plan
              </p>
            </div>
          </button>
        </div>

        {/* Top Safety Score & Streak Card */}
        <div
          data-tutorial-target="safety-score-card"
          className="bg-[#0C1626] border border-slate-800 rounded-2xl p-4 space-y-3"
        >
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <UserAvatar
                photoURL={displayPhoto}
                name={displayName}
                size="md"
                borderVariant="purple"
                fallbackVariant="purple"
              />
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4 text-[#00E67A] shrink-0" />
                  <h1 className="text-base font-extrabold text-white truncate">
                    You Are Protected
                  </h1>
                </div>
                <p className="text-xs text-slate-400 truncate">
                  {displayName} • {activePlan} Plan
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <div className="px-2.5 py-1.5 rounded-xl bg-[#050B14] border border-slate-800 text-center">
                <p className="text-xs font-bold font-mono text-[#00E67A] tabular-nums">
                  {user.safetyScore ?? 100}
                </p>
                <p className="text-[10px] text-slate-400">Safety</p>
              </div>
              <div className="px-2.5 py-1.5 rounded-xl bg-[#050B14] border border-slate-800 text-center">
                <p className="text-xs font-bold font-mono text-[#FFC400] tabular-nums flex items-center justify-center gap-0.5">
                  <Flame className="w-3 h-3" />
                  {user.streak ?? 1}
                </p>
                <p className="text-[10px] text-slate-400">Streak</p>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between text-xs pt-2 border-t border-slate-800/80">
            <span className="text-slate-400">Scans Today</span>
            <span
              className={`font-mono font-bold tabular-nums ${
                activePlan === 'Free' && scansToday >= 2 ? 'text-[#FF2D55]' : 'text-[#2E9BFF]'
              }`}
            >
              {scanCapLabel}
            </span>
          </div>
        </div>

        {/* Live Location Card: Real Nominatim Street Name + Lat/Lng/Accuracy */}
        <div className="bg-[#0C1626] border border-slate-800 rounded-2xl p-4 space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-[#2E9BFF] flex items-center gap-1.5">
              <MapPin className="w-3.5 h-3.5" />
              Live Location
            </span>
            <span className="text-[11px] font-semibold px-2 py-0.5 rounded-md bg-slate-800 text-slate-200">
              {location?.movementMode || 'Walking'}
            </span>
          </div>
          <p className="text-sm font-bold text-white">
            {location ? `You are at: ${location.formattedAddress}` : 'Waiting for live GPS signal...'}
          </p>
          {location && (
            <p className="text-xs font-mono text-slate-400">
              Lat: {location.lat.toFixed(5)}, Lng: {location.lng.toFixed(5)} • Accuracy: {location.accuracy} meters
            </p>
          )}
        </div>

        {/* Tall Map with Profile Photo & Refresh Map Button */}
        <GuardMap
          userLat={location?.lat ?? null}
          userLng={location?.lng ?? null}
          userName={displayName}
          userPhotoURL={displayPhoto}
          addressLabel={location?.formattedAddress || null}
          movementMode={location?.movementMode || 'Walking'}
          onRefreshLocation={onRefreshLocation}
          heightClassName="h-[360px]"
        />

        {/* Big Red SOS Button */}
        <button
          type="button"
          data-tutorial-target="sos-button"
          onClick={handleTriggerSos}
          className="w-full min-h-[56px] rounded-2xl bg-[#FF2D55] hover:bg-[#e6254b] text-white font-extrabold text-base shadow-lg shadow-[#FF2D55]/25 flex items-center justify-center gap-2.5 transition-transform active:scale-[0.98] cursor-pointer"
        >
          <AlertOctagon className="w-6 h-6" />
          <span>SOS EMERGENCY</span>
        </button>

        {/* Quick 4 Scanner Buttons */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          <button
            type="button"
            onClick={() => onNavigateScanner('road')}
            className="p-3 rounded-2xl bg-[#0C1626] border border-slate-800 hover:border-[#00E67A]/50 flex flex-col items-center gap-1.5 text-xs font-bold text-white cursor-pointer"
          >
            <Radio className="w-5 h-5 text-[#00E67A]" />
            <span>Scan Road</span>
          </button>
          <button
            type="button"
            onClick={() => onNavigateScanner('vehicle')}
            className="p-3 rounded-2xl bg-[#0C1626] border border-slate-800 hover:border-[#2E9BFF]/50 flex flex-col items-center gap-1.5 text-xs font-bold text-white cursor-pointer"
          >
            <Car className="w-5 h-5 text-[#2E9BFF]" />
            <span>Scan Vehicle</span>
          </button>
          <button
            type="button"
            onClick={() => onNavigateScanner('building')}
            className="p-3 rounded-2xl bg-[#0C1626] border border-slate-800 hover:border-[#FFC400]/50 flex flex-col items-center gap-1.5 text-xs font-bold text-white cursor-pointer"
          >
            <Building2 className="w-5 h-5 text-[#FFC400]" />
            <span>Scan Building</span>
          </button>
          <button
            type="button"
            onClick={() => onNavigateScanner('night_watch')}
            className="p-3 rounded-2xl bg-[#0C1626] border border-slate-800 hover:border-[#FF2D55]/50 flex flex-col items-center gap-1.5 text-xs font-bold text-white cursor-pointer"
          >
            <Moon className="w-5 h-5 text-[#FF2D55]" />
            <span>Night Watch</span>
          </button>
        </div>

        {/* Report & Earn ₦5,000 Button */}
        <button
          type="button"
          onClick={onOpenReportModal}
          className="w-full min-h-[48px] py-3 px-4 rounded-2xl bg-orange-500 hover:bg-orange-600 text-white font-extrabold text-sm shadow-lg cursor-pointer"
        >
          Report &amp; Earn ₦5,000
        </button>

        {/* Daily Tip from Sansa */}
        <div className="bg-[#0C1626] border border-slate-800 rounded-2xl p-4 space-y-2">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-[#00E67A]" />
            <h2 className="text-sm font-bold text-white">Daily Tip from Sansa</h2>
          </div>
          {sansaTips.length === 0 ? (
            <p className="text-xs text-slate-400">
              No live tips published yet. Stay alert on busy roads and verify drivers before boarding.
            </p>
          ) : (
            <div className="space-y-2">
              {sansaTips.slice(0, 2).map((t) => (
                <div key={t.id} className="p-3 rounded-xl bg-[#050B14] border border-slate-800/80">
                  {t.title && <p className="text-xs font-bold text-[#00E67A] mb-0.5">{t.title}</p>}
                  <p className="text-xs text-slate-200 leading-relaxed">{t.message}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Verified By Guard AI - Real Videos (Paid ₦5,000 only) */}
        <div className="bg-[#0C1626] border border-slate-800 rounded-2xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-extrabold text-white">
              Verified By Guard AI - Real Videos
            </h2>
            <span className="text-[11px] font-semibold text-[#00E67A]">Paid ₦5,000</span>
          </div>

          {homeVideos.length === 0 ? (
            <p className="text-xs text-slate-400 py-4 text-center">
              No verified paid incident videos yet. Submit a live video report to earn ₦5,000.
            </p>
          ) : (
            <div className="space-y-4">
              {homeVideos.map((vid) => {
                const liked = (vid.likedBy || []).includes(user.uid);
                return (
                  <div
                    key={vid.id}
                    className="bg-[#050B14] border border-slate-800 rounded-2xl p-3.5 space-y-2.5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => vid.userId && onOpenProfile(vid.userId)}
                        className="flex items-center gap-2.5 text-left cursor-pointer min-w-0"
                      >
                        <UserAvatar
                          photoURL={vid.userId === user.uid ? displayPhoto : vid.userProfilePic}
                          name={vid.userId === user.uid ? displayName : vid.userName}
                          size="sm"
                          borderVariant={vid.userId === user.uid ? 'purple' : 'green'}
                          fallbackVariant={vid.userId === user.uid ? 'purple' : 'grey'}
                        />
                        <div className="min-w-0">
                          <p className="text-xs font-bold text-white truncate">
                            {vid.userId === user.uid ? displayName : vid.userName}
                          </p>
                          <p className="text-[11px] text-slate-400 truncate">
                            {vid.incidentArea || vid.incidentState || vid.incidentAddress}
                          </p>
                        </div>
                      </button>
                      <span className="px-2 py-1 rounded-lg bg-[#00E67A]/15 border border-[#00E67A]/40 text-[10px] font-bold text-[#00E67A] shrink-0">
                        Verified + Paid ₦5,000
                      </span>
                    </div>

                    <div className="text-xs font-semibold text-[#FF2D55]">{vid.incidentType}</div>

                    {vid.videoUrl && vid.videoUrl.startsWith('http') || vid.videoUrl.startsWith('data:video') ? (
                      <video
                        src={vid.videoUrl}
                        controls
                        onPlay={() => handleVideoPlay(vid)}
                        className="w-full h-52 rounded-xl bg-black object-cover"
                      />
                    ) : (
                      <div className="w-full h-36 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-center text-xs text-slate-400">
                        Verified In-App Incident Video ({vid.incidentAddress})
                      </div>
                    )}

                    <div className="flex items-center justify-between pt-1 text-xs text-slate-400">
                      <button
                        type="button"
                        onClick={() => handleToggleLike(vid)}
                        className={`flex items-center gap-1.5 cursor-pointer ${
                          liked ? 'text-[#FF2D55] font-bold' : 'hover:text-white'
                        }`}
                      >
                        <Heart className={`w-4 h-4 ${liked ? 'fill-current' : ''}`} />
                        <span>{vid.likes}</span>
                      </button>

                      <button
                        type="button"
                        onClick={() =>
                          setOpenCommentsFor(openCommentsFor === vid.id ? null : vid.id)
                        }
                        className="flex items-center gap-1.5 hover:text-white cursor-pointer"
                      >
                        <MessageCircle className="w-4 h-4" />
                        <span>Comments</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => handleShareVideo(vid)}
                        className="flex items-center gap-1.5 hover:text-white cursor-pointer"
                      >
                        <Share2 className="w-4 h-4" />
                        <span>Share</span>
                      </button>
                    </div>

                    {openCommentsFor === vid.id && (
                      <div className="pt-2 border-t border-slate-800 space-y-2">
                        {comments.length === 0 ? (
                          <p className="text-[11px] text-slate-500">No comments yet.</p>
                        ) : (
                          <div className="space-y-1.5 max-h-36 overflow-y-auto">
                            {comments.map((c) => (
                              <div key={c.id} className="text-xs text-slate-300">
                                <span className="font-bold text-white">{c.userName}: </span>
                                <span>{c.text}</span>
                              </div>
                            ))}
                          </div>
                        )}
                        <form onSubmit={handleAddComment} className="flex gap-2">
                          <input
                            type="text"
                            value={commentInput}
                            onChange={(e) => setCommentInput(e.target.value)}
                            placeholder="Write a comment..."
                            className="flex-1 px-3 py-1.5 rounded-xl bg-[#0C1626] border border-slate-800 text-xs text-white focus:outline-none focus:border-[#2E9BFF]"
                          />
                          <button
                            type="submit"
                            className="px-3 py-1.5 rounded-xl bg-[#2E9BFF] text-white text-xs font-bold cursor-pointer"
                          >
                            <Send className="w-3.5 h-3.5" />
                          </button>
                        </form>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Two Real Top 5 Home Boxes */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {/* Top 5 Trusted */}
          <div className="bg-[#0C1626] border border-slate-800 rounded-2xl p-4 space-y-2.5">
            <h3 className="text-xs font-extrabold text-white flex items-center gap-1.5">
              <ShieldCheck className="w-4 h-4 text-[#00E67A]" />
              Top 5 Users - Most Trusted
            </h3>
            {topTrusted.length === 0 ? (
              <p className="text-xs text-slate-500 py-3">No live data yet.</p>
            ) : (
              <div className="space-y-2">
                {topTrusted.map((u, idx) => (
                  <button
                    key={u.userId}
                    type="button"
                    onClick={() => onOpenProfile(u.userId)}
                    className="w-full flex items-center justify-between gap-2 p-2 rounded-xl bg-[#050B14] hover:border-slate-700 border border-slate-800/80 text-left cursor-pointer"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-xs font-mono font-bold text-slate-400 w-4">
                        #{idx + 1}
                      </span>
                      <UserAvatar
                        photoURL={u.userId === user.uid ? displayPhoto : u.photoURL}
                        name={u.userId === user.uid ? displayName : u.fullName}
                        size="xs"
                        borderVariant={u.userId === user.uid ? 'purple' : 'green'}
                        fallbackVariant={u.userId === user.uid ? 'purple' : 'grey'}
                      />
                      <span className="text-xs font-semibold text-white truncate">
                        {u.userId === user.uid ? displayName : u.fullName}
                      </span>
                    </div>
                    <span className="text-xs font-mono font-bold text-[#00E67A] shrink-0">
                      {u.trust_score ?? 100}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Top 5 Reporters */}
          <div className="bg-[#0C1626] border border-slate-800 rounded-2xl p-4 space-y-2.5">
            <h3 className="text-xs font-extrabold text-white flex items-center gap-1.5">
              <Award className="w-4 h-4 text-[#FFC400]" />
              Top 5 Reporters - Verified Reports
            </h3>
            {topReporters.length === 0 ? (
              <p className="text-xs text-slate-500 py-3">No verified reports yet this month.</p>
            ) : (
              <div className="space-y-2">
                {topReporters.map((u, idx) => (
                  <button
                    key={u.id}
                    type="button"
                    onClick={() => onOpenProfile(u.userId)}
                    className="w-full flex items-center justify-between gap-2 p-2 rounded-xl bg-[#050B14] hover:border-slate-700 border border-slate-800/80 text-left cursor-pointer"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-xs font-mono font-bold text-slate-400 w-4">
                        #{idx + 1}
                      </span>
                      <UserAvatar
                        photoURL={u.userId === user.uid ? displayPhoto : u.avatar}
                        name={u.userId === user.uid ? displayName : u.name}
                        size="xs"
                        borderVariant={u.userId === user.uid ? 'purple' : 'green'}
                        fallbackVariant={u.userId === user.uid ? 'purple' : 'grey'}
                      />
                      <span className="text-xs font-semibold text-white truncate">
                        {u.userId === user.uid ? displayName : u.name}
                      </span>
                    </div>
                    <span className="text-xs font-mono font-bold text-[#FFC400] shrink-0">
                      {u.verifiedReports} verified
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Bottom 50px AdMob Banner */}
      <AdBanner />

      {/* Plain-Language SOS Emergency Sheet */}
      {sosOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="w-full max-w-md bg-[#0C1626] border-2 border-[#FF2D55] rounded-t-3xl sm:rounded-3xl p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-[#FF2D55]">
                <AlertOctagon className="w-6 h-6" />
                <h2 className="text-lg font-extrabold text-white">Emergency Dispatch</h2>
              </div>
              <button
                type="button"
                onClick={() => setSosOpen(false)}
                className="w-9 h-9 rounded-full bg-slate-800 text-slate-300 flex items-center justify-center cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* SOS Sender Identity Card: MY Picture + MY Name + MY Phone */}
            <div className="flex items-center gap-3 p-3.5 rounded-2xl bg-[#050B14] border border-slate-800">
              <UserAvatar
                photoURL={displayPhoto}
                name={displayName}
                size="md"
                borderVariant="purple"
                fallbackVariant="purple"
              />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-bold text-[#FF2D55] uppercase tracking-wide">
                  SOS From
                </p>
                <p className="text-sm font-extrabold text-white truncate">{displayName}</p>
                <p className="text-xs font-mono text-slate-300 truncate">
                  {user.phone || user.emergencyContact || user.email || 'Phone Verified'}
                </p>
              </div>
            </div>

            <div className="p-3.5 rounded-2xl bg-[#FF2D55]/15 border border-[#FF2D55]/40">
              <p className="text-sm font-bold text-white">
                You are at: {location ? location.formattedAddress : 'Live GPS Position'} - Help is coming
              </p>
              {sosDispatching ? (
                <p className="text-xs text-slate-300 mt-1">Sending SOS alert...</p>
              ) : sosSentConfirmation ? (
                <p className="text-xs text-[#00E67A] mt-1 font-semibold">
                  SOS received by Guard AI Admin for dispatch.
                </p>
              ) : null}
            </div>

            <div className="space-y-2.5 bg-[#050B14] border border-slate-800 rounded-2xl p-4 text-sm text-slate-200">
              <p className="font-semibold">1. Stay inside or move away from open threat.</p>
              <p className="font-semibold">2. Go to {sosSafePlaceName}.</p>
              <p className="font-semibold">
                3. Call {user.emergencyContact || '112 / Your Emergency Contact'}.
              </p>
            </div>

            {user.emergencyContact && (
              <a
                href={`tel:${user.emergencyContact.replace(/[^0-9+]/g, '')}`}
                className="w-full py-3.5 px-4 rounded-xl bg-[#00E67A] text-slate-950 font-extrabold text-sm flex items-center justify-center gap-2"
              >
                <PhoneCall className="w-4 h-4" />
                <span>Call Emergency Contact ({user.emergencyContact})</span>
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
