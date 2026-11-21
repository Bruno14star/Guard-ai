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
 * Top 10 Leaderboard Points Formula:
 * (Verified Reports x 100) + (Total Scans x 10) + (Total Usage Days x 20) + (Total Usage Minutes / 60 x 15)
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
 * Africa/Lagos (WAT, UTC+1) date keys for accurate daily scan limits & monthly leaderboards
 */
export function getWatDateKey(date = new Date()): string {
  const watMs = date.getTime() + 60 * 60 * 1000;
  return new Date(watMs).toISOString().slice(0, 10);
}

export function getWatMonthKey(date = new Date()): string {
  return getWatDateKey(date).slice(0, 7);
}

export function isTimestampTodayWat(ts: any): boolean {
  if (!ts) return false;
  const d = typeof ts.toDate === 'function' ? ts.toDate() : new Date(ts);
  if (Number.isNaN(d.getTime())) return false;
  return getWatDateKey(d) === getWatDateKey(new Date());
}

function formatCoordLabel(lat: number, lng: number): string {
  return `Lat: ${lat.toFixed(5)}, Lng: ${lng.toFixed(5)}`;
}

function parseNominatimAddress(data: any, lat: number, lng: number) {
  const addr = data?.address || {};
  const coordFallback = formatCoordLabel(lat, lng);
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
  const city =
    addr.city ||
    addr.town ||
    addr.village ||
    addr.municipality ||
    addr.county ||
    '';
  const rawState = String(addr.state || '').replace(/\s+State$/i, '').trim();
  const state = /federal capital territory|abuja|fct/i.test(rawState)
    ? 'FCT Abuja'
    : /akwa\s*ibom/i.test(rawState)
    ? 'Akwa Ibom'
    : /cross\s*river/i.test(rawState)
    ? 'Cross River'
    : rawState;

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
 * If Nominatim fails, returns Lat, Lng ONLY (never fake placeholder street names).
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
  const fallbackResult = {
    formattedAddress: coordFallback,
    streetName: coordFallback,
    area: '',
    city: '',
    state: '',
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
        return {
          formattedAddress: data.formattedAddress || coordFallback,
          streetName: data.streetName || coordFallback,
          area: data.area || '',
          city: data.city || '',
          state: data.state || '',
          landmark: data.landmark || '',
        };
      }
    }
  } catch {
    // Fall through to Lat, Lng ONLY
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
