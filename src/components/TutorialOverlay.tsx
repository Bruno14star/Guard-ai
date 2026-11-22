import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertOctagon,
  Bell,
  Building2,
  Car,
  ChevronLeft,
  ChevronRight,
  Crosshair,
  Home,
  Moon,
  Radio,
  ShieldCheck,
  Users,
} from 'lucide-react';
import { AppTab } from '../types';
import { saveTutorialStep, useGlobalUserProfile } from '../utils/userProfileStore';
import { UserAvatar } from './UserAvatar';

interface TutorialOverlayProps {
  open: boolean;
  stepIndex: number;
  userName: string;
  userPhotoURL?: string;
  onChangeStep: (nextStep: number) => void;
  onSwitchTab: (tab: AppTab) => void;
  onEnsureMeProfileSection: () => void;
  onOpenMeHelp: () => void;
  onComplete: () => void;
  onSkip: () => void;
  onInterruptForSos: () => void;
}

interface SpotlightRect {
  key: string;
  left: number;
  top: number;
  width: number;
  height: number;
  isSos?: boolean;
}

const TOTAL_STEPS = 8;

const STEP_TARGETS: Record<number, string[]> = {
  0: [],
  1: ['nav-home', 'safety-score-card', 'sos-button'],
  2: ['nav-family'],
  3: ['nav-weapon', 'scan-button'],
  4: ['nav-alerts'],
  5: ['nav-safe_business'],
  6: ['nav-me', 'profile-avatar-circle', 'report-earn-button'],
  7: ['nav-home'],
};

const STEP_TABS: Record<number, AppTab> = {
  0: 'home',
  1: 'home',
  2: 'family',
  3: 'weapon',
  4: 'alerts',
  5: 'safe_business',
  6: 'me',
  7: 'home',
};

