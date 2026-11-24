import { MovementMode } from '../types';

const EARTH_RADIUS_METERS = 6371000;

/**
 * Haversine distance in meters between two WGS84 coordinates.
 */
export function haversineMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(a)));
}

export function formatDistanceLabel(meters: number): string {
  if (!Number.isFinite(meters) || meters < 0) return 'Distance unknown';
  if (meters < 1000) return `${Math.round(meters)}m away`;
  return `${(meters / 1000).toFixed(1)}km away`;
}

/**
 * REAL PHYSICS 1: Walking / Vehicle / Building detection
 */
export function detectMovementMode(params: {
  speedMps: number;
  accelVariance: number;
  accuracyMeters: number;
  stationaryMs: number;
  headingStable: boolean;
}): MovementMode {
  const { speedMps, accelVariance, accuracyMeters, stationaryMs, headingStable } = params;
  if (speedMps < 1.5 && accelVariance > 0.3) return 'Walking';
  if (speedMps > 6.0 && accelVariance < 0.15 && headingStable) return 'In Vehicle';
  if (speedMps < 0.5 && stationaryMs > 5 * 60 * 1000 && accuracyMeters > 25) {
    return 'In Building';
  }
  return 'Walking';
}

/**
 * REAL PHYSICS 2: Inverse Square Law gunshot distance estimate (urban block corrected)
 */
export function estimateGunshotDistanceMeters(splDb: number): number {
  const clampedSpl = Math.max(60, Math.min(145, splDb));
  const freeFieldMeters = Math.pow(10, (160 - clampedSpl) / 20);
  return Math.round(Math.max(20, Math.min(1500, freeFieldMeters * 0.4)));
}

/**
 * Convert heading (degrees) to compass sector label
 */
export function headingToSector(headingDeg: number | null | undefined): string {
  const h = Number.isFinite(headingDeg) ? ((headingDeg as number) % 360 + 360) % 360 : 0;
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return dirs[Math.round(h / 45) % 8];
}

/**
 * Offset a coordinate by distance (m) and bearing (deg) for estimated sector visualization
 */
export function offsetLatLng(
  lat: number,
  lng: number,
  distanceMeters: number,
  bearingDeg: number
): { lat: number; lng: number } {
  const brng = (bearingDeg * Math.PI) / 180;
  const angDist = distanceMeters / EARTH_RADIUS_METERS;
  const lat1 = (lat * Math.PI) / 180;
  const lng1 = (lng * Math.PI) / 180;
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angDist) +
      Math.cos(lat1) * Math.sin(angDist) * Math.cos(brng)
  );
  const lng2 =
    lng1 +
    Math.atan2(
      Math.sin(brng) * Math.sin(angDist) * Math.cos(lat1),
      Math.cos(angDist) - Math.sin(lat1) * Math.sin(lat2)
    );
  return {
    lat: (lat2 * 180) / Math.PI,
    lng: (lng2 * 180) / Math.PI,
  };
}

/**
 * Guard AI Verification Score Formula:
 * V = (0.35 * Video_Auth) + (0.25 * Audio_Match) + (0.20 * Location_Consistency) + (0.20 * Cross_Report)
 */
export function computeGuardAiVerificationScore(input: {
  hasLiveVideo: boolean;
  videoDurationSec: number;
  videoTimestampDiffMs: number;
  audioMatchConfidence: number;
  distanceBetweenVideoAndUserMeters: number;
  nearbyReportsCount: number;
}): {
  videoAuth: number;
  audioMatch: number;
  locationConsistency: number;
  crossReport: number;
  totalScore: number;
  verdict: 'LIKELY TRUE' | 'NEEDS HUMAN REVIEW';
} {
  const videoAuth =
    input.hasLiveVideo &&
    input.videoDurationSec >= 15 &&
    input.videoTimestampDiffMs <= 10 * 60 * 1000 &&
    input.distanceBetweenVideoAndUserMeters <= 500
      ? 1
      : input.hasLiveVideo && input.videoDurationSec >= 15
      ? 0.75
      : 0;

  const audioMatch = Math.max(0, Math.min(1, input.audioMatchConfidence));

  const locationConsistency =
    input.distanceBetweenVideoAndUserMeters <= 500 ? 1 : 0;

  const crossReport = input.nearbyReportsCount >= 1 ? 0.7 : 0.2;

  const totalScore =
    0.35 * videoAuth +
    0.25 * audioMatch +
    0.2 * locationConsistency +
    0.2 * crossReport;

  return {
    videoAuth: Number(videoAuth.toFixed(2)),
    audioMatch: Number(audioMatch.toFixed(2)),
    locationConsistency: Number(locationConsistency.toFixed(2)),
    crossReport: Number(crossReport.toFixed(2)),
    totalScore: Number(totalScore.toFixed(2)),
    verdict: totalScore >= 0.75 ? 'LIKELY TRUE' : 'NEEDS HUMAN REVIEW',
  };
}

