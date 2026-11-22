import { useEffect, useState } from 'react';

export const GUARD_USER_PHOTO_KEY = 'guard_user_photo';
export const GUARD_USER_NAME_KEY = 'guard_user_name';
export const GUARD_TUTORIAL_SEEN_KEY = 'guard_tutorial_seen';
export const GUARD_TUTORIAL_STEP_KEY = 'guard_tutorial_step';
export const PROFILE_UPDATED_EVENT = 'guard-profile-updated';

export interface GlobalUserProfile {
  name: string;
  photo: string;
}

function safeGetStorage(key: string): string {
  try {
    return window.localStorage.getItem(key) || '';
  } catch {
    return '';
  }
}

function safeSetStorage(key: string, value: string): boolean {
  try {
    window.localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function safeRemoveStorage(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // ignore storage restriction
  }
}

export function dispatchGlobalProfileUpdated(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(PROFILE_UPDATED_EVENT));
  }
}

/**
 * Single global profile loader reading from localStorage keys:
 * - "guard_user_photo"
 * - "guard_user_name"
 */
export function loadUserProfile(fallback?: {
  name?: string | null;
  photo?: string | null;
}): GlobalUserProfile {
  let name = safeGetStorage(GUARD_USER_NAME_KEY).trim();
  let photo = safeGetStorage(GUARD_USER_PHOTO_KEY).trim();

  if (!name && fallback?.name && fallback.name.trim()) {
    name = fallback.name.trim();
    safeSetStorage(GUARD_USER_NAME_KEY, name);
  }

  if (!photo && fallback?.photo && fallback.photo.trim()) {
    photo = fallback.photo.trim();
    safeSetStorage(GUARD_USER_PHOTO_KEY, photo);
  }

  return {
    name: name || 'Guard AI Member',
    photo,
  };
}

export function saveUserProfilePhoto(photoDataUrl: string): boolean {
  const ok = safeSetStorage(GUARD_USER_PHOTO_KEY, photoDataUrl);
  dispatchGlobalProfileUpdated();
  return ok;
}

export function saveUserProfileName(fullName: string): boolean {
  const cleaned = fullName.trim();
  if (!cleaned) return false;
  const ok = safeSetStorage(GUARD_USER_NAME_KEY, cleaned);
  dispatchGlobalProfileUpdated();
  return ok;
}

export function seedGlobalUserProfile(
  fullName?: string | null,
  photoUrl?: string | null
): void {
  let changed = false;
  const existingName = safeGetStorage(GUARD_USER_NAME_KEY).trim();
  const existingPhoto = safeGetStorage(GUARD_USER_PHOTO_KEY).trim();

  if (!existingName && fullName && fullName.trim()) {
    safeSetStorage(GUARD_USER_NAME_KEY, fullName.trim());
    changed = true;
  }
  if (!existingPhoto && photoUrl && photoUrl.trim()) {
    safeSetStorage(GUARD_USER_PHOTO_KEY, photoUrl.trim());
    changed = true;
  }
  if (changed) dispatchGlobalProfileUpdated();
}

export function getTutorialSeenLocal(): boolean {
  return safeGetStorage(GUARD_TUTORIAL_SEEN_KEY) === 'yes';
}

export function setTutorialSeenLocal(seen: boolean): void {
  if (seen) {
    safeSetStorage(GUARD_TUTORIAL_SEEN_KEY, 'yes');
    safeRemoveStorage(GUARD_TUTORIAL_STEP_KEY);
  } else {
    safeRemoveStorage(GUARD_TUTORIAL_SEEN_KEY);
    safeSetStorage(GUARD_TUTORIAL_STEP_KEY, '0');
  }
}

export function getSavedTutorialStep(): number {
  const raw = safeGetStorage(GUARD_TUTORIAL_STEP_KEY);
  const parsed = Number.parseInt(raw, 10);
  if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 7) {
    return parsed;
  }
  return 0;
}