export const TutorialOverlay: React.FC<TutorialOverlayProps> = ({
  open,
  stepIndex,
  userName,
  userPhotoURL,
  onChangeStep,
  onSwitchTab,
  onEnsureMeProfileSection,
  onOpenMeHelp,
  onComplete,
  onSkip,
  onInterruptForSos,
}) => {
  const globalProfile = useGlobalUserProfile(userName, userPhotoURL);
  const resolvedPhoto = globalProfile.photo || '';
  const [rects, setRects] = useState<SpotlightRect[]>([]);

  const measureTargets = useCallback(() => {
    if (!open) return;
    const keys = STEP_TARGETS[stepIndex] || [];
    const nextRects: SpotlightRect[] = [];

    keys.forEach((key) => {
      const el = document.querySelector(`[data-tutorial-target="${key}"]`) as HTMLElement | null;
      if (!el) return;
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return;
      nextRects.push({
        key,
        left: r.left,
        top: r.top,
        width: r.width,
        height: r.height,
        isSos: key === 'sos-button',
      });
    });

    setRects(nextRects);
  }, [open, stepIndex]);

  // Persist current step for resume + switch tab + scroll primary element into view
  useEffect(() => {
    if (!open) return;
    saveTutorialStep(stepIndex);

    const targetTab = STEP_TABS[stepIndex] || 'home';
    onSwitchTab(targetTab);
    if (stepIndex === 6) {
      onEnsureMeProfileSection();
    }

    const scrollTimer = window.setTimeout(() => {
      const keys = STEP_TARGETS[stepIndex] || [];
      const primaryNonNav = keys.find((k) => !k.startsWith('nav-'));
      if (primaryNonNav) {
        const el = document.querySelector(
          `[data-tutorial-target="${primaryNonNav}"]`
        ) as HTMLElement | null;
        el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      measureTargets();
    }, 80);

    const t2 = window.setTimeout(measureTargets, 280);
    const t3 = window.setTimeout(measureTargets, 600);

    window.addEventListener('resize', measureTargets);
    window.addEventListener('scroll', measureTargets, true);

    return () => {
      clearTimeout(scrollTimer);
      clearTimeout(t2);
      clearTimeout(t3);
      window.removeEventListener('resize', measureTargets);
      window.removeEventListener('scroll', measureTargets, true);
    };
  }, [open, stepIndex, onSwitchTab, onEnsureMeProfileSection, measureTargets]);

  if (!open) return null;

  const sosRect = rects.find((r) => r.isSos);

  return (
    <div
      className="fixed inset-0 z-[70] pointer-events-auto select-none"
      role="dialog"
      aria-modal="true"
      aria-label={`Guard AI Tutorial Step ${stepIndex + 1} of ${TOTAL_STEPS}`}
    >
      {/* 70% Transparent Black Backdrop with Bright Spotlight Cutouts */}
      <svg className="fixed inset-0 w-full h-full pointer-events-none">
        <defs>
          <mask id="guard-tutorial-spotlight-mask">
            <rect x="0" y="0" width="100%" height="100%" fill="white" />
            {rects.map((r) => (
              <rect
                key={r.key}
                x={Math.max(0, r.left - 6)}
                y={Math.max(0, r.top - 6)}
                width={r.width + 12}
                height={r.height + 12}
                rx="16"
                fill="black"
              />
            ))}
          </mask>
        </defs>
        <rect
          x="0"
          y="0"
          width="100%"
          height="100%"
          fill="rgba(0, 0, 0, 0.70)"
          mask="url(#guard-tutorial-spotlight-mask)"
        />
      </svg>

      {/* Bright Spotlight Borders Around Real Elements */}
      {rects.map((r) => (
        <div
          key={`ring-${r.key}`}
          className={`fixed pointer-events-none rounded-2xl transition-all duration-200 ${
            r.isSos
              ? 'ring-4 ring-[#FF2D55] shadow-[0_0_24px_rgba(255,45,85,0.85)]'
              : 'ring-4 ring-[#00E67A] shadow-[0_0_22px_rgba(0,230,122,0.75)]'
          }`}
          style={{
            left: Math.max(0, r.left - 6),
            top: Math.max(0, r.top - 6),
            width: r.width + 12,
            height: r.height + 12,
          }}
        />
      ))}

      {/* NEVER block the red SOS button during tutorial: tapping it immediately stops tutorial & opens SOS */}
      {sosRect && (
        <button
          type="button"
          onClick={onInterruptForSos}
          aria-label="SOS Emergency"
          className="fixed z-[85] rounded-2xl bg-transparent cursor-pointer"
          style={{
            left: sosRect.left,
            top: sosRect.top,
            width: sosRect.width,
            height: sosRect.height,
          }}
        />
      )}

      {/* Always Visible Top-Right White [SKIP >>] Button */}
      <button
        type="button"
        onClick={onSkip}
        className="fixed top-4 right-4 z-[90] px-4 py-2 rounded-xl bg-white text-slate-900 font-extrabold text-xs sm:text-sm shadow-2xl hover:bg-slate-100 active:scale-95 transition-transform cursor-pointer"
      >
        SKIP &gt;&gt;
      </button>

      {/* Bottom White Tutorial Card (Positioned cleanly above bottom navigation bar) */}
      <div className="fixed left-3 right-3 bottom-[74px] z-[80] flex justify-center pointer-events-none">
        <div className="pointer-events-auto w-full max-w-md bg-white text-slate-900 rounded-3xl shadow-2xl border border-slate-200 p-5 space-y-3.5">
          {/* Progress Header: Dots + "Step X of 8" */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5" aria-hidden="true">
              {Array.from({ length: TOTAL_STEPS }).map((_, idx) => (
                <span
                  key={idx}
                  className={`h-2 rounded-full transition-all ${
                    idx === stepIndex
                      ? 'w-5 bg-[#7C3AED]'
                      : idx < stepIndex
                      ? 'w-2 bg-[#00C868]'
                      : 'w-2 bg-slate-300'
                  }`}
                />
              ))}
            </div>
            <span className="text-xs font-extrabold text-slate-500">
              Step {stepIndex + 1} of {TOTAL_STEPS}
            </span>
          </div>

          {/* Step Content */}
          {stepIndex === 0 && (
            <div className="flex items-start gap-3.5">
              <div className="w-12 h-12 rounded-2xl bg-emerald-100 text-emerald-600 flex items-center justify-center shrink-0">
                <ShieldCheck className="w-7 h-7" />
              </div>
              <div className="space-y-1">
                <h2 className="text-xl font-extrabold text-slate-900 leading-tight">
                  Welcome to Guard AI
                </h2>
                <p className="text-sm font-medium text-slate-700 leading-snug">
                  You are protected now. I will show you each button in 30 seconds.
                </p>
              </div>
            </div>
          )}

          {stepIndex === 1 && (
            <div className="flex items-start gap-3.5">
              <div className="w-12 h-12 rounded-2xl bg-emerald-100 text-emerald-600 flex items-center justify-center shrink-0">
                <Home className="w-7 h-7" />
              </div>
              <div className="space-y-1.5">
                <h2 className="text-xl font-extrabold text-slate-900 leading-tight">
                  This is Home
                </h2>
                <p className="text-sm font-medium text-slate-700 leading-snug">
                  See your Safety Score here. Green means you are safe.
                </p>
                <p className="text-sm font-bold text-[#E11D48] leading-snug flex items-center gap-1.5">
                  <AlertOctagon className="w-4 h-4 shrink-0" />
                  <span>If you are in danger, press this red SOS button.</span>
                </p>
              </div>
            </div>
          )}

          {stepIndex === 2 && (
            <div className="flex items-start gap-3.5">
              <div className="w-12 h-12 rounded-2xl bg-blue-100 text-blue-600 flex items-center justify-center shrink-0">
                <Users className="w-7 h-7" />
              </div>
              <div className="space-y-1">
                <h2 className="text-xl font-extrabold text-slate-900 leading-tight">
                  Family Tracking
                </h2>
                <p className="text-sm font-medium text-slate-700 leading-snug">
                  Add Mama, Papa, your children. See them live on map. If they press SOS, you will see it here.
                </p>
              </div>
            </div>
          )}

          {stepIndex === 3 && (
            <div className="space-y-2.5">
              <div className="flex items-start gap-3.5">
                <div className="w-12 h-12 rounded-2xl bg-emerald-100 text-emerald-600 flex items-center justify-center shrink-0">
                  <Crosshair className="w-7 h-7" />
                </div>
                <div className="space-y-1">
                  <h2 className="text-xl font-extrabold text-slate-900 leading-tight">
                    Scanner - Your Weapon
                  </h2>
                  <p className="text-sm font-medium text-slate-700 leading-snug">
                    Before you enter road, bus, or building, press SCAN. Guard AI will listen for danger.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-4 gap-1.5 pt-0.5">
                <div className="p-2 rounded-xl bg-slate-100 flex flex-col items-center gap-1 text-center">
                  <Radio className="w-4 h-4 text-emerald-600" />
                  <span className="text-[11px] font-bold text-slate-800">Road</span>
                </div>
                <div className="p-2 rounded-xl bg-slate-100 flex flex-col items-center gap-1 text-center">
                  <Car className="w-4 h-4 text-blue-600" />
                  <span className="text-[11px] font-bold text-slate-800">Vehicle</span>
                </div>
                <div className="p-2 rounded-xl bg-slate-100 flex flex-col items-center gap-1 text-center">
                  <Building2 className="w-4 h-4 text-amber-600" />
                  <span className="text-[11px] font-bold text-slate-800">Building</span>
                </div>
                <div className="p-2 rounded-xl bg-slate-100 flex flex-col items-center gap-1 text-center">
                  <Moon className="w-4 h-4 text-rose-600" />
                  <span className="text-[11px] font-bold text-slate-800">Night Watch</span>
                </div>
              </div>

              <p className="text-xs font-semibold text-slate-600 leading-snug">
                Road = outside. Vehicle = bus / keke. Building = house / shop. Night Watch = at night.
              </p>
            </div>
          )}

          {stepIndex === 4 && (
            <div className="flex items-start gap-3.5">
              <div className="w-12 h-12 rounded-2xl bg-rose-100 text-rose-600 flex items-center justify-center shrink-0">
                <Bell className="w-7 h-7" />
              </div>
              <div className="space-y-1">
                <h2 className="text-xl font-extrabold text-slate-900 leading-tight">Alerts</h2>
                <p className="text-sm font-medium text-slate-700 leading-snug">
                  Only real, verified danger shows here. Guard AI checks first, so no fake panic.
                </p>
              </div>
            </div>
          )}

          {stepIndex === 5 && (
            <div className="flex items-start gap-3.5">
              <div className="w-12 h-12 rounded-2xl bg-emerald-100 text-emerald-600 flex items-center justify-center shrink-0">
                <Building2 className="w-7 h-7" />
              </div>
              <div className="space-y-1">
                <h2 className="text-xl font-extrabold text-slate-900 leading-tight">
                  Safe Places
                </h2>
                <p className="text-sm font-medium text-slate-700 leading-snug">
                  Need a safe place to run to? These shops, churches, hospitals are verified safe by Guard AI.
                </p>
              </div>
            </div>
          )}

          {stepIndex === 6 && (
            <div className="flex items-start gap-3.5">
              <UserAvatar
                photoURL={resolvedPhoto}
                name={userName}
                size="md"
                borderVariant={resolvedPhoto ? 'purple' : 'none'}
                fallbackVariant="grey"
                fallbackLabel="?"
              />
              <div className="space-y-1">
                <h2 className="text-xl font-extrabold text-slate-900 leading-tight">
                  This is You
                </h2>
                <p className="text-sm font-medium text-slate-700 leading-snug">
                  Tap your picture to change it. It will show on every map.
                </p>
                <p className="text-xs font-bold text-orange-600 leading-snug">
                  See danger? Tap Report &amp; Earn ₦5,000. Record video, Guard AI will verify and pay you.
                </p>
              </div>
            </div>
          )}

          {stepIndex === 7 && (
            <div className="flex items-start gap-3.5">
              <div className="w-12 h-12 rounded-2xl bg-purple-100 text-[#7C3AED] flex items-center justify-center shrink-0">
                <ShieldCheck className="w-7 h-7" />
              </div>
              <div className="space-y-1">
                <h2 className="text-xl font-extrabold text-slate-900 leading-tight">
                  You Are Ready
                </h2>
                <p className="text-sm font-medium text-slate-700 leading-snug">
                  You are protected. Scan before you move. Stay safe.
                </p>
              </div>
            </div>
          )}

          {/* Big Easy-to-Press Action Buttons */}
          {stepIndex === 0 ? (
            <div className="pt-1 flex items-center gap-2.5">
              <button
                type="button"
                onClick={() => onChangeStep(1)}
                className="flex-1 min-h-[48px] py-3 px-4 rounded-2xl bg-[#7C3AED] hover:bg-[#6D28D9] text-white font-extrabold text-sm flex items-center justify-center gap-1.5 shadow-lg cursor-pointer"
              >
                <span>Start Tour</span>
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          ) : stepIndex === TOTAL_STEPS - 1 ? (
            <div className="pt-1 space-y-2">
              <div className="flex items-center gap-2.5">
                <button
                  type="button"
                  onClick={() => onChangeStep(stepIndex - 1)}
                  className="min-h-[48px] px-4 py-3 rounded-2xl bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold text-sm flex items-center justify-center gap-1 cursor-pointer"
                >
                  <ChevronLeft className="w-4 h-4" />
                  <span>Back</span>
                </button>
                <button
                  type="button"
                  onClick={onComplete}
                  className="flex-1 min-h-[48px] py-3 px-4 rounded-2xl bg-[#00C868] hover:bg-[#00b05b] text-slate-950 font-extrabold text-sm shadow-lg cursor-pointer"
                >
                  Enter Guard AI - I Am Protected
                </button>
              </div>
              <button
                type="button"
                onClick={onOpenMeHelp}
                className="w-full text-center text-xs font-bold text-[#7C3AED] hover:underline py-1 cursor-pointer"
              >
                Replay Tutorial Anytime in Me &gt; Help
              </button>
            </div>
          ) : (
            <div className="pt-1 flex items-center gap-2.5">
              <button
                type="button"
                onClick={() => onChangeStep(Math.max(0, stepIndex - 1))}
                className="min-h-[48px] px-4 py-3 rounded-2xl bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold text-sm flex items-center justify-center gap-1 cursor-pointer"
              >
                <ChevronLeft className="w-4 h-4" />
                <span>Back</span>
              </button>
              <button
                type="button"
                onClick={() => onChangeStep(Math.min(TOTAL_STEPS - 1, stepIndex + 1))}
                className="flex-1 min-h-[48px] py-3 px-4 rounded-2xl bg-[#7C3AED] hover:bg-[#6D28D9] text-white font-extrabold text-sm flex items-center justify-center gap-1.5 shadow-lg cursor-pointer"
              >
                <span>Next</span>
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
