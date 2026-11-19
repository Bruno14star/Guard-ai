import React, { useEffect, useState } from 'react';
import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  updateDoc,
  where,
} from 'firebase/firestore';
import { Bell, CheckCircle2, MapPin, X } from 'lucide-react';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { AlertItem, HumanLocation, UserProfile } from '../types';
import { formatDistanceLabel, haversineMeters } from '../utils/geoPhysics';
import { GuardMap } from './GuardMap';
import { AdBanner } from './AdBanner';

interface AlertsTabProps {
  user: UserProfile;
  location: HumanLocation | null;
  onRefreshLocation: (lat: number, lng: number, accuracy: number) => void;
  onOpenReportModal: () => void;
}

export const AlertsTab: React.FC<AlertsTabProps> = ({
  location,
  onRefreshLocation,
  onOpenReportModal,
}) => {
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [selectedAlert, setSelectedAlert] = useState<AlertItem | null>(null);

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
              createdAt: data.createdAt,
            };
          })
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
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `alerts/${alert.id}`);
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
              Only threats verified by Guard AI &amp; Admin appear here
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
              return (
                <div
                  key={a.id}
                  onClick={() => setSelectedAlert(a)}
                  className="bg-[#0C1626] border border-slate-800 hover:border-[#FF2D55]/50 rounded-2xl p-4 space-y-2 cursor-pointer transition-colors"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="px-2.5 py-0.5 rounded-lg bg-[#FF2D55]/15 text-[#FF2D55] text-xs font-extrabold">
                      {a.type}
                    </span>
                    <span
                      className={`text-[11px] font-bold px-2 py-0.5 rounded-md ${
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
                  <div className="flex items-center justify-between text-[11px] text-slate-400 pt-1">
                    <span>{dist || a.incidentState || 'Verified Location'}</span>
                    {a.status !== 'Resolved' && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleMarkSafe(a);
                        }}
                        className="px-2.5 py-1 rounded-lg bg-[#00E67A]/15 text-[#00E67A] font-bold hover:bg-[#00E67A]/25 cursor-pointer"
                      >
                        Mark Safe
                      </button>
                    )}
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

            {selectedAlert.status !== 'Resolved' && (
              <button
                type="button"
                onClick={() => handleMarkSafe(selectedAlert)}
                className="w-full min-h-[44px] py-2.5 rounded-xl bg-[#00E67A] text-slate-950 font-extrabold text-sm cursor-pointer"
              >
                Mark Area Safe
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
