import { useEffect, useState } from 'react';

export const GUARD_TUTORIAL_SEEN_KEY = 'guard_tutorial_seen';
export const GUARD_TUTORIAL_STEP_KEY = 'guard_tutorial_step';
export const PROFILE_UPDATED_EVENT = 'guard-profile-updated';

// Legacy localStorage keys removed permanently so base64/stale avatars NEVER pollute app state
const LEGACY_PHOTO_KEY = 'guard_user_photo';
const LEGACY_NAME_KEY = 'guard_user_name';

export interface GlobalUserProfile {
  name: string;
  photo: string;
}

// In-memory global cache driven purely by Firestore `profilePicUrl` / `photoURL`
let inMemoryProfile: GlobalUserProfile = {
  name: '',
  photo: '',
};

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

// Immediately purge any legacy localStorage base64/photo cache on module load
if (typeof window !== 'undefined') {
  safeRemoveStorage(LEGACY_PHOTO_KEY);
  safeRemoveStorage(LEGACY_NAME_KEY);
}

export function dispatchGlobalProfileUpdated(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(PROFILE_UPDATED_EVENT));
  }
}

/**
 * Sets in-memory profile directly from Firestore values (NEVER writes photos to localStorage or base64).
 */
export function loadUserProfile(fallback?: {
  name?: string | null;
  photo?: string | null;
}): GlobalUserProfile {
  const nextName = (fallback?.name || '').trim() || inMemoryProfile.name || 'Guard AI Member';
  const nextPhoto = (fallback?.photo || '').trim() || inMemoryProfile.photo || '';
  return {
    name: nextName,
    photo: nextPhoto,
  };
}

export function saveUserProfilePhoto(cloudPhotoUrl: string): boolean {
  const trimmed = cloudPhotoUrl.trim();
  if (!trimmed) return false;
  inMemoryProfile = { ...inMemoryProfile, photo: trimmed };
  safeRemoveStorage(LEGACY_PHOTO_KEY);
  dispatchGlobalProfileUpdated();
  return true;
}

export function saveUserProfileName(fullName: string): boolean {
  const cleaned = fullName.trim();
  if (!cleaned) return false;
  inMemoryProfile = { ...inMemoryProfile, name: cleaned };
  dispatchGlobalProfileUpdated();
  return true;
}

export function clearInMemoryUserProfileOnSignOut(): void {
  inMemoryProfile = { name: '', photo: '' };
  dispatchGlobalProfileUpdated();
}

export function seedGlobalUserProfile(
  fullName?: string | null,
  photoUrl?: string | null
): void {
  let changed = false;
  if (fullName && fullName.trim() && inMemoryProfile.name !== fullName.trim()) {
    inMemoryProfile = { ...inMemoryProfile, name: fullName.trim() };
    changed = true;
  }
  // Never overwrite existing non-empty Firestore photo with empty string
  if (photoUrl && photoUrl.trim() && inMemoryProfile.photo !== photoUrl.trim()) {
    inMemoryProfile = { ...inMemoryProfile, photo: photoUrl.trim() };
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
 * Compresses an uploaded image file to max 800x800 pixels and max 500KB JPEG Blob
 * ready for permanent Firebase Storage upload at `profilePictures/{userId}.jpg`.
 * Uses createImageBitmap when available (zero URL.createObjectURL usage).
 */
export async function compressImageToJpegBlob(file: File): Promise<Blob> {
  const MAX_DIM = 800;
  const MAX_BYTES = 500 * 1024;

  let drawSource: CanvasImageSource;
  let srcWidth = 800;
  let srcHeight = 800;
  let bitmapToClose: ImageBitmap | null = null;

  if (typeof createImageBitmap === 'function') {
    const bmp = await createImageBitmap(file);
    drawSource = bmp;
    srcWidth = bmp.width || 800;
    srcHeight = bmp.height || 800;
    bitmapToClose = bmp;
  } else {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Could not read selected image file.'));
      reader.onload = () => resolve(String(reader.result || ''));
      reader.readAsDataURL(file);
    });
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onerror = () => reject(new Error('Invalid image file.'));
      el.onload = () => resolve(el);
      el.src = dataUrl;
    });
    drawSource = img;
    srcWidth = img.naturalWidth || img.width || 800;
    srcHeight = img.naturalHeight || img.height || 800;
  }

  try {
    const scale = Math.min(1, MAX_DIM / Math.max(1, srcWidth, srcHeight));
    let width = Math.max(1, Math.round(srcWidth * scale));
    let height = Math.max(1, Math.round(srcHeight * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Canvas context unavailable.');
    }
    ctx.drawImage(drawSource, 0, 0, width, height);

    const toJpegBlob = (c: HTMLCanvasElement, q: number) =>
      new Promise<Blob>((resolve, reject) => {
        c.toBlob(
          (b) => {
            if (b) resolve(b);
            else reject(new Error('Failed to encode compressed JPEG.'));
          },
          'image/jpeg',
          q
        );
      });

    let quality = 0.88;
    let blob = await toJpegBlob(canvas, quality);
    while (blob.size > MAX_BYTES && quality > 0.28) {
      quality -= 0.12;
      blob = await toJpegBlob(canvas, quality);
    }

    if (blob.size > MAX_BYTES) {
      width = Math.min(480, width);
      height = Math.min(480, height);
      const small = document.createElement('canvas');
      small.width = width;
      small.height = height;
      const sctx = small.getContext('2d');
      sctx?.drawImage(canvas, 0, 0, width, height);
      blob = await toJpegBlob(small, 0.78);
    }

    return blob;
  } finally {
    bitmapToClose?.close();
  }
}

/**
 * Reactive hook driven strictly by Firestore `profilePicUrl`/`photoURL` + instant in-memory sync
 * (NO localStorage photo caching, NO base64 persistence).
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
    return () => {
      window.removeEventListener(PROFILE_UPDATED_EVENT, handleSync);
    };
  }, [fallbackName, fallbackPhoto]);

  return profile;
}
