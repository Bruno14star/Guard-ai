import React, { useEffect, useState } from 'react';
import {
  addDoc,
  collection,
  onSnapshot,
  query,
  serverTimestamp,
  where,
} from 'firebase/firestore';
import { Building2, Plus, Navigation, ShieldCheck, X } from 'lucide-react';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { HumanLocation, SafeBusiness, UserProfile } from '../types';
import { formatDistanceLabel, haversineMeters } from '../utils/geoPhysics';
import { awardGuardScoreEvent } from '../utils/guardScore';
import { useGlobalUserProfile } from '../utils/userProfileStore';
import { GuardMap, MapPinItem } from './GuardMap';
import { AdBanner } from './AdBanner';

interface SafeBusinessTabProps {
  user: UserProfile;
  location: HumanLocation | null;
  onRefreshLocation: (lat: number, lng: number, accuracy: number) => void;
  onOpenReportModal: () => void;
}

const BUSINESS_TYPES: SafeBusiness['type'][] = [
  'Church',
  'School',
  'Mall',
  'Hospital',
  'Office',
  'Market',
];

export const SafeBusinessTab: React.FC<SafeBusinessTabProps> = ({
  user,
  location,
  onRefreshLocation,
  onOpenReportModal,
}) => {
  const resolvedPhoto = user.profilePicUrl || user.photoURL || '';
  const globalProfile = useGlobalUserProfile(user.fullName, resolvedPhoto);
  const [verifiedBusinesses, setVerifiedBusinesses] = useState<SafeBusiness[]>([]);
  const [myPending, setMyPending] = useState<SafeBusiness[]>([]);
  const [filterType, setFilterType] = useState<string>('All');
  const [routeDest, setRouteDest] = useState<{ lat: number; lng: number } | null>(null);
  const [routeSummary, setRouteSummary] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [bizName, setBizName] = useState('');
  const [bizType, setBizType] = useState<SafeBusiness['type']>('Mall');
  const [bizAddress, setBizAddress] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Query 1: Verified businesses (matches firestore.rules)
  useEffect(() => {
    const q = query(collection(db, 'safe_business'), where('verified', '==', true));
    const unsub = onSnapshot(
      q,
      (snap) => {
        setVerifiedBusinesses(
          snap.docs.map((d) => ({
            id: d.id,
            ...(d.data() as Omit<SafeBusiness, 'id'>),
          }))
        );
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'safe_business')
    );
    return () => unsub();
  }, []);

  // Query 2: User's own pending businesses
  useEffect(() => {
    const q = query(collection(db, 'safe_business'), where('ownerId', '==', user.uid));
    const unsub = onSnapshot(
      q,
      (snap) => {
        setMyPending(
          snap.docs
            .map((d) => ({ id: d.id, ...(d.data() as Omit<SafeBusiness, 'id'>) }))
            .filter((b) => !b.verified)
        );
      },
      () => {}
    );
    return () => unsub();
  }, [user.uid]);

  const filtered = verifiedBusinesses.filter(
    (b) => filterType === 'All' || b.type === filterType
  );

  const handleRouteToBusiness = (lat: number, lng: number) => {
    setRouteDest({ lat, lng });
    void awardGuardScoreEvent({
      uid: user.uid,
      action: 'safe_route',
      userName: globalProfile.name || user.fullName,
      userAvatar: globalProfile.photo || resolvedPhoto,
      city: location?.city || user.city || '',
      state: location?.state || user.state || user.userState || '',
    });
  };

  const pins: MapPinItem[] = filtered
    .filter((b) => Number.isFinite(b.lat) && Number.isFinite(b.lng))
    .map((b) => ({
      id: b.id,
      lat: b.lat as number,
      lng: b.lng as number,
      label: b.businessName,
      sublabel: b.type,
      kind: 'safe_business',
      onClick: () => handleRouteToBusiness(b.lat as number, b.lng as number),
    }));

  const handleAddBusiness = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!bizName.trim() || !location) return;
    setSubmitting(true);
    try {
      await addDoc(collection(db, 'safe_business'), {
        businessName: bizName.trim(),
        type: bizType,
        address: bizAddress.trim() || location.formattedAddress,
        lat: location.lat,
        lng: location.lng,
        rating: 5,
        safeScore: 95,
        verified: false,
        ownerId: user.uid,
        createdAt: serverTimestamp(),
      });
      setBizName('');
      setBizAddress('');
      setAddOpen(false);
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'safe_business');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col min-h-full">
      <div className="flex-1 px-4 py-4 space-y-4 max-w-2xl mx-auto w-full">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h1 className="text-lg font-extrabold text-white flex items-center gap-2">
              <Building2 className="w-5 h-5 text-[#00E67A]" />
              <span>Safe Haven Businesses</span>
            </h1>
            <p className="text-xs text-slate-400">
              Verified public shelters, hospitals, malls &amp; churches near you
            </p>
          </div>
          <button
            type="button"
            onClick={() => setAddOpen(true)}
            className="px-3 py-2 rounded-xl bg-[#00E67A] text-slate-950 font-extrabold text-xs flex items-center gap-1 cursor-pointer shrink-0"
          >
            <Plus className="w-4 h-4" />
            <span>List Place</span>
          </button>
        </div>

        {/* Category Filter */}
        <div className="flex gap-2 overflow-x-auto pb-1">
          {['All', ...BUSINESS_TYPES].map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setFilterType(t)}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap border cursor-pointer ${
                filterType === t
                  ? 'bg-[#2E9BFF] border-[#2E9BFF] text-white'
                  : 'bg-[#0C1626] border-slate-800 text-slate-300'
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        {/* Tall Map */}
        <GuardMap
          userLat={location?.lat ?? null}
          userLng={location?.lng ?? null}
          userName={globalProfile.name || user.fullName}
          userPhotoURL={globalProfile.photo || resolvedPhoto}
          addressLabel={location?.formattedAddress || null}
          movementMode={location?.movementMode || 'Walking'}
          pins={pins}
          fitPinsBounds={pins.length > 0}
          routeOrigin={location ? { lat: location.lat, lng: location.lng } : null}
          routeDestination={routeDest}
          onRouteResult={setRouteSummary}
          onRefreshLocation={onRefreshLocation}
          heightClassName="h-[52vh] min-h-[340px]"
        />

        {routeSummary && (
          <div className="p-3 rounded-xl bg-[#2E9BFF]/15 border border-[#2E9BFF]/40 text-xs font-semibold text-white flex items-center justify-between">
            <span>{routeSummary}</span>
            <button
              type="button"
              onClick={() => {
                setRouteDest(null);
                setRouteSummary(null);
              }}
              className="underline ml-2 cursor-pointer"
            >
              Clear
            </button>
          </div>
        )}

        {/* Verified Safe Business List */}
        <div className="space-y-2.5">
          {filtered.length === 0 ? (
            <div className="bg-[#0C1626] border border-slate-800 rounded-2xl p-6 text-center space-y-1.5">
              <p className="text-sm font-bold text-white">No verified safe havens listed yet</p>
              <p className="text-xs text-slate-400">
                Submit a trusted Church, Hospital, Mall, School, Office, or Market for Guard AI Admin verification.
              </p>
            </div>
          ) : (
            filtered.map((b) => {
              const dist =
                location && Number.isFinite(b.lat) && Number.isFinite(b.lng)
                  ? formatDistanceLabel(
                      haversineMeters(location.lat, location.lng, b.lat as number, b.lng as number)
                    )
                  : null;
              return (
                <div
                  key={b.id}
                  className="bg-[#0C1626] border border-slate-800 rounded-2xl p-3.5 flex items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <ShieldCheck className="w-4 h-4 text-[#00E67A] shrink-0" />
                      <p className="text-sm font-bold text-white truncate">{b.businessName}</p>
                      <span className="px-2 py-0.5 rounded bg-slate-800 text-[10px] font-semibold text-slate-300">
                        {b.type}
                      </span>
                    </div>
                    <p className="text-xs text-slate-400 truncate mt-0.5">{b.address}</p>
                    {dist && <p className="text-[11px] font-mono text-[#00E67A] mt-0.5">{dist}</p>}
                  </div>
                  {Number.isFinite(b.lat) && Number.isFinite(b.lng) && (
                    <button
                      type="button"
                      onClick={() => handleRouteToBusiness(b.lat as number, b.lng as number)}
                      className="px-3 py-2 rounded-xl bg-[#2E9BFF] text-white text-xs font-bold flex items-center gap-1 shrink-0 cursor-pointer"
                    >
                      <Navigation className="w-3.5 h-3.5" />
                      <span>Route</span>
                    </button>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* User's Pending Business Submissions */}
        {myPending.length > 0 && (
          <div className="bg-[#0C1626] border border-slate-800 rounded-2xl p-4 space-y-2">
            <h3 className="text-xs font-bold text-[#FFC400]">Your Pending Approvals</h3>
            {myPending.map((b) => (
              <div key={b.id} className="text-xs text-slate-300 flex justify-between">
                <span>
                  {b.businessName} ({b.type})
                </span>
                <span className="text-[#FFC400]">Pending Admin Review</span>
              </div>
            ))}
          </div>
        )}

        <button
          type="button"
          onClick={onOpenReportModal}
          className="w-full min-h-[48px] py-3 px-4 rounded-2xl bg-orange-500 hover:bg-orange-600 text-white font-extrabold text-sm cursor-pointer"
        >
          Report &amp; Earn ₦5,000
        </button>
      </div>

      <AdBanner />

      {/* Submit Business Modal */}
      {addOpen && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="w-full max-w-md bg-[#0C1626] border border-slate-800 rounded-t-3xl sm:rounded-3xl p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-extrabold text-white">Submit Safe Haven Business</h2>
              <button
                type="button"
                onClick={() => setAddOpen(false)}
                className="w-9 h-9 rounded-full bg-slate-800 text-slate-300 flex items-center justify-center cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleAddBusiness} className="space-y-3">
              <input
                type="text"
                required
                placeholder="Business / Building Name"
                value={bizName}
                onChange={(e) => setBizName(e.target.value)}
                className="w-full px-3.5 py-3 rounded-xl bg-[#050B14] border border-slate-800 text-sm text-white"
              />
              <select
                value={bizType}
                onChange={(e) => setBizType(e.target.value as SafeBusiness['type'])}
                className="w-full px-3.5 py-3 rounded-xl bg-[#050B14] border border-slate-800 text-sm text-white"
              >
                {BUSINESS_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
              <input
                type="text"
                placeholder={location?.formattedAddress || 'Street & Area Address'}
                value={bizAddress}
                onChange={(e) => setBizAddress(e.target.value)}
                className="w-full px-3.5 py-3 rounded-xl bg-[#050B14] border border-slate-800 text-sm text-white"
              />
              <button
                type="submit"
                disabled={submitting}
                className="w-full min-h-[48px] py-3 rounded-xl bg-[#00E67A] text-slate-950 font-extrabold text-sm cursor-pointer"
              >
                {submitting ? 'Submitting...' : 'Submit for Admin Approval'}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