/**
 * REAL PHYSICS 4: Safe Vehicle Score
 */
export function computeSafeVehicleScore(input: {
  verifiedDriver: boolean;
  positiveReportsLast30Days: number;
  plateMatchesRegistered: boolean;
}): { score: number; badge: 'Guard AI Safe - Verified Driver' | 'Unknown - Scan with caution' } {
  const vd = input.verifiedDriver ? 1 : 0;
  const pr = input.positiveReportsLast30Days >= 2 ? 1 : 0;
  const pm = input.plateMatchesRegistered ? 1 : 0;
  const score = 0.5 * vd + 0.3 * pr + 0.2 * pm;
  return {
    score: Number(score.toFixed(2)),
    badge: score >= 0.7 ? 'Guard AI Safe - Verified Driver' : 'Unknown - Scan with caution',
  };
}

/**
 * Legacy helper retained for fallback telemetry compatibility
 */
export function computeLeaderboardPoints(input: {
  verifiedReports: number;
  totalScans: number;
  totalUsageDays: number;
  totalUsageMinutes: number;
}): number {
  const pts =
    input.verifiedReports * 100 +
    input.totalScans * 10 +
    input.totalUsageDays * 20 +
    (input.totalUsageMinutes / 60) * 15;
  return Math.round(pts);
}

/**
 * West Africa Time (WAT, UTC+1) helpers for daily caps & monthly Top 10 cycles
 */
export function getWatDateKey(date = new Date()): string {
  const watMs = date.getTime() + 60 * 60 * 1000;
  return new Date(watMs).toISOString().slice(0, 10);
}

export function getWatMonthKey(date = new Date()): string {
  return getWatDateKey(date).slice(0, 7);
}

export function getWatHour(date = new Date()): number {
  const watMs = date.getTime() + 60 * 60 * 1000;
  return new Date(watMs).getUTCHours();
}

/**
 * Night Watch is ONLY active/scored between 7:00 PM (19) and 6:00 AM (< 6) WAT.
 * Returns a night session key so 22:00 today & 03:00 tomorrow count toward the SAME night!
 */
export function isNightWatchWindowWat(date = new Date()): boolean {
  const h = getWatHour(date);
  return h >= 19 || h < 6;
}

export function getNightWatchKeyWat(date = new Date()): string {
  const h = getWatHour(date);
  const watMs = date.getTime() + 60 * 60 * 1000;
  if (h < 6) {
    // 00:00-05:59 WAT belongs to the previous calendar night
    return new Date(watMs - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  }
  return new Date(watMs).toISOString().slice(0, 10);
}

export function isTimestampTodayWat(ts: any): boolean {
  if (!ts) return false;
  const d = typeof ts.toDate === 'function' ? ts.toDate() : new Date(ts);
  if (Number.isNaN(d.getTime())) return false;
  return getWatDateKey(d) === getWatDateKey(new Date());
}

/**
 * Explicit Nigerian GPS coordinate checks (NEVER defaults to Lagos).
 * - Port Harcourt metro bounding box: lat 4.72–4.92, lng 6.88–7.12 (includes 4.75-4.85, 6.9-7.1)
 * - Greater Rivers State bounding box: lat 4.35–5.22, lng 6.38–7.58
 */
export function isCoordsInPortHarcourt(lat: number, lng: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= 4.72 &&
    lat <= 4.92 &&
    lng >= 6.88 &&
    lng <= 7.12
  );
}

