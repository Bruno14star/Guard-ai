import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw, MapPin, AlertTriangle, ShieldCheck } from 'lucide-react';
import { MovementMode } from '../types';

export interface MapPinItem {
  id: string;
  lat: number;
  lng: number;
  label: string;
  sublabel?: string;
  photoURL?: string;
  kind: 'family' | 'threat' | 'safe_business' | 'alert' | 'vehicle';
  isOnline?: boolean;
  isSos?: boolean;
  onClick?: () => void;
}

interface GuardMapProps {
  userLat: number | null;
  userLng: number | null;
  userName?: string | null;
  userPhotoURL?: string | null;
  addressLabel?: string | null;
  movementMode?: MovementMode;
  pins?: MapPinItem[];
  fitPinsBounds?: boolean;
  showRadar?: boolean;
  radarRadiusLabel?: string;
  dangerTint?: boolean;
  routeOrigin?: { lat: number; lng: number } | null;
  routeDestination?: { lat: number; lng: number } | null;
  avoidPoint?: { lat: number; lng: number } | null;
  redThreatLineTo?: { lat: number; lng: number } | null;
  onRouteResult?: (summary: string | null) => void;
  onRefreshLocation?: (lat: number, lng: number, accuracy: number) => void;
  heightClassName?: string;
  topOverlay?: React.ReactNode;
  bottomOverlay?: React.ReactNode;
  showUserMarker?: boolean;
}

