import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AdvancedMarker,
  Map as GoogleMap,
  useApiIsLoaded,
  useMap,
  useMapsLibrary,
} from '@vis.gl/react-google-maps';
import { Car, Home, RefreshCw, AlertTriangle, ShieldCheck } from 'lucide-react';
import { MovementMode } from '../types';
import { UserAvatar } from './UserAvatar';

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

const DEFAULT_FALLBACK_CENTER = { lat: 6.5244, lng: 3.3792 };

const RouteAndBoundsController: React.FC<{
  userLat: number | null;
  userLng: number | null;
  pins: MapPinItem[];
  fitPinsBounds: boolean;
  routeOrigin?: { lat: number; lng: number } | null;
  routeDestination?: { lat: number; lng: number } | null;
  redThreatLineTo?: { lat: number; lng: number } | null;
  onRouteResult?: (summary: string | null) => void;
}> = ({
  userLat,
  userLng,
  pins,
  fitPinsBounds,
  routeOrigin,
  routeDestination,
  redThreatLineTo,
  onRouteResult,
}) => {
  const map = useMap();
  const routesLib = useMapsLibrary('routes');
  const mapsLib = useMapsLibrary('maps');
  const coreLib = useMapsLibrary('core');
  const polylinesRef = useRef<any[]>([]);
  const threatLineRef = useRef<any | null>(null);
  const blinkTimerRef = useRef<number | null>(null);

  // Fit bounds when tracking multiple family pins
  useEffect(() => {
    if (!map || !coreLib || !fitPinsBounds) return;
    const validPins = pins.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
    if (validPins.length === 0 && (userLat === null || userLng === null)) return;

    const bounds = new coreLib.LatLngBounds();
    if (userLat !== null && userLng !== null) {
      bounds.extend({ lat: userLat, lng: userLng });
    }
    validPins.slice(0, 10).forEach((p) => bounds.extend({ lat: p.lat, lng: p.lng }));
    if (validPins.length > 0) {
      map.fitBounds(bounds, 64);
    }
  }, [map, coreLib, pins, fitPinsBounds, userLat, userLng]);

  // Compute real safe route using modern Routes API (Route.computeRoutes)
  useEffect(() => {
    polylinesRef.current.forEach((p) => p.setMap(null));
    polylinesRef.current = [];
    if (blinkTimerRef.current) {
      clearInterval(blinkTimerRef.current);
      blinkTimerRef.current = null;
    }

    if (!map || !routesLib || !routeOrigin || !routeDestination) {
      return;
    }

    let cancelled = false;
    const request: Record<string, unknown> = {
      origin: { lat: routeOrigin.lat, lng: routeOrigin.lng },
      destination: { lat: routeDestination.lat, lng: routeDestination.lng },
      travelMode: 'DRIVING',
      provideRouteAlternatives: true,
      fields: ['path', 'distanceMeters', 'durationMillis', 'viewport', 'legs'],
    };

    (routesLib.Route as unknown as { computeRoutes: (req: Record<string, unknown>) => Promise<{ routes: any[] }> })
      .computeRoutes(request)
      .then(({ routes }) => {
        if (cancelled) return;
        if (!routes || routes.length === 0) {
          onRouteResult?.('Stay where you are. Do not move. Call for help.');
          return;
        }
        const chosen = routes[routes.length > 1 ? 1 : 0];
        const created: any[] = chosen.createPolylines();
        let visible = true;
        created.forEach((poly) => {
          poly.setOptions({
            strokeColor: '#2E9BFF',
            strokeOpacity: 0,
            strokeWeight: 5,
            icons: [
              {
                icon: {
                  path: 'M 0,-1 0,1',
                  strokeOpacity: 1,
                  scale: 4,
                  strokeColor: '#2E9BFF',
                },
                offset: '0',
                repeat: '16px',
              },
            ],
          });
          poly.setMap(map);
        });
        polylinesRef.current = created;

        blinkTimerRef.current = window.setInterval(() => {
          visible = !visible;
          created.forEach((poly) => {
            poly.setOptions({
              icons: [
                {
                  icon: {
                    path: 'M 0,-1 0,1',
                    strokeOpacity: visible ? 1 : 0.25,
                    scale: 4,
                    strokeColor: '#00E5FF',
                  },
                  offset: '0',
                  repeat: '16px',
                },
              ],
            });
          });
        }, 550);

        if (chosen.viewport) {
          map.fitBounds(chosen.viewport, 50);
        }

        const km = ((chosen.distanceMeters ?? 0) / 1000).toFixed(1);
        const mins = Math.max(1, Math.round((chosen.durationMillis ?? 0) / 60000));
        const firstStep = chosen.legs?.[0]?.steps?.[0]?.instructions || 'Main Safe Road';
        const cleanStep = String(firstStep).replace(/<[^>]+>/g, '');
        onRouteResult?.(`Safe Route via ${cleanStep} • ${km}km • ${mins} mins`);
      })
      .catch((err: unknown) => {
        console.error('Route computeRoutes error:', err);
        const msg = err instanceof Error ? err.message : '';
        if (msg.includes('OVER_QUERY_LIMIT') || msg.includes('429')) {
          window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
        }
        onRouteResult?.('Unable to compute safe route right now. Stay cautious.');
      });

    return () => {
      cancelled = true;
      polylinesRef.current.forEach((p) => p.setMap(null));
      polylinesRef.current = [];
      if (blinkTimerRef.current) clearInterval(blinkTimerRef.current);
    };
  }, [map, routesLib, routeOrigin, routeDestination, onRouteResult]);

  // Blinking dotted RED line for Night Watch active threat
  useEffect(() => {
    if (threatLineRef.current) {
      threatLineRef.current.setMap(null);
      threatLineRef.current = null;
    }
    if (!map || !mapsLib || !redThreatLineTo || userLat === null || userLng === null) return;
    const poly = new mapsLib.Polyline({
      path: [
        { lat: userLat, lng: userLng },
        { lat: redThreatLineTo.lat, lng: redThreatLineTo.lng },
      ],
      strokeOpacity: 0,
      icons: [
        {
          icon: {
            path: 'M 0,-1 0,1',
            strokeOpacity: 1,
            scale: 4,
            strokeColor: '#FF2D55',
          },
          offset: '0',
          repeat: '14px',
        },
      ],
      map,
    });
    threatLineRef.current = poly;
    return () => {
      poly.setMap(null);
    };
  }, [map, mapsLib, redThreatLineTo, userLat, userLng]);

  return null;
};

