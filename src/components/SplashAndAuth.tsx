import React, { useEffect, useState } from 'react';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithPopup,
} from 'firebase/auth';
import {
  addDoc,
  collection,
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore';
import { Shield, Lock, Mail, Phone, User, MapPin, ArrowRight, Eye, EyeOff } from 'lucide-react';
import { auth, db, googleProvider, handleFirestoreError, OperationType } from '../firebase';
import { NIGERIAN_STATES } from '../data/nigeriaPoliceSeed';
import { reverseGeocodeHuman } from '../utils/geoPhysics';

interface SplashAndAuthProps {
  onAuthenticated: () => void;
}

export const SplashAndAuth: React.FC<SplashAndAuthProps> = ({ onAuthenticated }) => {
  const [stage, setStage] = useState<'splash' | 'auth'>('splash');
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [city, setCity] = useState('');
  const [userState, setUserState] = useState('Lagos');
  const [emergencyName, setEmergencyName] = useState('');
  const [emergencyPhone, setEmergencyPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setStage('auth'), 1400);
    return () => clearTimeout(timer);
  }, []);

  // Optional auto-detect city from GPS if user already granted permission
  useEffect(() => {
    if (mode !== 'signup' || !navigator.geolocation) return;
    navigator.permissions
      ?.query({ name: 'geolocation' })
      .then((perm) => {
        if (perm.state === 'granted') {
          navigator.geolocation.getCurrentPosition(
            async (pos) => {
              const info = await reverseGeocodeHuman(pos.coords.latitude, pos.coords.longitude);
              if (info.city) setCity(info.city);
              if (info.state && NIGERIAN_STATES.includes(info.state)) {
                setUserState(info.state);
              }
            },
            () => {},
            { timeout: 5000 }
          );
        }
      })
      .catch(() => {});
  }, [mode]);

  const ensureUserProvisioned = async (
    uid: string,
    info: {
      fullName: string;
      phone: string;
      email: string;
      city: string;
      userState: string;
      emergencyContact: string;
      photoURL?: string;
    }
  ) => {
    const userRef = doc(db, 'users', uid);
    const snap = await getDoc(userRef);
    if (!snap.exists()) {
      const username =
        info.fullName
          .toLowerCase()
          .replace(/[^a-z0-9]/g, '')
          .slice(0, 16) || `guard${uid.slice(0, 5)}`;

      // COLLECTION: users
      try {
        await setDoc(userRef, {
          uid,
          fullName: info.fullName,
          username,
          phone: info.phone,
          email: info.email,
          city: info.city || info.userState || 'Lagos',
          userState: info.userState || 'Lagos',
          bio: 'Protected by Guard AI',
          photoURL: info.photoURL || '',
          profilePicUrl: info.photoURL || '',
          emergencyContact: info.emergencyContact,
          role: 'user',
          safetyScore: 100,
          trust_score: 100,
          streak: 1,
          subscription: 'free',
          verifiedBadge: false,
          followersCount: 0,
          followingCount: 0,
          walletBalance: 0,
          lastActive: serverTimestamp(),
          createdAt: serverTimestamp(),
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.CREATE, `users/${uid}`);
      }

      // COLLECTION: public_profiles
      try {
        await setDoc(doc(db, 'public_profiles', uid), {
          userId: uid,
          fullName: info.fullName,
          username,
          bio: 'Protected by Guard AI',
          city: info.city || info.userState || 'Lagos',
          userState: info.userState || 'Lagos',
          photoURL: info.photoURL || '',
          verifiedBadge: false,
          trust_score: 100,
          safetyScore: 100,
          streak: 1,
          followersCount: 0,
          followingCount: 0,
          totalReports: 0,
          verifiedReports: 0,
          totalScans: 0,
          joinedAt: serverTimestamp(),
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.CREATE, `public_profiles/${uid}`);
      }

      // COLLECTION: me_profiles
      try {
        await setDoc(doc(db, 'me_profiles', uid), {
          userId: uid,
          fullName: info.fullName,
          phone: info.phone,
          email: info.email,
          city: info.city || info.userState || 'Lagos',
          userState: info.userState || 'Lagos',
          emergencyContact: info.emergencyContact,
          photoURL: info.photoURL || '',
          settings: {
            notifications: true,
            locationSharing: true,
            language: 'English',
            darkMode: true,
          },
          updatedAt: serverTimestamp(),
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.CREATE, `me_profiles/${uid}`);
      }

      // COLLECTION: subscriptions (Auto-create Free plan on Sign Up)
      try {
        await addDoc(collection(db, 'subscriptions'), {
          userId: uid,
          plan: 'Free',
          status: 'active',
          amount: 0,
          createdAt: serverTimestamp(),
          expiresAt: null,
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.CREATE, 'subscriptions');
      }
    }
  };

  const handleGoogleSignIn = async () => {
    setError(null);
    setLoading(true);
    try {
      const cred = await signInWithPopup(auth, googleProvider);
      await ensureUserProvisioned(cred.user.uid, {
        fullName: cred.user.displayName || 'Guard AI Member',
        phone: cred.user.phoneNumber || '',
        email: cred.user.email || '',
        city: city || 'Lagos',
        userState: userState || 'Lagos',
        emergencyContact: '',
        photoURL: cred.user.photoURL || '',
      });
      onAuthenticated();
    } catch (err: any) {
      setError(err?.message || 'Google sign-in failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      if (mode === 'signup') {
        if (!fullName.trim() || !phone.trim() || !email.trim() || password.length < 6) {
          setError('Please enter full name, phone number, email, and a 6+ character password.');
          setLoading(false);
          return;
        }
        const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
        await ensureUserProvisioned(cred.user.uid, {
          fullName: fullName.trim(),
          phone: phone.trim(),
          email: email.trim(),
          city: city.trim() || userState,
          userState,
          emergencyContact: emergencyName.trim()
            ? `${emergencyName.trim()} (${emergencyPhone.trim()})`
            : emergencyPhone.trim(),
        });
      } else {
        if (!email.trim() || !password) {
          setError('Enter your email and password.');
          setLoading(false);
          return;
        }
        await signInWithEmailAndPassword(auth, email.trim(), password);
      }
      onAuthenticated();
    } catch (err: any) {
      const msg = String(err?.message || '');
      if (msg.includes('operation-not-allowed')) {
        setError('Email/Password sign-in is disabled in Firebase Console. Please use Continue with Google.');
      } else {
        setError(err?.message || 'Authentication failed.');
      }
    } finally {
      setLoading(false);
    }
  };

  if (stage === 'splash') {
    return (
      <div className="min-h-screen bg-[#050B14] flex flex-col items-center justify-center p-6 text-center">
        <div className="relative w-24 h-24 rounded-3xl bg-[#0C1626] border border-[#2E9BFF]/40 flex items-center justify-center shadow-2xl shadow-[#2E9BFF]/20 mb-6 animate-pulse">
          <Shield className="w-12 h-12 text-[#2E9BFF]" />
        </div>
        <h1 className="text-3xl font-extrabold tracking-tight text-white">GUARD AI</h1>
        <p className="mt-2 text-sm font-medium text-[#00E67A]">You Are Protected</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#050B14] flex items-center justify-center p-4 sm:p-6">
      <div className="w-full max-w-md bg-[#0C1626] border border-slate-800 rounded-3xl p-6 sm:p-8 shadow-2xl space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-[#2E9BFF]/15 border border-[#2E9BFF]/40 flex items-center justify-center text-[#2E9BFF]">
              <Shield className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-xl font-extrabold text-white tracking-tight">GUARD AI</h1>
              <p className="text-xs text-[#00E67A] font-medium">You Are Protected</p>
            </div>
          </div>
          <div className="flex bg-[#050B14] p-1 rounded-xl border border-slate-800">
            <button
              type="button"
              onClick={() => {
                setMode('signin');
                setError(null);
              }}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                mode === 'signin' ? 'bg-[#2E9BFF] text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              Sign In
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('signup');
                setError(null);
              }}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                mode === 'signup' ? 'bg-[#2E9BFF] text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              Sign Up
            </button>
          </div>
        </div>

        {/* Google One-Tap Sign-In */}
        <button
          type="button"
          onClick={handleGoogleSignIn}
          disabled={loading}
          className="w-full min-h-[48px] py-3 px-4 rounded-xl bg-white hover:bg-slate-100 text-slate-900 font-bold text-sm flex items-center justify-center gap-2.5 transition-colors cursor-pointer disabled:opacity-60"
        >
          <svg className="w-5 h-5" viewBox="0 0 24 24">
            <path
              fill="#4285F4"
              d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17Z"
            />
            <path
              fill="#34A853"
              d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.11-6.72-4.96H1.29v3.14C3.26 21.3 7.31 24 12 24Z"
            />
            <path
              fill="#FBBC05"
              d="M5.28 14.24c-.24-.72-.38-1.49-.38-2.24s.14-1.52.38-2.24V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.99-3.14Z"
            />
            <path
              fill="#EA4335"
              d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.99 3.14c.95-2.85 3.6-4.96 6.72-4.96Z"
            />
          </svg>
          Continue with Google
        </button>

        <div className="flex items-center gap-3 text-xs text-slate-500">
          <div className="flex-1 h-px bg-slate-800" />
          <span>or with email</span>
          <div className="flex-1 h-px bg-slate-800" />
        </div>

        <form onSubmit={handleSubmit} className="space-y-3.5">
          {mode === 'signup' && (
            <>
              <div className="relative">
                <User className="w-4 h-4 text-slate-400 absolute left-3.5 top-3.5" />
                <input
                  type="text"
                  placeholder="Full Name"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  required
                  className="w-full min-h-[44px] pl-10 pr-4 py-2.5 rounded-xl bg-[#050B14] border border-slate-800 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-[#2E9BFF]"
                />
              </div>

              <div className="relative">
                <Phone className="w-4 h-4 text-slate-400 absolute left-3.5 top-3.5" />
                <input
                  type="tel"
                  placeholder="Phone Number (e.g. 0803...)"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  required
                  className="w-full min-h-[44px] pl-10 pr-4 py-2.5 rounded-xl bg-[#050B14] border border-slate-800 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-[#2E9BFF]"
                />
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div className="relative">
                  <MapPin className="w-4 h-4 text-slate-400 absolute left-3.5 top-3.5" />
                  <input
                    type="text"
                    placeholder="City (auto/manual)"
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                    className="w-full min-h-[44px] pl-10 pr-3 py-2.5 rounded-xl bg-[#050B14] border border-slate-800 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-[#2E9BFF]"
                  />
                </div>
                <select
                  value={userState}
                  onChange={(e) => setUserState(e.target.value)}
                  className="w-full min-h-[44px] px-3 py-2.5 rounded-xl bg-[#050B14] border border-slate-800 text-sm text-white focus:outline-none focus:border-[#2E9BFF]"
                >
                  {NIGERIAN_STATES.map((st) => (
                    <option key={st} value={st}>
                      {st}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <input
                  type="text"
                  placeholder="Emergency Contact Name"
                  value={emergencyName}
                  onChange={(e) => setEmergencyName(e.target.value)}
                  className="w-full min-h-[44px] px-3 py-2.5 rounded-xl bg-[#050B14] border border-slate-800 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-[#2E9BFF]"
                />
                <input
                  type="tel"
                  placeholder="Emergency Phone"
                  value={emergencyPhone}
                  onChange={(e) => setEmergencyPhone(e.target.value)}
                  className="w-full min-h-[44px] px-3 py-2.5 rounded-xl bg-[#050B14] border border-slate-800 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-[#2E9BFF]"
                />
              </div>
            </>
          )}

          <div className="relative">
            <Mail className="w-4 h-4 text-slate-400 absolute left-3.5 top-3.5" />
            <input
              type="email"
              placeholder="Email Address"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full min-h-[44px] pl-10 pr-4 py-2.5 rounded-xl bg-[#050B14] border border-slate-800 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-[#2E9BFF]"
            />
          </div>

          <div className="relative">
            <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-3.5" />
            <input
              type={showPass ? 'text' : 'password'}
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="w-full min-h-[44px] pl-10 pr-11 py-2.5 rounded-xl bg-[#050B14] border border-slate-800 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-[#2E9BFF]"
            />
            <button
              type="button"
              onClick={() => setShowPass(!showPass)}
              className="absolute right-3 top-2.5 p-1 text-slate-400 hover:text-white cursor-pointer"
              aria-label="Toggle password visibility"
            >
              {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>

          {error && (
            <div className="p-3 rounded-xl bg-[#FF2D55]/15 border border-[#FF2D55]/40 text-xs text-[#FF2D55]">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full min-h-[48px] py-3 px-4 rounded-xl bg-[#2E9BFF] hover:bg-[#1e88eb] text-white font-bold text-sm flex items-center justify-center gap-2 transition-colors cursor-pointer disabled:opacity-60"
          >
            <span>{loading ? 'Connecting...' : mode === 'signup' ? 'Create Protected Account' : 'Sign In to Guard AI'}</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </form>
      </div>
    </div>
  );
};