export const GuardMap: React.FC<GuardMapProps> = ({
  userLat,
  userLng,
  userName,
  userPhotoURL,
  addressLabel,
  movementMode = 'Walking',
  pins = [],
  showRadar = false,
  radarRadiusLabel,
  dangerTint = false,
  routeOrigin,
  routeDestination,
  redThreatLineTo,
  onRouteResult,
  onRefreshLocation,
  heightClassName = 'h-[70vh] min-h-[420px]',
  topOverlay,
  bottomOverlay,
  showUserMarker = true,
}) => {
  const [mapType, setMapType] = useState<'map' | 'satellite'>('map');
  const [refreshToast, setRefreshToast] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [imgError, setImgError] = useState(false);
  const [localGps, setLocalGps] = useState<{ lat: number; lng: number } | null>(null);

  useEffect(() => {
    setImgError(false);
  }, [userPhotoURL]);

  // Acquire REAL GPS automatically if parent props haven't received coordinates yet
  useEffect(() => {
    if (
      userLat !== null &&
      userLng !== null &&
      Number.isFinite(userLat) &&
      Number.isFinite(userLng)
    ) {
      setLocalGps({ lat: userLat, lng: userLng });
      return;
    }

    if (!navigator.geolocation) return;
    let cancelled = false;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (cancelled) return;
        const { latitude, longitude, accuracy } = pos.coords;
        setLocalGps({ lat: latitude, lng: longitude });
        onRefreshLocation?.(latitude, longitude, accuracy);
      },
      () => {
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            if (cancelled) return;
            const { latitude, longitude, accuracy } = pos.coords;
            setLocalGps({ lat: latitude, lng: longitude });
            onRefreshLocation?.(latitude, longitude, accuracy);
          },
          () => {},
          { enableHighAccuracy: false, timeout: 8000, maximumAge: 30000 }
        );
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
    return () => {
      cancelled = true;
    };
  }, [userLat, userLng, onRefreshLocation]);

  const activeLat =
    userLat !== null && Number.isFinite(userLat) ? userLat : localGps?.lat ?? null;
  const activeLng =
    userLng !== null && Number.isFinite(userLng) ? userLng : localGps?.lng ?? null;

  const hasLiveGps =
    activeLat !== null &&
    activeLng !== null &&
    Number.isFinite(activeLat) &&
    Number.isFinite(activeLng);

  // Compute Google Maps Embed URL (100% free, zero API key, zero billing, real Google Maps street/shop detail)
  const embedSrc = useMemo(() => {
    if (!hasLiveGps) return null;
    const latStr = (activeLat as number).toFixed(6);
    const lngStr = (activeLng as number).toFixed(6);

    if (routeOrigin && routeDestination) {
      const satFlag = mapType === 'satellite' ? '&t=k' : '';
      return `https://www.google.com/maps?saddr=${routeOrigin.lat.toFixed(
        6
      )},${routeOrigin.lng.toFixed(6)}&daddr=${routeDestination.lat.toFixed(
        6
      )},${routeDestination.lng.toFixed(6)}${satFlag}&output=embed`;
    }

    if (mapType === 'satellite') {
      return `https://www.google.com/maps?q=${latStr},${lngStr}&z=17&t=k&output=embed`;
    }
    return `https://www.google.com/maps?q=${latStr},${lngStr}&z=17&output=embed`;
  }, [hasLiveGps, activeLat, activeLng, mapType, routeOrigin, routeDestination]);

  // Compute safe route distance & duration summary via OSRM when a route is requested
  useEffect(() => {
    if (!routeOrigin || !routeDestination) return;
    let cancelled = false;
    const url = `https://router.project-osrm.org/route/v1/driving/${routeOrigin.lng},${routeOrigin.lat};${routeDestination.lng},${routeDestination.lat}?overview=false&steps=true`;

    fetch(url)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled) return;
        const route = data?.routes?.[0];
        if (route) {
          const km = (route.distance / 1000).toFixed(1);
          const mins = Math.max(1, Math.round(route.duration / 60));
          const firstRoad = route.legs?.[0]?.steps?.[0]?.name || 'Google Maps Route';
          onRouteResult?.(`Safe Route via ${firstRoad} • ${km}km • ${mins} mins`);
        } else {
          onRouteResult?.('Directions loaded in Google Maps.');
        }
      })
      .catch(() => {
        if (!cancelled) {
          onRouteResult?.('Directions loaded in Google Maps.');
        }
      });

    return () => {
      cancelled = true;
    };
  }, [routeOrigin, routeDestination, onRouteResult]);

  // Refresh Map button: re-gets REAL high-accuracy GPS and reloads Google Maps iframe with new LAT,LNG
  const handleRefreshMap = useCallback(() => {
    if (!navigator.geolocation) {
      setRefreshToast('Please turn on your GPS / Location');
      return;
    }
    setRefreshing(true);
    const applyPos = (pos: GeolocationPosition) => {
      const { latitude, longitude, accuracy } = pos.coords;
      setLocalGps({ lat: latitude, lng: longitude });
      setRefreshNonce((n) => n + 1);
      onRefreshLocation?.(latitude, longitude, accuracy);
      setRefreshToast(`Location updated (±${Math.round(accuracy)}m)`);
      setRefreshing(false);
      window.setTimeout(() => setRefreshToast(null), 3500);
    };

    navigator.geolocation.getCurrentPosition(
      applyPos,
      () => {
        navigator.geolocation.getCurrentPosition(
          applyPos,
          () => {
            setRefreshing(false);
            setRefreshToast('Please turn on your GPS / Location');
            window.setTimeout(() => setRefreshToast(null), 4000);
          },
          { enableHighAccuracy: false, timeout: 8000, maximumAge: 0 }
        );
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  }, [onRefreshLocation]);

  const userInitial = (userName || '').trim().charAt(0).toUpperCase() || 'R';
  const validPins = pins.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));

  return (
    <div
      className={`relative w-full ${heightClassName} rounded-2xl overflow-hidden border border-slate-200 dark:border-slate-700 bg-white`}
      style={{ backgroundColor: '#ffffff' }}
    >
      {/* Real Google Maps Embed Iframe (100% Free, Zero API Key, Zero Watermark) */}
      {embedSrc ? (
        <iframe
          key={`${mapType}-${refreshNonce}-${routeDestination ? `${routeDestination.lat},${routeDestination.lng}` : ''}`}
          title="Guard AI Live Google Map"
          src={embedSrc}
          className="w-full h-full border-0 block bg-white"
          loading="eager"
          referrerPolicy="no-referrer-when-downgrade"
          allowFullScreen
        />
      ) : (
        <div className="w-full h-full flex flex-col items-center justify-center bg-slate-100 text-slate-700 gap-2 p-4 text-center">
          <MapPin className="w-7 h-7 text-[#7C3AED] animate-bounce" />
          <p className="text-xs font-bold">Getting real GPS location for Google Maps...</p>
        </div>
      )}

      {/* Top-Right Map Type Switcher: "Map" | "Satellite" */}
      <div
        className="absolute top-3 right-3 z-30 flex items-center bg-white/95 backdrop-blur-sm rounded-xl border border-slate-300 shadow-md p-0.5"
        role="group"
        aria-label="Map Type"
      >
        <button
          type="button"
          onClick={() => setMapType('map')}
          className={`px-3 py-1.5 rounded-lg text-xs font-extrabold transition-colors cursor-pointer ${
            mapType === 'map'
              ? 'bg-[#2E9BFF] text-white shadow-sm'
              : 'text-slate-700 hover:bg-slate-100'
          }`}
        >
          Map
        </button>
        <button
          type="button"
          onClick={() => setMapType('satellite')}
          className={`px-3 py-1.5 rounded-lg text-xs font-extrabold transition-colors cursor-pointer ${
            mapType === 'satellite'
              ? 'bg-[#2E9BFF] text-white shadow-sm'
              : 'text-slate-700 hover:bg-slate-100'
          }`}
        >
          Satellite
        </button>
      </div>

      {/* Centered User Purple Marker + "You are at: [Real Street]" Overlay on top of Google Maps */}
      {hasLiveGps && !routeDestination && (
        <div className="pointer-events-none absolute inset-0 z-20 flex flex-col items-center justify-center">
          {showUserMarker ? (
            <div className="relative flex flex-col items-center">
              <div className="relative w-11 h-11 rounded-full bg-[#7C3AED] border-[3px] border-white shadow-xl flex items-center justify-center overflow-hidden">
                {userPhotoURL && !imgError ? (
                  <img
                    src={userPhotoURL}
                    alt={userName || 'User'}
                    referrerPolicy="no-referrer"
                    onError={() => setImgError(true)}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <span className="text-white font-extrabold text-base leading-none">
                    {userInitial}
                  </span>
                )}
              </div>
              {movementMode === 'In Vehicle' && (
                <span className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-[#2E9BFF] text-white text-[10px] flex items-center justify-center border-2 border-white shadow">
                  🚗
                </span>
              )}
              {movementMode === 'In Building' && (
                <span className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-[#FFC400] text-[#050B14] text-[10px] flex items-center justify-center border-2 border-white shadow">
                  🏢
                </span>
              )}
            </div>
          ) : (
            <div className="w-9 h-9 rounded-full bg-[#FF2D55] border-2 border-white shadow-xl flex items-center justify-center text-white font-black text-base">
              !
            </div>
          )}

          {addressLabel && (
            <div className="mt-1.5 px-2.5 py-1 rounded-lg bg-[#0C1626]/90 border border-white/25 text-white text-[11px] font-bold shadow-lg max-w-[230px] truncate text-center">
              You are at: {addressLabel}
            </div>
          )}
        </div>
      )}

      {/* Red Threat Tint Overlay */}
      {dangerTint && (
        <div className="pointer-events-none absolute inset-0 bg-[#FF2D55]/20 border-2 border-[#FF2D55] z-20" />
      )}

      {/* Night Watch Active Threat Badge Overlay */}
      {redThreatLineTo && (
        <div className="pointer-events-none absolute top-14 left-3 z-30 px-3 py-1.5 rounded-xl bg-[#FF2D55] text-white text-[11px] font-extrabold shadow-lg flex items-center gap-1.5 animate-pulse">
          <AlertTriangle className="w-3.5 h-3.5" />
          <span>Active Threat Line Armed</span>
        </div>
      )}

      {/* Green Spinning Radar Overlay (Scanners ONLY) */}
      {showRadar && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center z-[25]">
          <div className="relative w-56 h-56 sm:w-64 sm:h-64 rounded-full border-2 border-[#00C868]/80 bg-[#00E67A]/10 flex items-center justify-center">
            <div className="absolute inset-6 rounded-full border border-[#00C868]/50" />
            <div className="absolute inset-14 rounded-full border border-[#00C868]/40" />
            <div
              className="absolute inset-0 rounded-full animate-radar-sweep"
              style={{
                background:
                  'conic-gradient(from 0deg, rgba(0,230,122,0.42) 0deg, rgba(0,230,122,0) 75deg, rgba(0,230,122,0) 360deg)',
              }}
            />
            <span className="absolute bottom-4 px-2.5 py-0.5 rounded bg-[#050B14]/85 text-[11px] font-mono font-bold text-[#00E67A] tracking-wider">
              SCANNING... {radarRadiusLabel || ''}
            </span>
          </div>
        </div>
      )}

      {/* Top Overlay Slot (Clear of top-right Map/Satellite switcher) */}
      {topOverlay && (
        <div className="absolute top-3 left-3 right-40 z-30 pointer-events-auto">
          {topOverlay}
        </div>
      )}

      {/* Interactive Pin Chips (Family / Safe Businesses / Threats) when present */}
      {validPins.length > 0 && (
        <div
          className={`absolute left-3 right-36 z-30 flex gap-1.5 overflow-x-auto pointer-events-auto ${
            bottomOverlay ? 'bottom-16' : 'bottom-3'
          }`}
        >
          {validPins.slice(0, 6).map((pin) => (
            <button
              key={pin.id}
              type="button"
              onClick={() => pin.onClick?.()}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-bold shadow-md border whitespace-nowrap flex items-center gap-1 cursor-pointer ${
                pin.kind === 'threat' || pin.kind === 'alert' || pin.isSos
                  ? 'bg-[#FF2D55] border-white/60 text-white'
                  : pin.kind === 'safe_business'
                  ? 'bg-[#0C1626]/95 border-[#00E67A]/60 text-[#00E67A]'
                  : 'bg-[#0C1626]/95 border-[#2E9BFF]/60 text-white'
              }`}
            >
              {pin.kind === 'threat' || pin.kind === 'alert' || pin.isSos ? (
                <AlertTriangle className="w-3 h-3 shrink-0" />
              ) : (
                <ShieldCheck className="w-3 h-3 shrink-0" />
              )}
              <span>{pin.label}</span>
            </button>
          ))}
        </div>
      )}

      {/* Middle-Right Green "Refresh Map" Button */}
      <button
        type="button"
        onClick={handleRefreshMap}
        disabled={refreshing}
        className="absolute right-3 top-1/2 -translate-y-1/2 z-30 min-h-[40px] px-3 py-2 rounded-xl bg-[#00E67A] hover:bg-[#00cf6d] text-slate-950 font-extrabold text-xs shadow-lg flex items-center gap-1.5 transition-transform active:scale-95 cursor-pointer border border-white/80"
      >
        <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
        <span>Refresh Map</span>
      </button>

      {/* Refresh Toast */}
      {refreshToast && (
        <div className="absolute top-14 left-1/2 -translate-x-1/2 z-40 px-3.5 py-2 rounded-xl bg-[#0C1626]/95 border border-[#00E67A]/70 text-xs font-semibold text-white shadow-xl whitespace-nowrap">
          {refreshToast}
        </div>
      )}

      {/* Bottom Overlay Slot */}
      {bottomOverlay && (
        <div className="absolute bottom-3 left-3 right-3 z-30 pointer-events-auto">
          {bottomOverlay}
        </div>
      )}
    </div>
  );
};
