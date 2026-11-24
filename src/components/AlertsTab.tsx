import React, { useEffect, useState } from 'react';
import {
  collection,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { AlertTriangle, Bell, CheckCircle2, Flag, MapPin, X } from 'lucide-react';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { AlertItem, HumanLocation, UserProfile } from '../types';
import { FALSE_REPORT_HIDE_THRESHOLD } from '../utils/antiSpam';
import { formatDistanceLabel, haversineMeters } from '../utils/geoPhysics';
import { awardGuardScoreEvent } from '../utils/guardScore';
import { useGlobalUserProfile } from '../utils/userProfileStore';
import { GuardMap } from './GuardMap';
import { UserAvatar } from './UserAvatar';
import { AdBanner } from './AdBanner';

interface AlertsTabProps {
  user: UserProfile;
  location: HumanLocation | null;
  onRefreshLocation: (lat: number, lng: number, accuracy: number) => void;
  onOpenReportModal: () => void;
}

export const AlertsTab: React.FC<AlertsTabProps> = ({
  user,
  location,
  onRefreshLocation,
  onOpenReportModal,
}) => {
  const resolvedPhoto = user.profilePicUrl || user.photoURL || '';
  const globalProfile = useGlobalUserProfile(user.fullName, resolvedPhoto);
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [selectedAlert, setSelectedAlert] = useState<AlertItem | null>(null);
  const [flagBusyId, setFlagBusyId] = useState<string | null>(null);
  const [feedbackMsg, setFeedbackMsg] = useState<string | null>(null);

  useEffect(() => {
    const q = query(
      collection(db, 'alerts'),
      where('verifiedByGuardAI', '==', true)
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const list: AlertItem[] = snap.docs
          .map((d) => {
            const data = d.data();
            return {
              id: d.id,
              userId: data.userId,
              userName: data.userName,
              userProfilePic: data.userProfilePic || '',
              type: data.type || 'Alert',
              title: data.title,
              description: data.description,
              address: data.address || 'Verified Area',
              incidentState: data.incidentState,
              incidentArea: data.incidentArea,
              lat: typeof data.lat === 'number' ? data.lat : undefined,
              lng: typeof data.lng === 'number' ? data.lng : undefined,
              confidence: typeof data.confidence === 'number' ? data.confidence : undefined,
              status: data.status || 'New',
              videoUrl: data.videoUrl,
              photoUrl: data.photoUrl,
              verifiedByGuardAI: Boolean(data.verifiedByGuardAI),
              reportId: data.reportId,
              falseCount: Number(data.falseCount || 0),
              falseBy: Array.isArray(data.falseBy) ? data.falseBy : [],
              isHidden: Boolean(data.isHidden),
              createdAt: data.createdAt,
            };
          })
          .filter((a) => !a.isHidden && (a.falseCount || 0) < FALSE_REPORT_HIDE_THRESHOLD)
          .sort((a, b) => {
            const ta = a.createdAt?.toMillis ? a.createdAt.toMillis() : 0;
            const tb = b.createdAt?.toMillis ? b.createdAt.toMillis() : 0;
            return tb - ta;
          });
        setAlerts(list);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'alerts')
    );
    return () => unsub();
  }, []);

  const handleMarkSafe = async (alert: AlertItem) => {
    try {
      await updateDoc(doc(db, 'alerts', alert.id), {
        status: 'Resolved',
      });
      if (selectedAlert?.id === alert.id) {
        setSelectedAlert({ ...alert, status: 'Resolved' });
      }
      if (alert.userId !== user.uid) {
        void awardGuardScoreEvent({
          uid: user.uid,
          action: 'community_verification',
          userName: globalProfile.name || user.fullName,
          userAvatar: globalProfile.photo || resolvedPhoto,
          city: location?.city || user.city || '',
          state: location?.state || user.state || user.userState || '',
        });
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `alerts/${alert.id}`);
    }
  };

  const handleMarkFalse = async (alert: AlertItem) => {
    const existingVoters = Array.isArray(alert.falseBy) ? alert.falseBy : [];
    if (existingVoters.includes(user.uid)) {
      setFeedbackMsg('You already marked this alert as False.');
      window.setTimeout(() => setFeedbackMsg(null), 3500);
      return;
    }

    setFlagBusyId(alert.id);
    try {
      const nextFalseBy = [...existingVoters, user.uid];
      const nextCount = nextFalseBy.length;
      const shouldAutoHide = nextCount >= FALSE_REPORT_HIDE_THRESHOLD;

      const batch = writeBatch(db);
      batch.update(doc(db, 'alerts', alert.id), {
        falseBy: nextFalseBy,
        falseCount: nextCount,
        isHidden: shouldAutoHide,
        verifiedByGuardAI: !shouldAutoHide,
        status: shouldAutoHide ? 'Resolved' : alert.status,
      });

      batch.set(doc(db, 'report_false_votes', `${alert.id}_${user.uid}`), {
        alertId: alert.id,
        reportId: alert.reportId || alert.id,
        voterId: user.uid,
        reporterId: alert.userId || '',
        createdAt: serverTimestamp(),
      });

      if (shouldAutoHide && alert.userId) {
        batch.update(doc(db, 'users', alert.userId), {
          flaggedReporter: true,
          flaggedReportId: alert.id,
          flaggedAt: serverTimestamp(),
        });
      }

      await batch.commit();

      if (alert.userId !== user.uid) {
        void awardGuardScoreEvent({
          uid: user.uid,
          action: 'community_verification',
          userName: globalProfile.name || user.fullName,
          userAvatar: globalProfile.photo || resolvedPhoto,
          city: location?.city || user.city || '',
          state: location?.state || user.state || user.userState || '',
        });
      }

      if (shouldAutoHide) {
        setSelectedAlert(null);
        setFeedbackMsg(
          '3 users marked this report False — alert auto-hidden and reporter flagged.'
        );
      } else {
        if (selectedAlert?.id === alert.id) {
          setSelectedAlert({
            ...alert,
            falseBy: nextFalseBy,
            falseCount: nextCount,
          });
        }
        setFeedbackMsg(
          `Marked False (${nextCount}/${FALSE_REPORT_HIDE_THRESHOLD}). At 3 flags it auto-hides.`
        );
      }
      window.setTimeout(() => setFeedbackMsg(null), 4500);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `alerts/${alert.id}`);
    } finally {
      setFlagBusyId(null);
    }
  };

  return (
    <div className="flex flex-col min-h-full">
      <div className="flex-1 px-4 py-4 space-y-4 max-w-2xl mx-auto w-full">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h1 className="text-lg font-extrabold text-white flex items-center gap-2">
              <Bell className="w-5 h-5 text-[#FF2D55]" />
              <span>Verified Alerts</span>
            </h1>
            <p className="text-xs text-slate-400">
              Pending reports stay hidden until Admin verifies • 3 False flags auto-hide
            </p>
          </div>
          <button
            type="button"
            onClick={onOpenReportModal}
            className="px-3.5 py-2 rounded-xl bg-orange-500 hover:bg-orange-600 text-white font-extrabold text-xs shrink-0 cursor-pointer"
          >
            Report &amp; Earn ₦5,000
          </button>
        </div>

        {feedbackMsg && (
          <div className="p-3 rounded-xl bg-[#FFC400]/15 border border-[#FFC400]/45 text-xs font-semibold text-[#FFC400] flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{feedbackMsg}</span>
          </div>
        )}

        {alerts.length === 0 ? (
          <div className="bg-[#0C1626] border border-slate-800 rounded-2xl p-8 text-center space-y-2">
            <CheckCircle2 className="w-10 h-10 text-[#00E67A] mx-auto" />
            <p className="text-sm font-bold text-white">No active verified threats right now</p>
            <p className="text-xs text-slate-400">
              When Guard AI and Admin verify a live report in your area, it appears here immediately.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {alerts.map((a) => {
              const dist =
                location && Number.isFinite(a.lat) && Number.isFinite(a.lng)
                  ? formatDistanceLabel(
                      haversineMeters(location.lat, location.lng, a.lat as number, a.lng as number)
                    )
                  : null;
              const alreadyMarkedFalse = (a.falseBy || []).includes(user.uid);
              const falseCount = a.falseCount || 0;
              return (
                <div
                  key={a.id}
                  onClick={() => setSelectedAlert(a)}
                  className="bg-[#0C1626] border border-slate-800 hover:border-[#FF2D55]/50 rounded-2xl p-4 space-y-2 cursor-pointer transition-colors"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <UserAvatar
                        photoURL={
                          a.userId === user.uid
                            ? globalProfile.photo || resolvedPhoto
                            : a.userProfilePic || undefined
                        }
                        name={a.userId === user.uid ? globalProfile.name : a.userName || 'Reporter'}
                        size="xs"
                        borderVariant={a.userId === user.uid ? 'purple' : 'none'}
                        fallbackVariant={a.userId === user.uid ? 'purple' : 'grey'}
                      />
                      <span className="px-2.5 py-0.5 rounded-lg bg-[#FF2D55]/15 text-[#FF2D55] text-xs font-extrabold">
                        {a.type}
                      </span>
                      {a.userName && (
                        <span className="text-[11px] font-semibold text-slate-300 truncate">
                          {a.userId === user.uid ? globalProfile.name : a.userName}
                        </span>
                      )}
                    </div>
                    <span
                      className={`text-[11px] font-bold px-2 py-0.5 rounded-md shrink-0 ${
                        a.status === 'Resolved'
                          ? 'bg-[#00E67A]/15 text-[#00E67A]'
                          : 'bg-[#FFC400]/15 text-[#FFC400]'
                      }`}
                    >
                      {a.status}
                    </span>
                  </div>
                  <p className="text-sm font-bold text-white flex items-start gap-1.5">
                    <MapPin className="w-4 h-4 text-[#2E9BFF] shrink-0 mt-0.5" />
                    <span>{a.address}</span>
                  </p>
                  {a.description && <p className="text-xs text-slate-300">{a.description}</p>}
                  <div className="flex items-center justify-between gap-2 text-[11px] text-slate-400 pt-1">
                    <span>{dist || a.incidentState || 'Verified Location'}</span>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        disabled={alreadyMarkedFalse || flagBusyId === a.id}
                        onClick={(e) => {
                          e.stopPropagation();
                          void handleMarkFalse(a);
                        }}
                        className={`px-2.5 py-1 rounded-lg font-bold flex items-center gap-1 cursor-pointer disabled:opacity-60 ${
                          alreadyMarkedFalse
                            ? 'bg-slate-800 text-slate-400'
                            : 'bg-[#FF2D55]/15 text-[#FF2D55] hover:bg-[#FF2D55]/25'
                        }`}
                      >
                        <Flag className="w-3 h-3" />
                        <span>
                          {alreadyMarkedFalse
                            ? `Flagged False (${falseCount}/3)`
                            : `False (${falseCount}/3)`}
                        </span>
                      </button>
                      {a.status !== 'Resolved' && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            void handleMarkSafe(a);
                          }}
                          className="px-2.5 py-1 rounded-lg bg-[#00E67A]/15 text-[#00E67A] font-bold hover:bg-[#00E67A]/25 cursor-pointer"
                        >
                          Mark Safe
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <AdBanner />

      {/* Map Modal on Alert Click */}
      {selectedAlert && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="w-full max-w-lg bg-[#0C1626] border border-slate-800 rounded-t-3xl sm:rounded-3xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-extrabold text-white">{selectedAlert.type}</h2>
                <p className="text-xs text-slate-400">{selectedAlert.address}</p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedAlert(null)}
                className="w-9 h-9 rounded-full bg-slate-800 text-slate-300 flex items-center justify-center cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <GuardMap
              userLat={selectedAlert.lat ?? location?.lat ?? null}
              userLng={selectedAlert.lng ?? location?.lng ?? null}
              userName={globalProfile.name || user.fullName}
              userPhotoURL={globalProfile.photo || resolvedPhoto}
              addressLabel={selectedAlert.address || null}
              pins={
                Number.isFinite(selectedAlert.lat) && Number.isFinite(selectedAlert.lng)
                  ? [
                      {
                        id: selectedAlert.id,
                        lat: selectedAlert.lat as number,
                        lng: selectedAlert.lng as number,
                        label: selectedAlert.type,
                        kind: 'alert',
                      },
                    ]
                  : []
              }
              showUserMarker={false}
              onRefreshLocation={onRefreshLocation}
              heightClassName="h-[320px]"
            />

            <div className="flex gap-2">
              <button
                type="button"
                disabled={
                  (selectedAlert.falseBy || []).includes(user.uid) ||
                  flagBusyId === selectedAlert.id
                }
                onClick={() => void handleMarkFalse(selectedAlert)}
                className="flex-1 min-h-[44px] py-2.5 rounded-xl bg-[#FF2D55]/15 border border-[#FF2D55]/40 text-[#FF2D55] font-extrabold text-sm flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                <Flag className="w-4 h-4" />
                <span>
                  {(selectedAlert.falseBy || []).includes(user.uid)
                    ? `Marked False (${selectedAlert.falseCount || 0}/3)`
                    : `Mark False (${selectedAlert.falseCount || 0}/3)`}
                </span>
              </button>
              {selectedAlert.status !== 'Resolved' && (
                <button
                  type="button"
                  onClick={() => void handleMarkSafe(selectedAlert)}
                  className="flex-1 min-h-[44px] py-2.5 rounded-xl bg-[#00E67A] text-slate-950 font-extrabold text-sm cursor-pointer"
                >
                  Mark Area Safe
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
