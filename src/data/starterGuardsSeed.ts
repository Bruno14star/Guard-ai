import {
  collection,
  doc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { db } from '../firebase';
import { UserProfile, UserUsageStat } from '../types';
import { getWatDateKey, getWatMonthKey } from '../utils/geoPhysics';

import portraitF1 from '../assets/images/ng_portrait_1_1795540019342.jpg';
import portraitM1 from '../assets/images/ng_portrait_2_1795540018292.jpg';
import portraitF2 from '../assets/images/ng_portrait_3_1795540019684.jpg';
import portraitM2 from '../assets/images/ng_portrait_4_1795540019150.jpg';
import portraitF3 from '../assets/images/ng_portrait_5_1795540019688.jpg';

export type StarterAvatarKind = 'photo' | 'illustration' | 'letter';

export interface StarterGuardSeedEntry {
  rank: number;
  uid: string;
  fullName: string;
  state: string;
  city: string;
  baseScore: number;
  baseReports: number;
  totalReports: number;
  gender: 'F' | 'M';
  avatarKind: StarterAvatarKind;
  photoURL: string;
}

const RAW_56_STARTERS: {
  rank: number;
  fullName: string;
  state: string;
  baseScore: number;
  baseReports: number;
  gender: 'F' | 'M';
}[] = [
  { rank: 1, fullName: 'Chidinma Okafor', state: 'Lagos', baseScore: 2450, baseReports: 42, gender: 'F' },
  { rank: 2, fullName: 'Emeka Nwosu', state: 'Anambra', baseScore: 2380, baseReports: 38, gender: 'M' },
  { rank: 3, fullName: 'Fatima Bello', state: 'Kano', baseScore: 2310, baseReports: 35, gender: 'F' },
  { rank: 4, fullName: 'Tunde Bakare', state: 'Oyo', baseScore: 2280, baseReports: 33, gender: 'M' },
  { rank: 5, fullName: 'Aisha Mohammed', state: 'Kaduna', baseScore: 2250, baseReports: 31, gender: 'F' },
  { rank: 6, fullName: 'Ngozi Eze', state: 'Enugu', baseScore: 2210, baseReports: 30, gender: 'F' },
  { rank: 7, fullName: 'Ibrahim Musa', state: 'Sokoto', baseScore: 2180, baseReports: 29, gender: 'M' },
  { rank: 8, fullName: 'Funke Adeyemi', state: 'Lagos', baseScore: 2150, baseReports: 28, gender: 'F' },
  { rank: 9, fullName: 'Obinna Okonkwo', state: 'Imo', baseScore: 2120, baseReports: 27, gender: 'M' },
  { rank: 10, fullName: 'Yetunde Alabi', state: 'Osun', baseScore: 2100, baseReports: 26, gender: 'F' },
  { rank: 11, fullName: 'Yusuf Abdullahi', state: 'Borno', baseScore: 2050, baseReports: 25, gender: 'M' },
  { rank: 12, fullName: 'Amara Nnaji', state: 'Abia', baseScore: 2020, baseReports: 24, gender: 'F' },
  { rank: 13, fullName: 'Segun Oladele', state: 'Ogun', baseScore: 1980, baseReports: 23, gender: 'M' },
  { rank: 14, fullName: 'Halima Yusuf', state: 'Katsina', baseScore: 1950, baseReports: 22, gender: 'F' },
  { rank: 15, fullName: 'Chiamaka Obi', state: 'Rivers', baseScore: 1920, baseReports: 21, gender: 'F' },
  { rank: 16, fullName: 'Olumide Johnson', state: 'Lagos', baseScore: 1890, baseReports: 20, gender: 'M' },
  { rank: 17, fullName: 'Zainab Aliyu', state: 'Bauchi', baseScore: 1860, baseReports: 19, gender: 'F' },
  { rank: 18, fullName: 'Ifeanyi Eze', state: 'Enugu', baseScore: 1830, baseReports: 18, gender: 'M' },
  { rank: 19, fullName: 'Blessing Akpan', state: 'Akwa Ibom', baseScore: 1800, baseReports: 17, gender: 'F' },
  { rank: 20, fullName: 'Adewale Ogundele', state: 'Oyo', baseScore: 1780, baseReports: 17, gender: 'M' },
  { rank: 21, fullName: 'Nkechi Onyema', state: 'Delta', baseScore: 1750, baseReports: 16, gender: 'F' },
  { rank: 22, fullName: 'Kabiru Ibrahim', state: 'Jigawa', baseScore: 1720, baseReports: 16, gender: 'M' },
  { rank: 23, fullName: 'Tolulope Adeleke', state: 'Ekiti', baseScore: 1690, baseReports: 15, gender: 'F' },
  { rank: 24, fullName: 'Chukwuemeka Eze', state: 'Anambra', baseScore: 1660, baseReports: 15, gender: 'M' },
  { rank: 25, fullName: 'Mariam Sani', state: 'Zamfara', baseScore: 1630, baseReports: 14, gender: 'F' },
  { rank: 26, fullName: 'Ebele Okonkwo', state: 'Imo', baseScore: 1600, baseReports: 14, gender: 'F' },
  { rank: 27, fullName: 'Babatunde Fashola', state: 'Lagos', baseScore: 1570, baseReports: 13, gender: 'M' },
  { rank: 28, fullName: 'Grace Onyeka', state: 'Rivers', baseScore: 1540, baseReports: 13, gender: 'F' },
  { rank: 29, fullName: 'Suleiman Bello', state: 'Kebbi', baseScore: 1510, baseReports: 12, gender: 'M' },
  { rank: 30, fullName: 'Adaeze Nwankwo', state: 'Anambra', baseScore: 1480, baseReports: 12, gender: 'F' },
  { rank: 31, fullName: 'Oluwaseun Adeoye', state: 'Ogun', baseScore: 1450, baseReports: 11, gender: 'M' },
  { rank: 32, fullName: 'Hauwa Garba', state: 'Gombe', baseScore: 1420, baseReports: 11, gender: 'F' },
  { rank: 33, fullName: 'Chinedu Okafor', state: 'Enugu', baseScore: 1390, baseReports: 10, gender: 'M' },
  { rank: 34, fullName: 'Folake Ogunnaike', state: 'Lagos', baseScore: 1350, baseReports: 10, gender: 'F' },
  { rank: 35, fullName: 'Abdullahi Musa', state: 'Yobe', baseScore: 1320, baseReports: 9, gender: 'M' },
  { rank: 36, fullName: 'Kemi Adebayo', state: 'Kwara', baseScore: 1290, baseReports: 9, gender: 'F' },
  { rank: 37, fullName: 'Uche Okoro', state: 'Abia', baseScore: 1260, baseReports: 8, gender: 'M' },
  { rank: 38, fullName: 'Amina Bello', state: 'Niger', baseScore: 1230, baseReports: 8, gender: 'F' },
  { rank: 39, fullName: 'Ebuka Nwosu', state: 'Anambra', baseScore: 1200, baseReports: 7, gender: 'M' },
  { rank: 40, fullName: 'Simi Oladipo', state: 'Oyo', baseScore: 1170, baseReports: 7, gender: 'F' },
  { rank: 41, fullName: 'Nnamdi Eze', state: 'Ebonyi', baseScore: 1140, baseReports: 6, gender: 'M' },
  { rank: 42, fullName: 'Ruqayyah Ahmed', state: 'Kano', baseScore: 1110, baseReports: 6, gender: 'F' },
  { rank: 43, fullName: 'Chiamaka Eze', state: 'Imo', baseScore: 1080, baseReports: 5, gender: 'F' },
  { rank: 44, fullName: 'Opeyemi Balogun', state: 'Lagos', baseScore: 1050, baseReports: 5, gender: 'M' },
  { rank: 45, fullName: 'Daniel Okeke', state: 'Delta', baseScore: 1020, baseReports: 4, gender: 'M' },
  { rank: 46, fullName: 'Femi Ojo', state: 'Ondo', baseScore: 990, baseReports: 4, gender: 'M' },
  { rank: 47, fullName: 'Precious Eze', state: 'Rivers', baseScore: 960, baseReports: 3, gender: 'F' },
  { rank: 48, fullName: 'Sadiq Umar', state: 'Taraba', baseScore: 930, baseReports: 3, gender: 'M' },
  { rank: 49, fullName: 'Vivian Okonkwo', state: 'Anambra', baseScore: 900, baseReports: 2, gender: 'F' },
  { rank: 50, fullName: 'Kunle Adeleke', state: 'Osun', baseScore: 870, baseReports: 2, gender: 'M' },
  { rank: 51, fullName: 'Joy Okafor', state: 'Enugu', baseScore: 840, baseReports: 2, gender: 'F' },
  { rank: 52, fullName: 'Michael Adeyemi', state: 'Lagos', baseScore: 810, baseReports: 1, gender: 'M' },
  { rank: 53, fullName: 'Sandra Eze', state: 'Imo', baseScore: 780, baseReports: 1, gender: 'F' },
  { rank: 54, fullName: 'Peter Obi', state: 'Anambra', baseScore: 750, baseReports: 1, gender: 'M' },
  { rank: 55, fullName: 'Deborah Adebayo', state: 'Ogun', baseScore: 720, baseReports: 1, gender: 'F' },
  { rank: 56, fullName: 'Samuel Okonkwo', state: 'Cross River', baseScore: 690, baseReports: 1, gender: 'M' },
];

const STATE_CAPITALS: Record<string, string> = {
  Lagos: 'Ikeja',
  Anambra: 'Awka',
  Kano: 'Kano',
  Oyo: 'Ibadan',
  Kaduna: 'Kaduna',
  Enugu: 'Enugu',
  Sokoto: 'Sokoto',
  Imo: 'Owerri',
  Osun: 'Osogbo',
  Borno: 'Maiduguri',
  Abia: 'Umuahia',
  Ogun: 'Abeokuta',
  Katsina: 'Katsina',
  Rivers: 'Port Harcourt',
  Bauchi: 'Bauchi',
  'Akwa Ibom': 'Uyo',
  Delta: 'Asaba',
  Jigawa: 'Dutse',
  Ekiti: 'Ado-Ekiti',
  Zamfara: 'Gusau',
  Kebbi: 'Birnin Kebbi',
  Gombe: 'Gombe',
  Yobe: 'Damaturu',
  Kwara: 'Ilorin',
  Niger: 'Minna',
  Ebonyi: 'Abakaliki',
  Ondo: 'Akure',
  Taraba: 'Jalingo',
  'Cross River': 'Calabar',
};

// Exact distribution across ranks 1..56:
// 20 Nigerian realistic portraits, 20 Avatar illustrations, 16 Letter Avatars
const PHOTO_RANKS = new Set([
  1, 3, 6, 9, 11, 14, 17, 20, 23, 25, 28, 31, 34, 37, 40, 43, 46, 49, 52, 55,
]);
const ILLUSTRATION_RANKS = new Set([
  2, 5, 8, 12, 15, 18, 21, 24, 27, 30, 33, 36, 39, 42, 45, 48, 50, 53, 54, 56,
]);

const FEMALE_PORTRAITS = [portraitF1, portraitF2, portraitF3];
const MALE_PORTRAITS = [portraitM1, portraitM2];

function getStarterAvatar(
  rank: number,
  fullName: string,
  gender: 'F' | 'M'
): { avatarKind: StarterAvatarKind; photoURL: string } {
  if (PHOTO_RANKS.has(rank)) {
    const pool = gender === 'F' ? FEMALE_PORTRAITS : MALE_PORTRAITS;
    return {
      avatarKind: 'photo',
      photoURL: pool[rank % pool.length],
    };
  }
  if (ILLUSTRATION_RANKS.has(rank)) {
    const seed = encodeURIComponent(fullName.replace(/\s+/g, '_').toLowerCase());
    return {
      avatarKind: 'illustration',
      photoURL: `https://api.dicebear.com/9.x/adventurer/svg?seed=${seed}&skinColor=763900,9e5622&backgroundColor=0c1626,1e293b`,
    };
  }
  return {
    avatarKind: 'letter',
    photoURL: '',
  };
}

export const STARTER_GUARDS_56: StarterGuardSeedEntry[] = RAW_56_STARTERS.map((row) => {
  const { avatarKind, photoURL } = getStarterAvatar(row.rank, row.fullName, row.gender);
  const uid = `starter_guard_${String(row.rank).padStart(2, '0')}`;
  return {
    ...row,
    uid,
    city: STATE_CAPITALS[row.state] || row.state,
    totalReports: row.baseReports + (row.rank % 4),
    avatarKind,
    photoURL,
  };
});

function hashString(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

/**
 * Deterministic daily WAT shuffle (-20 to +30 pts, -1 to +2 reports)
 * so #1 Starter Guard rotates organically every midnight WAT.
 */
export function getStarterDailyDelta(
  uid: string,
  watDateKey: string = getWatDateKey()
): { scoreDelta: number; reportDelta: number } {
  const h1 = hashString(`${uid}_${watDateKey}_score`);
  const h2 = hashString(`${uid}_${watDateKey}_reports`);
  const scoreDelta = (h1 % 51) - 20; // [-20 .. +30]
  const reportDelta = (h2 % 4) - 1; // [-1 .. +2]
  return { scoreDelta, reportDelta };
}

export async function seedAllStarterGuardsToFirestore(): Promise<number> {
  const month = getWatMonthKey();
  const todayKey = getWatDateKey();

  // Firestore batch max is 500 ops; 56 * 3 = 168 ops -> split cleanly in batches of 120 ops
  const chunks: StarterGuardSeedEntry[][] = [];
  for (let i = 0; i < STARTER_GUARDS_56.length; i += 25) {
    chunks.push(STARTER_GUARDS_56.slice(i, i + 25));
  }

  for (const group of chunks) {
    const batch = writeBatch(db);
    for (const s of group) {
      const { scoreDelta, reportDelta } = getStarterDailyDelta(s.uid, todayKey);
      const liveScore = Math.max(100, s.baseScore + scoreDelta);
      const liveVerifiedReports = Math.max(1, s.baseReports + reportDelta);
      const liveTotalReports = Math.max(liveVerifiedReports, s.totalReports + Math.max(0, reportDelta));

      const userRef = doc(db, 'users', s.uid);
      batch.set(
        userRef,
        {
          uid: s.uid,
          fullName: s.fullName,
          username: s.fullName.toLowerCase().replace(/[^a-z0-9]/g, ''),
          city: s.city,
          state: s.state,
          userState: s.state,
          photoURL: s.photoURL,
          profilePicUrl: s.photoURL,
          role: 'user',
          safetyScore: 100,
          trust_score: 100,
          streak: 3 + (s.rank % 12),
          subscription: 'free',
          subscriptionPlan: 'FREE',
          subscriptionStatus: 'free',
          verifiedBadge: true,
          guardScore: liveScore,
          guardScoreMonth: month,
          totalReports: liveTotalReports,
          verifiedReports: liveVerifiedReports,
          isStarter: true,
          isRealUser: false,
          canWinPayout: false,
          authProvider: 'system',
          starterRank: s.rank,
          lastActive: serverTimestamp(),
          lastActiveAt: serverTimestamp(),
          createdAt: serverTimestamp(),
        },
        { merge: true }
      );

      const pubRef = doc(db, 'public_profiles', s.uid);
      batch.set(
        pubRef,
        {
          userId: s.uid,
          fullName: s.fullName,
          username: s.fullName.toLowerCase().replace(/[^a-z0-9]/g, ''),
          city: s.city,
          state: s.state,
          userState: s.state,
          photoURL: s.photoURL,
          profilePicUrl: s.photoURL,
          verifiedBadge: true,
          trust_score: 90 + (10 - (s.rank % 10)),
          safetyScore: 100,
          streak: 3 + (s.rank % 12),
          followersCount: 12 + (56 - s.rank) * 3,
          followingCount: 5 + (s.rank % 14),
          totalReports: liveTotalReports,
          verifiedReports: liveVerifiedReports,
          totalScans: 10 + (56 - s.rank) * 2,
          guardScore: liveScore,
          isStarter: true,
          isRealUser: false,
          canWinPayout: false,
          joinedAt: serverTimestamp(),
        },
        { merge: true }
      );

      const statRef = doc(db, 'user_usage_stats', `${s.uid}_${month}`);
      batch.set(
        statRef,
        {
          userId: s.uid,
          name: s.fullName,
          avatar: s.photoURL,
          profilePicUrl: s.photoURL,
          city: s.city,
          state: s.state,
          subscriptionPlan: 'FREE',
          subscriptionStatus: 'free',
          totalScans: 10 + (56 - s.rank) * 2,
          totalReports: liveTotalReports,
          verifiedReports: liveVerifiedReports,
          totalUsageDays: 5 + (s.rank % 20),
          lastActiveDate: todayKey,
          totalUsageMinutes: 45 + (56 - s.rank) * 4,
          totalPoints: liveScore,
          guardScore: liveScore,
          month,
          cheatingFlagged: false,
          isStarter: true,
          isRealUser: false,
          canWinPayout: false,
          starterRank: s.rank,
          authProvider: 'system',
          lastActive: serverTimestamp(),
          lastActiveAt: serverTimestamp(),
          createdAt: serverTimestamp(),
        },
        { merge: true }
      );
    }
    await batch.commit();
  }

  await setDoc(
    doc(db, 'app_settings', 'starter_guards'),
    {
      showInApp: true,
      starterRemoved: false,
      lastShuffleDate: todayKey,
      seededAt: serverTimestamp(),
    },
    { merge: true }
  );

  return STARTER_GUARDS_56.length;
}

export async function runMidnightStarterShuffleInFirestore(
  existingStats: UserUsageStat[]
): Promise<number> {
  const month = getWatMonthKey();
  const todayKey = getWatDateKey();
  const starterStats = existingStats.filter(
    (st) => st.isStarter === true || st.userId.startsWith('starter_guard_')
  );
  if (starterStats.length === 0) return 0;

  const chunks: UserUsageStat[][] = [];
  for (let i = 0; i < starterStats.length; i += 40) {
    chunks.push(starterStats.slice(i, i + 40));
  }

  for (const group of chunks) {
    const batch = writeBatch(db);
    for (const st of group) {
      const seed = STARTER_GUARDS_56.find((s) => s.uid === st.userId);
      const baseScore = seed?.baseScore ?? Number(st.guardScore || 1000);
      const baseReports = seed?.baseReports ?? Number(st.verifiedReports || 1);
      const { scoreDelta, reportDelta } = getStarterDailyDelta(st.userId, todayKey);
      const nextScore = Math.max(100, baseScore + scoreDelta);
      const nextVerified = Math.max(1, baseReports + reportDelta);
      const nextTotal = Math.max(nextVerified, Number(st.totalReports || nextVerified));

      batch.update(doc(db, 'user_usage_stats', st.id), {
        guardScore: nextScore,
        totalPoints: nextScore,
        verifiedReports: nextVerified,
        totalReports: nextTotal,
        lastActiveDate: todayKey,
        lastActive: serverTimestamp(),
        lastActiveAt: serverTimestamp(),
      });

      batch.update(doc(db, 'users', st.userId), {
        guardScore: nextScore,
        guardScoreMonth: month,
        verifiedReports: nextVerified,
        totalReports: nextTotal,
        lastActive: serverTimestamp(),
        lastActiveAt: serverTimestamp(),
      });
    }
    await batch.commit();
  }

  await setDoc(
    doc(db, 'app_settings', 'starter_guards'),
    {
      lastShuffleDate: todayKey,
    },
    { merge: true }
  );

  return starterStats.length;
}

export async function removeAllStarterGuardsFromFirestore(): Promise<number> {
  let deleted = 0;

  // Query all starter user_usage_stats, starter users, and starter public_profiles
  const [statSnap, userSnap, pubSnap] = await Promise.all([
    getDocs(query(collection(db, 'user_usage_stats'), where('isStarter', '==', true))),
    getDocs(query(collection(db, 'users'), where('isStarter', '==', true))),
    getDocs(query(collection(db, 'public_profiles'), where('isStarter', '==', true))),
  ]);

  const deleteRefs: ReturnType<typeof doc>[] = [];
  statSnap.docs.forEach((d) => deleteRefs.push(d.ref));
  userSnap.docs.forEach((d) => deleteRefs.push(d.ref));
  pubSnap.docs.forEach((d) => deleteRefs.push(d.ref));

  // Also ensure all known deterministic starter_guard_01..56 doc refs are cleaned up
  const month = getWatMonthKey();
  const seenPaths = new Set(deleteRefs.map((r) => r.path));
  for (const s of STARTER_GUARDS_56) {
    const candidates = [
      doc(db, 'users', s.uid),
      doc(db, 'public_profiles', s.uid),
      doc(db, 'user_usage_stats', `${s.uid}_${month}`),
    ];
    for (const ref of candidates) {
      if (!seenPaths.has(ref.path)) {
        seenPaths.add(ref.path);
        deleteRefs.push(ref);
      }
    }
  }

  for (let i = 0; i < deleteRefs.length; i += 400) {
    const chunk = deleteRefs.slice(i, i + 400);
    const batch = writeBatch(db);
    chunk.forEach((ref) => batch.delete(ref));
    await batch.commit();
    deleted += chunk.length;
  }

  await setDoc(
    doc(db, 'app_settings', 'starter_guards'),
    {
      showInApp: false,
      starterRemoved: true,
      removedAt: serverTimestamp(),
    },
    { merge: true }
  );

  return deleted;
}

export function isStarterUserRecord(
  entity?: {
    uid?: string;
    userId?: string;
    isStarter?: boolean;
    isRealUser?: boolean;
    canWinPayout?: boolean;
  } | null
): boolean {
  if (!entity) return false;
  const uid = String(entity.uid || entity.userId || '');
  return (
    entity.isStarter === true ||
    entity.isRealUser === false ||
    entity.canWinPayout === false ||
    uid.startsWith('starter_guard_')
  );
}