export function isCoordsInRiversState(lat: number, lng: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= 4.35 &&
    lat <= 5.22 &&
    lng >= 6.38 &&
    lng <= 7.58
  );
}

export function inferNigerianCityStateFromCoords(
  lat: number,
  lng: number
): { city: string; state: string } {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return { city: '', state: '' };
  }
  if (isCoordsInPortHarcourt(lat, lng)) {
    return { city: 'Port Harcourt', state: 'Rivers' };
  }
  if (isCoordsInRiversState(lat, lng)) {
    return { city: 'Port Harcourt', state: 'Rivers' };
  }
  if (lat >= 8.9 && lat <= 9.2 && lng >= 7.3 && lng <= 7.6) {
    return { city: 'Abuja', state: 'FCT Abuja' };
  }
  if (lat >= 6.35 && lat <= 6.72 && lng >= 3.05 && lng <= 3.72) {
    return { city: 'Lagos', state: 'Lagos' };
  }
  return { city: '', state: '' };
}

export function isLocationStale7Days(locationUpdatedAt: unknown): boolean {
  if (!locationUpdatedAt) return false;
  let ms = 0;
  if (typeof locationUpdatedAt === 'number') {
    ms = locationUpdatedAt;
  } else if (typeof locationUpdatedAt === 'string') {
    ms = Date.parse(locationUpdatedAt);
  } else if (typeof locationUpdatedAt === 'object') {
    const o = locationUpdatedAt as { toMillis?: () => number; seconds?: number };
    if (typeof o.toMillis === 'function') ms = o.toMillis();
    else if (typeof o.seconds === 'number') ms = o.seconds * 1000;
  }
  if (!ms || !Number.isFinite(ms)) return false;
  return Date.now() - ms > 7 * 24 * 60 * 60 * 1000;
}

export function formatCityStateLabel(city?: string, state?: string): string {
  const c = (city || '').trim();
  const s = (state || '').trim();
  if (!c && !s) return 'Location Not Set';
  if (c && s && c.toLowerCase() !== s.toLowerCase()) return `${c}, ${s}`;
  return c || s;
}

function formatCoordLabel(lat: number, lng: number): string {
  return `Lat: ${lat.toFixed(5)}, Lng: ${lng.toFixed(5)}`;
}

function parseNominatimAddress(data: any, lat: number, lng: number) {
  const addr = data?.address || {};
  const coordFallback = formatCoordLabel(lat, lng);
  const coordHint = inferNigerianCityStateFromCoords(lat, lng);

  const road =
    addr.road ||
    addr.street ||
    addr.pedestrian ||
    addr.residential ||
    addr.footway ||
    addr.path ||
    '';
  const housePrefix = addr.house_number ? `${addr.house_number} ` : '';
  const suburb =
    addr.suburb ||
    addr.neighbourhood ||
    addr.quarter ||
    addr.city_district ||
    '';
  const rawCity =
    addr.city ||
    addr.town ||
    addr.village ||
    addr.municipality ||
    addr.county ||
    '';
  const rawState = String(addr.state || '').replace(/\s+State$/i, '').trim();
  let state = /federal capital territory|abuja|fct/i.test(rawState)
    ? 'FCT Abuja'
    : /akwa\s*ibom/i.test(rawState)
    ? 'Akwa Ibom'
    : /cross\s*river/i.test(rawState)
    ? 'Cross River'
    : rawState;

  let city = rawCity;
  if (isCoordsInPortHarcourt(lat, lng)) {
    city = 'Port Harcourt';
    state = 'Rivers';
  } else if (isCoordsInRiversState(lat, lng)) {
    state = state || 'Rivers';
    if (!city || /obio\/?akpor|eleme|oyigbo|ikwerre/i.test(city)) {
      city = city || 'Port Harcourt';
    }
  } else {
    city = city || coordHint.city;
    state = state || coordHint.state;
  }

  const displayFirstPart =
    typeof data?.display_name === 'string' && data.display_name.trim()
      ? data.display_name.split(',')[0].trim()
      : '';

  const streetName =
    (road ? `${housePrefix}${road}` : '') ||
    suburb ||
    displayFirstPart ||
    coordFallback;

  const area = suburb || city || '';
  const landmark =
    addr.amenity ||
    addr.shop ||
    addr.building ||
    addr.office ||
    addr.commercial ||
    suburb ||
    city ||
    '';

  const parts = Array.from(
    new Set([road ? `${housePrefix}${road}` : '', suburb, city, state].filter(Boolean))
  );
  const formattedAddress =
    parts.join(', ') ||
    (typeof data?.display_name === 'string' && data.display_name.trim()) ||
    coordFallback;

  return {
    formattedAddress,
    streetName,
    area,
    city,
    state,
    landmark,
  };
}

