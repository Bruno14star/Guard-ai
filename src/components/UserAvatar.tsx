import React from 'react';
import { User as UserIcon } from 'lucide-react';

interface UserAvatarProps {
  photoURL?: string | null;
  name?: string | null;
  size?: 'xs' | 'sm' | 'md' | '40' | 'lg' | 'xl';
  greenBorder?: boolean;
  borderVariant?: 'purple' | 'green' | 'none';
  fallbackVariant?: 'purple' | 'grey';
  fallbackLabel?: string;
  className?: string;
}

const SIZE_MAP = {
  xs: 'w-7 h-7 text-[11px]',
  sm: 'w-9 h-9 text-xs',
  '40': 'w-10 h-10 text-sm',
  md: 'w-11 h-11 text-sm',
  lg: 'w-16 h-16 text-lg',
  xl: 'w-24 h-24 text-2xl',
};

export const UserAvatar: React.FC<UserAvatarProps> = ({
  photoURL,
  name,
  size = 'md',
  greenBorder = true,
  borderVariant,
  fallbackVariant = 'purple',
  fallbackLabel,
  className = '',
}) => {
  const [imgError, setImgError] = React.useState(false);

  React.useEffect(() => {
    setImgError(false);
  }, [photoURL]);

  const trimmedName = (name || '').trim();
  const initial = fallbackLabel || trimmedName.charAt(0).toUpperCase() || '?';
  const sizeCls = SIZE_MAP[size];

  const activeBorder =
    borderVariant === 'purple'
      ? 'ring-2 ring-[#7C3AED]'
      : borderVariant === 'none'
      ? 'ring-1 ring-slate-700'
      : borderVariant === 'green' || greenBorder
      ? 'ring-2 ring-[#00E67A]'
      : 'ring-1 ring-slate-700';

  if (photoURL && !imgError) {
    return (
      <img
        src={photoURL}
        alt={trimmedName || 'User profile'}
        referrerPolicy="no-referrer"
        onError={() => setImgError(true)}
        className={`${sizeCls} rounded-full object-cover shrink-0 ${activeBorder} bg-slate-800 ${className}`}
      />
    );
  }

  if (fallbackVariant === 'grey') {
    return (
      <div
        className={`${sizeCls} rounded-full shrink-0 bg-slate-600 text-slate-100 font-bold flex items-center justify-center ring-2 ring-slate-500 ${className}`}
        aria-label={trimmedName || 'User avatar'}
      >
        {fallbackLabel ? (
          <span>{fallbackLabel}</span>
        ) : (
          <UserIcon className="w-1/2 h-1/2 text-slate-200" />
        )}
      </div>
    );
  }

  return (
    <div
      className={`${sizeCls} rounded-full shrink-0 bg-[#7C3AED] text-white font-extrabold flex items-center justify-center ring-2 ring-white/80 shadow-sm ${className}`}
      aria-label={trimmedName || 'User profile'}
    >
      {initial}
    </div>
  );
};
