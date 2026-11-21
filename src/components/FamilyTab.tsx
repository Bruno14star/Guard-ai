import React, { useEffect, useRef, useState } from 'react';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from 'firebase/firestore';
import { Users, Plus, AlertTriangle, Trash2, Navigation, VolumeX, X } from 'lucide-react';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { FamilyMember, HumanLocation, PlanType, UserProfile } from '../types';
import { formatDistanceLabel, haversineMeters } from '../utils/geoPhysics';
import { ContinuousAlarmController } from '../utils/audioClassifier';
import { GuardMap, MapPinItem } from './GuardMap';
import { UserAvatar } from './UserAvatar';
import { AdBanner } from './AdBanner';

interface FamilyTabProps {
  user: UserProfile;
  location: HumanLocation | null;
  activePlan: PlanType;
  onRefreshLocation: (lat: number, lng: number, accuracy: number) => void;
  onOpenReportModal: () => void;
  onOpenSubscriptions: () => void;
}

const PLAN_MEMBER_LIMIT: Record<PlanType, number> = {
  Free: 1,
  Monthly: 10,
  Yearly: 20,
};

export const FamilyTab: React.FC<FamilyTabProps> = ({
  user,
  location,
  activePlan,
  onRefreshLocation,
  onOpenReportModal,
  onOpenSubscriptions,
}) => {
  const [members, setMembers] = useState<FamilyMember[]>([]);
  const [addOpen, setAddOpen] = useState(false);
  const [memberName, setMemberName] = useState('');
  const [memberPhone, setMemberPhone] = useState('');
  const [relationship, setRelationship] = useState('Sister');
  const [submitting, setSubmitting] = useState(false);
  const [limitNotice, setLimitNotice] = useState<string | null>(null);
  const [selectedRouteDest, setSelectedRouteDest] = useState<{ lat: number; lng: number } | null>(
    null
  );
  const [routeSummary, setRouteSummary] = useState<string | null>(null);
  const alarmRef = useRef<ContinuousAlarmController | null>(null);
  const [alarmPlaying, setAlarmPlaying] = useState(false);

  useEffect(() => {
    const q = query(collection(db, 'family_tracking'), where('ownerId', '==', user.uid));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const list: FamilyMember[] = snap.docs.map((d) => {
          const data = d.data();
          return {
            id: d.id,
            ownerId: data.ownerId,
            memberName: data.memberName,
            memberPhone: data.memberPhone,
            relationship: data.relationship,
            photoURL: data.photoURL || '',
            lastLat: typeof data.lastLat === 'number' ? data.lastLat : undefined,
            lastLng: typeof data.lastLng === 'number' ? data.lastLng : undefined,
            lastAddress: data.lastAddress || '',
            isOnline: Boolean(data.isOnline),
            status: data.status === 'SOS' ? 'SOS' : 'Safe',
            lastSeen: data.lastSeen,
          };
        });
        setMembers(list);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'family_tracking')
    );
    return () => unsub();
  }, [user.uid]);

  const sosMembers = members.filter((m) => m.status === 'SOS');

  useEffect(() => {
    if (!alarmRef.current) {
      alarmRef.current = new ContinuousAlarmController();
    }
    if (sosMembers.length > 0 && !alarmRef.current.active) {
      alarmRef.current.start();
      setAlarmPlaying(true);
    } else if (sosMembers.length === 0 && alarmRef.current.active) {
      alarmRef.current.stop();
      setAlarmPlaying(false);
    }
    return () => {
      alarmRef.current?.stop();
    };
  }, [sosMembers.length]);

  const maxAllowed = PLAN_MEMBER_LIMIT[activePlan];

  const handleOpenAdd = () => {
    if (members.length >= maxAllowed) {
      setLimitNotice(
        `Your ${activePlan} plan allows up to ${maxAllowed} family member${
          maxAllowed > 1 ? 's' : ''
        }. Upgrade to add more.`
      );
      return;
    }
    setLimitNotice(null);
    setAddOpen(true);
  };

  const handleAddMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!memberName.trim() || !memberPhone.trim()) return;
    setSubmitting(true);
    try {
      await addDoc(collection(db, 'family_tracking'), {
        ownerId: user.uid,
        memberName: memberName.trim(),
        memberPhone: memberPhone.trim(),
        relationship,
        photoURL: '',
        lastAddress: 'Waiting for member live GPS',
        isOnline: false,
        status: 'Safe',
        lastSeen: serverTimestamp(),
      });
      setMemberName('');
      setMemberPhone('');
      setAddOpen(false);
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'family_tracking');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteMember = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'family_tracking', id));
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `family_tracking/${id}`);
    }
  };

  const handleToggleMemberSos = async (m: FamilyMember) => {
    try {
      await updateDoc(doc(db, 'family_tracking', m.id), {
        status: m.status === 'SOS' ? 'Safe' : 'SOS',
        lastSeen: serverTimestamp(),
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `family_tracking/${m.id}`);
    }
  };

  const mapPins: MapPinItem[] = members
    .filter((m) => Number.isFinite(m.lastLat) && Number.isFinite(m.lastLng))
    .map((m) => ({
      id: m.id,
      lat: m.lastLat as number,
      lng: m.lastLng as number,
      label: m.memberName,
      sublabel: m.lastAddress,
      photoURL: m.photoURL,
      kind: 'family',
      isOnline: m.isOnline,
      isSos: m.status === 'SOS',
      onClick: () => setSelectedRouteDest({ lat: m.lastLat as number, lng: m.lastLng as number }),
    }));

  return (
    <div className="flex flex-col min-h-full">
      <div className="flex-1 px-4 py-4 space-y-4 max-w-2xl mx-auto w-full">
        {/* Header */}
        <div className="flex items-center justify-between gap-2">
          <div>
            <h1 className="text-lg font-extrabold text-white flex items-center gap-2">
              <Users className="w-5 h-5 text-[#00E67A]" />
              <span>Real-time family GPS tracking</span>
            </h1>
            <p className="text-xs text-slate-400">
              {members.length} / {maxAllowed} family member{maxAllowed > 1 ? 's' : ''} ({activePlan} Plan)
            </p>
          </div>
          <button
            type="button"
            onClick={handleOpenAdd}
            className="min-h-[40px] px-3.5 py-2 rounded-xl bg-[#00E67A] text-slate-950 font-extrabold text-xs flex items-center gap-1.5 cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Add Member</span>
          </button>
        </div>

        {/* Red SOS Banner if any member in SOS */}
        {sosMembers.length > 0 && (
          <div className="p-4 rounded-2xl bg-[#FF2D55] text-white space-y-2 animate-pulse">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 font-extrabold text-sm">
                <AlertTriangle className="w-5 h-5" />
                <span>SOS EMERGENCY: {sosMembers[0].memberName} NEEDS HELP</span>
              </div>
              {alarmPlaying && (
                <button
                  type="button"
                  onClick={() => {
                    alarmRef.current?.stop();
                    setAlarmPlaying(false);
                  }}
                  className="px-2.5 py-1 rounded-lg bg-black/40 text-xs font-bold flex items-center gap-1 cursor-pointer"
                >
                  <VolumeX className="w-3.5 h-3.5" />
                  Mute Siren
                </button>
              )}
            </div>
            <p className="text-xs text-white/90">
              Location: {sosMembers[0].lastAddress || 'Tracking live address...'}
            </p>
          </div>
        )}

        {/* Plan Cap Upgrade Notice */}
        {limitNotice && (
          <div className="p-3.5 rounded-2xl bg-[#FFC400]/10 border border-[#FFC400]/40 flex items-center justify-between gap-3">
            <p className="text-xs text-[#FFC400] font-semibold">{limitNotice}</p>
            <button
              type="button"
              onClick={onOpenSubscriptions}
              className="px-3 py-1.5 rounded-xl bg-[#2E9BFF] text-white font-bold text-xs shrink-0 cursor-pointer"
            >
              Upgrade
            </button>
          </div>
        )}

        {/* Tall Map Showing Live User + Family Circle */}
        <GuardMap
          userLat={location?.lat ?? null}
          userLng={location?.lng ?? null}
          userName={user.fullName}
          userPhotoURL={user.photoURL}
          addressLabel={location?.formattedAddress || null}
          movementMode={location?.movementMode || 'Walking'}
          pins={mapPins}
          fitPinsBounds={true}
          routeOrigin={location ? { lat: location.lat, lng: location.lng } : null}
          routeDestination={selectedRouteDest}
          onRouteResult={setRouteSummary}
          onRefreshLocation={onRefreshLocation}
          heightClassName="h-[58vh] min-h-[360px]"
        />

        {routeSummary && (
          <div className="p-3 rounded-xl bg-[#2E9BFF]/15 border border-[#2E9BFF]/40 text-xs font-semibold text-white flex items-center justify-between">
            <span>{routeSummary}</span>
            <button
              type="button"
              onClick={() => {
                setSelectedRouteDest(null);
                setRouteSummary(null);
              }}
              className="text-slate-300 hover:text-white underline ml-2 cursor-pointer"
            >
              Clear
            </button>
          </div>
        )}

        {/* Family Circle List */}
        <div className="space-y-2.5">
          {members.length === 0 ? (
            <div className="bg-[#0C1626] border border-slate-800 rounded-2xl p-6 text-center space-y-2">
              <p className="text-sm font-bold text-white">No family members added yet</p>
              <p className="text-xs text-slate-400">
                Add trusted relatives to monitor real-time street addresses and SOS alerts.
              </p>
            </div>
          ) : (
            members.map((m) => {
              const distMeters =
                location && Number.isFinite(m.lastLat) && Number.isFinite(m.lastLng)
                  ? haversineMeters(location.lat, location.lng, m.lastLat as number, m.lastLng as number)
                  : null;
              return (
                <div
                  key={m.id}
                  className={`p-3.5 rounded-2xl bg-[#0C1626] border ${
                    m.status === 'SOS' ? 'border-[#FF2D55]' : 'border-slate-800'
                  } flex items-center justify-between gap-3`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="relative">
                      <UserAvatar photoURL={m.photoURL} name={m.memberName} size="md" greenBorder={false} />
                      <span
                        className={`absolute bottom-0 right-0 w-3 h-3 rounded-full ring-2 ring-[#0C1626] ${
                          m.isOnline ? 'bg-[#00E67A]' : 'bg-slate-500'
                        }`}
                      />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-white truncate">
                        {m.memberName}{' '}
                        <span className="text-[11px] font-normal text-slate-400">
                          ({m.relationship})
                        </span>
                      </p>
                      <p className="text-xs text-slate-300 truncate">
                        {m.lastAddress || 'Waiting for member live GPS'}
                      </p>
                      <p className="text-[11px] text-slate-400 font-mono">
                        {distMeters !== null ? formatDistanceLabel(distMeters) : m.memberPhone}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {Number.isFinite(m.lastLat) && Number.isFinite(m.lastLng) && (
                      <button
                        type="button"
                        onClick={() =>
                          setSelectedRouteDest({ lat: m.lastLat as number, lng: m.lastLng as number })
                        }
                        className="p-2 rounded-xl bg-[#050B14] border border-slate-700 text-[#2E9BFF] cursor-pointer"
                        title="Route to member"
                      >
                        <Navigation className="w-4 h-4" />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => handleToggleMemberSos(m)}
                      className={`px-2.5 py-1.5 rounded-xl text-[11px] font-bold cursor-pointer ${
                        m.status === 'SOS'
                          ? 'bg-[#00E67A] text-slate-950'
                          : 'bg-[#FF2D55]/15 text-[#FF2D55] border border-[#FF2D55]/40'
                      }`}
                    >
                      {m.status === 'SOS' ? 'Clear SOS' : 'SOS'}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteMember(m.id)}
                      className="p-2 rounded-xl bg-slate-800/80 text-slate-400 hover:text-[#FF2D55] cursor-pointer"
                      aria-label={`Remove ${m.memberName}`}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>

        <button
          type="button"
          onClick={onOpenReportModal}
          className="w-full min-h-[48px] py-3 px-4 rounded-2xl bg-orange-500 hover:bg-orange-600 text-white font-extrabold text-sm cursor-pointer"
        >
          Report &amp; Earn ₦5,000
        </button>
      </div>

      <AdBanner />

      {/* Add Member Modal */}
      {addOpen && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="w-full max-w-md bg-[#0C1626] border border-slate-800 rounded-t-3xl sm:rounded-3xl p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-extrabold text-white">Add Family Member</h2>
              <button
                type="button"
                onClick={() => setAddOpen(false)}
                className="w-9 h-9 rounded-full bg-slate-800 text-slate-300 flex items-center justify-center cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleAddMember} className="space-y-3">
              <input
                type="text"
                required
                placeholder="Member Full Name"
                value={memberName}
                onChange={(e) => setMemberName(e.target.value)}
                className="w-full px-3.5 py-3 rounded-xl bg-[#050B14] border border-slate-800 text-sm text-white"
              />
              <input
                type="tel"
                required
                placeholder="Phone Number (e.g. +234 80...)"
                value={memberPhone}
                onChange={(e) => setMemberPhone(e.target.value)}
                className="w-full px-3.5 py-3 rounded-xl bg-[#050B14] border border-slate-800 text-sm text-white"
              />
              <select
                value={relationship}
                onChange={(e) => setRelationship(e.target.value)}
                className="w-full px-3.5 py-3 rounded-xl bg-[#050B14] border border-slate-800 text-sm text-white"
              >
                <option value="Mother">Mother</option>
                <option value="Father">Father</option>
                <option value="Sister">Sister</option>
                <option value="Brother">Brother</option>
                <option value="Spouse">Spouse</option>
                <option value="Child">Child</option>
              </select>
              <button
                type="submit"
                disabled={submitting}
                className="w-full min-h-[48px] py-3 rounded-xl bg-[#00E67A] text-slate-950 font-extrabold text-sm cursor-pointer"
              >
                {submitting ? 'Adding...' : 'Save Family Member'}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