const ImperativeMapCenterer: React.FC<{
  targetCenter: { lat: number; lng: number } | null;
  targetZoom: number | null;
}> = ({ targetCenter, targetZoom }) => {
  const map = useMap();
  useEffect(() => {
    if (!map || !targetCenter) return;
    map.panTo(targetCenter);
    if (targetZoom !== null) {
      map.setZoom(targetZoom);
    }
  }, [map, targetCenter, targetZoom]);
  return null;
};

export const GuardMap: React.FC<GuardMapProps> = ({
  userLat,
  userLng,
  userName,
  userPhotoURL,
  movementMode = 'Walking',
  pins = [],
  fitPinsBounds = false,
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
  const isApiLoaded = useApiIsLoaded();
  const [refreshToast, setRefreshToast] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [manualCenter, setManualCenter] = useState<{ lat: number; lng: number } | null>(null);
  const [manualZoom, setManualZoom] = useState<number | null>(null);

  const hasLiveGps = userLat !== null && userLng !== null && Number.isFinite(userLat) && Number.isFinite(userLng);
  const center = hasLiveGps ? { lat: userLat as number, lng: userLng as number } : DEFAULT_FALLBACK_CENTER;

  const handleRefreshMap = useCallback(() => {
    if (!navigator.geolocation) {
      setRefreshToast('Please turn on your GPS / Location');
      return;
    }
    setRefreshing(true);
    const applyPos = (pos: GeolocationPosition) => {
      const { latitude, longitude, accuracy } = pos.coords;
      setManualCenter({ lat: latitude, lng: longitude });
      setManualZoom(17);
      onRefreshLocation?.(latitude, longitude, accuracy);
      setRefreshToast('Map refreshed! This is your exact location now.');
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
          { enableHighAccuracy: false, timeout: 6000, maximumAge: 30000 }
        );
      },
      { enableHighAccuracy: true, timeout: 6000, maximumAge: 10000 }
    );
  }, [onRefreshLocation]);

  return (
    <div className={`relative w-full ${heightClassName} rounded-2xl overflow-hidden border border-slate-800 bg-[#071120]`}>
      {isApiLoaded && hasLiveGps ? (
        <GoogleMap
          mapId="DEMO_MAP_ID"
          defaultCenter={center}
          defaultZoom={16}
          gestureHandling="greedy"
          disableDefaultUI={true}
          colorScheme="DARK"
          internalUsageAttributionIds={['gmp_mcp_codeassist_v1_aistudio']}
          style={{ width: '100%', height: '100%' }}
        >
          <ImperativeMapCenterer targetCenter={manualCenter} targetZoom={manualZoom} />

          <RouteAndBoundsController
            userLat={userLat}
            userLng={userLng}
            pins={pins}
            fitPinsBounds={fitPinsBounds}
            routeOrigin={routeOrigin}
            routeDestination={routeDestination}
            redThreatLineTo={redThreatLineTo}
            onRouteResult={onRouteResult}
          />

          {/* Live User Marker */}
          {showUserMarker && hasLiveGps && (
            <AdvancedMarker position={{ lat: userLat as number, lng: userLng as number }} zIndex={999}>
              <div className="relative flex flex-col items-center">
                <div className="relative flex items-center justify-center">
                  <UserAvatar photoURL={userPhotoURL} name={userName} size="md" greenBorder={true} />
                  {movementMode === 'In Vehicle' && (
                    <span className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-[#2E9BFF] text-white flex items-center justify-center ring-2 ring-[#050B14]">
                      <Car className="w-3 h-3" />
                    </span>
                  )}
                  {movementMode === 'In Building' && (
                    <span className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-[#FFC400] text-slate-950 flex items-center justify-center ring-2 ring-[#050B14]">
                      <Home className="w-3 h-3" />
                    </span>
                  )}
                </div>
              </div>
            </AdvancedMarker>
          )}

          {/* Other Pins: Family, Threat Flags, Safe Businesses, Alerts */}
          {pins.map((pin) => {
            if (!Number.isFinite(pin.lat) || !Number.isFinite(pin.lng)) return null;
            return (
              <AdvancedMarker
                key={pin.id}
                position={{ lat: pin.lat, lng: pin.lng }}
                onClick={pin.onClick}
                zIndex={pin.kind === 'threat' || pin.isSos ? 950 : 500}
              >
                {pin.kind === 'family' ? (
                  <div className="flex flex-col items-center">
                    <div
                      className={`rounded-full p-0.5 ${
                        pin.isSos
                          ? 'bg-[#FF2D55] animate-pulse'
                          : pin.isOnline
                          ? 'bg-[#00E67A]'
                          : 'bg-slate-500'
                      }`}
                    >
                      <UserAvatar photoURL={pin.photoURL} name={pin.label} size="sm" greenBorder={false} />
                    </div>
                    <span className="mt-0.5 px-1.5 py-0.5 rounded bg-[#050B14]/90 text-[10px] font-semibold text-white whitespace-nowrap border border-slate-700">
                      {pin.label}
                    </span>
                  </div>
                ) : pin.kind === 'threat' || pin.kind === 'alert' ? (
                  <div className="flex flex-col items-center">
                    <div className="w-8 h-8 rounded-full bg-[#FF2D55] text-white flex items-center justify-center shadow-lg ring-2 ring-white/80 animate-bounce">
                      <AlertTriangle className="w-4 h-4" />
                    </div>
                    <span className="mt-0.5 px-2 py-0.5 rounded bg-[#FF2D55] text-[10px] font-bold text-white whitespace-nowrap max-w-[180px] truncate">
                      {pin.label}
                    </span>
                  </div>
                ) : (
                  <div className="flex flex-col items-center">
                    <div className="w-8 h-8 rounded-full bg-[#00E67A] text-slate-950 flex items-center justify-center shadow-md ring-2 ring-[#050B14]">
                      <ShieldCheck className="w-4 h-4" />
                    </div>
                    <span className="mt-0.5 px-1.5 py-0.5 rounded bg-[#050B14]/90 text-[10px] font-semibold text-[#00E67A] whitespace-nowrap border border-[#00E67A]/40">
                      {pin.label}
                    </span>
                  </div>
                )}
              </AdvancedMarker>
            );
          })}
        </GoogleMap>
      ) : (
        <div className="w-full h-full flex flex-col items-center justify-center text-center p-6 bg-[#071120]">
          <p className="text-sm font-semibold text-slate-200">
            {hasLiveGps
              ? 'Loading live map view...'
              : 'WAITING FOR LIVE SIGNAL... Enable location permission to center map.'}
          </p>
        </div>
      )}

      {/* Red Threat Tint Overlay */}
      {dangerTint && (
        <div className="pointer-events-none absolute inset-0 bg-[#FF2D55]/20 border-2 border-[#FF2D55] z-10" />
      )}

      {/* Green Spinning Radar Overlay (Scanners ONLY, transparent so street names stay readable) */}
      {showRadar && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center z-10">
          <div className="relative w-56 h-56 sm:w-64 sm:h-64 rounded-full border-2 border-[#00E67A]/70 bg-[#00E67A]/10 flex items-center justify-center">
            <div className="absolute inset-6 rounded-full border border-[#00E67A]/45" />
            <div className="absolute inset-14 rounded-full border border-[#00E67A]/35" />
            {/* Rotating sweep wedge */}
            <div
              className="absolute inset-0 rounded-full animate-radar-sweep"
              style={{
                background:
                  'conic-gradient(from 0deg, rgba(0,230,122,0.42) 0deg, rgba(0,230,122,0) 75deg, rgba(0,230,122,0) 360deg)',
              }}
            />
            {/* Center red dot */}
            <div className="w-3.5 h-3.5 rounded-full bg-[#FF2D55] ring-2 ring-white z-10" />
            <span className="absolute bottom-4 px-2 py-0.5 rounded bg-[#050B14]/75 text-[11px] font-mono font-bold text-[#00E67A] tracking-wider">
              SCANNING... {radarRadiusLabel || ''}
            </span>
          </div>
        </div>
      )}

      {/* Top Overlay Slot (Banners, Threat Alerts, Night Watch Buttons) */}
      {topOverlay && (
        <div className="absolute top-3 left-3 right-3 z-20 pointer-events-auto">
          {topOverlay}
        </div>
      )}

      {/* Middle-Right Green "Refresh Map" Button */}
      <button
        type="button"
        onClick={handleRefreshMap}
        disabled={refreshing}
        className="absolute right-3 top-1/2 -translate-y-1/2 z-20 min-h-[40px] px-3 py-2 rounded-xl bg-[#00E67A] hover:bg-[#00cf6d] text-slate-950 font-bold text-xs shadow-lg flex items-center gap-1.5 transition-transform active:scale-95 cursor-pointer"
      >
        <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
        <span>Refresh Map</span>
      </button>

      {/* Refresh Toast */}
      {refreshToast && (
        <div className="absolute top-14 left-1/2 -translate-x-1/2 z-30 px-3 py-2 rounded-xl bg-[#0C1626]/95 border border-[#00E67A]/60 text-xs font-semibold text-white shadow-xl whitespace-nowrap">
          {refreshToast}
        </div>
      )}

      {/* Bottom Overlay Slot (Action Buttons sitting cleanly ON TOP of Map) */}
      {bottomOverlay && (
        <div className="absolute bottom-3 left-3 right-3 z-20 pointer-events-auto">
          {bottomOverlay}
        </div>
      )}
    </div>
  );
};