export function saveTutorialStep(stepIndex: number): void {
  const clamped = Math.max(0, Math.min(7, stepIndex));
  safeSetStorage(GUARD_TUTORIAL_STEP_KEY, String(clamped));
}

/**
 * Compresses an uploaded profile image to max 500x500 pixels and max 500KB
 * for instant localStorage persistence ("guard_user_photo"), plus a <= 140KB
 * variant if optionally mirrored to Firestore.
 */
export function compressImageTo500(
  file: File
): Promise<{ localDataUrl: string; firestoreSafeDataUrl: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read selected image file.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Invalid image file.'));
      img.onload = () => {
        const MAX_DIM = 500;
        const scale = Math.min(1, MAX_DIM / Math.max(img.width || 1, img.height || 1));
        const width = Math.max(1, Math.round(img.width * scale));
        const height = Math.max(1, Math.round(img.height * scale));

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Canvas context unavailable.'));
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);

        const maxBytesLocal = 500 * 1024;
        const maxCharsFirestore = 140000;

        let quality = 0.88;
        let localDataUrl = canvas.toDataURL('image/jpeg', quality);
        while (localDataUrl.length * 0.75 > maxBytesLocal && quality > 0.25) {
          quality -= 0.1;
          localDataUrl = canvas.toDataURL('image/jpeg', quality);
        }

        // If still > 500KB at low quality, downscale canvas slightly
        if (localDataUrl.length * 0.75 > maxBytesLocal) {
          const smallCanvas = document.createElement('canvas');
          smallCanvas.width = Math.min(360, width);
          smallCanvas.height = Math.min(360, height);
          const sctx = smallCanvas.getContext('2d');
          sctx?.drawImage(canvas, 0, 0, smallCanvas.width, smallCanvas.height);
          localDataUrl = smallCanvas.toDataURL('image/jpeg', 0.78);
        }

        // Compact <= 140KB version for Firestore sync limit (<= 150000 chars)
        let firestoreSafeDataUrl = localDataUrl;
        if (firestoreSafeDataUrl.length > maxCharsFirestore) {
          const fsCanvas = document.createElement('canvas');
          const fsSize = 220;
          const fsScale = Math.min(1, fsSize / Math.max(width, height));
          fsCanvas.width = Math.max(1, Math.round(width * fsScale));
          fsCanvas.height = Math.max(1, Math.round(height * fsScale));
          const fctx = fsCanvas.getContext('2d');
          fctx?.drawImage(canvas, 0, 0, fsCanvas.width, fsCanvas.height);
          let fq = 0.78;
          firestoreSafeDataUrl = fsCanvas.toDataURL('image/jpeg', fq);
          while (firestoreSafeDataUrl.length > maxCharsFirestore && fq > 0.3) {
            fq -= 0.1;
            firestoreSafeDataUrl = fsCanvas.toDataURL('image/jpeg', fq);
          }
        }

        resolve({ localDataUrl, firestoreSafeDataUrl });
      };
      img.src = String(reader.result || '');
    };
    reader.readAsDataURL(file);
  });
}

/**
 * Reactive hook backed by loadUserProfile() so every component updates
 * instantly when "guard_user_photo" or "guard_user_name" changes.
 */
export function useGlobalUserProfile(
  fallbackName?: string | null,
  fallbackPhoto?: string | null
): GlobalUserProfile {
  const [profile, setProfile] = useState<GlobalUserProfile>(() =>
    loadUserProfile({ name: fallbackName, photo: fallbackPhoto })
  );

  useEffect(() => {
    setProfile(loadUserProfile({ name: fallbackName, photo: fallbackPhoto }));

    const handleSync = () => {
      setProfile(loadUserProfile({ name: fallbackName, photo: fallbackPhoto }));
    };

    window.addEventListener(PROFILE_UPDATED_EVENT, handleSync);
    window.addEventListener('storage', handleSync);
    return () => {
      window.removeEventListener(PROFILE_UPDATED_EVENT, handleSync);
      window.removeEventListener('storage', handleSync);
    };
  }, [fallbackName, fallbackPhoto]);

  return profile;
}