/**
 * Reverse geocode lat/lng to real human street address via Nominatim.
 * Uses GPS bounding check (e.g. Port Harcourt 4.75-4.85, 6.9-7.1) if Nominatim returns sparse fields.
 * NEVER defaults to Lagos or fake placeholder street names.
 */
export async function reverseGeocodeHuman(lat: number, lng: number): Promise<{
  formattedAddress: string;
  streetName: string;
  area: string;
  city: string;
  state: string;
  landmark: string;
}> {
  const coordFallback = formatCoordLabel(lat, lng);
  const coordHint = inferNigerianCityStateFromCoords(lat, lng);
  const fallbackResult = {
    formattedAddress: coordHint.city ? `${coordHint.city}, ${coordHint.state} (${coordFallback})` : coordFallback,
    streetName: coordFallback,
    area: '',
    city: coordHint.city,
    state: coordHint.state,
    landmark: '',
  };

  // 1. Direct Nominatim reverse geocoding
  try {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 5000);
    const nomUrl = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${encodeURIComponent(
      lat
    )}&lon=${encodeURIComponent(lng)}&addressdetails=1&accept-language=en`;
    const nRes = await fetch(nomUrl, { signal: controller.signal });
    window.clearTimeout(timer);

    if (nRes.ok) {
      const data = await nRes.json();
      if (data && (data.address || data.display_name)) {
        return parseNominatimAddress(data, lat, lng);
      }
    }
  } catch {
    // Fall through to backend proxy if direct Nominatim blocked
  }

  // 2. Fallback to backend /api/geocode/reverse proxy (which also queries Nominatim)
  try {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 4500);
    const res = await fetch(
      `/api/geocode/reverse?lat=${encodeURIComponent(lat)}&lng=${encodeURIComponent(lng)}`,
      { signal: controller.signal }
    );
    window.clearTimeout(timer);

    const contentType = res.headers.get('content-type') || '';
    if (res.ok && contentType.includes('application/json')) {
      const data = await res.json();
      if (data && data.source === 'nominatim' && data.formattedAddress) {
        const isPH = isCoordsInPortHarcourt(lat, lng);
        const isRiv = isCoordsInRiversState(lat, lng);
        return {
          formattedAddress: data.formattedAddress || coordFallback,
          streetName: data.streetName || coordFallback,
          area: data.area || '',
          city: isPH ? 'Port Harcourt' : data.city || coordHint.city || '',
          state: isPH || isRiv ? 'Rivers' : data.state || coordHint.state || '',
          landmark: data.landmark || '',
        };
      }
    }
  } catch {
    // Fall through to coordinate hint / Lat, Lng ONLY
  }

  return fallbackResult;
}

/**
 * Free OpenStreetMap Overpass API lookup for nearest real public shelter (police, hospital, mall, church)
 */
export async function findNearestSafePlaceFree(
  lat: number,
  lng: number
): Promise<string> {
  try {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 4500);
    const overpassQuery = `[out:json][timeout:4];(node["amenity"~"police|hospital|clinic|place_of_worship"](around:2500,${lat},${lng});node["shop"="mall"](around:2500,${lat},${lng}););out body 5;`;
    const res = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      body: `data=${encodeURIComponent(overpassQuery)}`,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      signal: controller.signal,
    });
    window.clearTimeout(timer);
    if (res.ok) {
      const json = await res.json();
      const named = (json?.elements || []).find((el: any) => el?.tags?.name);
      if (named?.tags?.name) {
        return String(named.tags.name);
      }
    }
  } catch {
    // Silent fallback
  }
  return 'Nearest Public Safe Building';
}
