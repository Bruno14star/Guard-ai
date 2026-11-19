import React from 'react';

interface UserAvatarProps {
  photoURL?: string | null;
  name?: string | null;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  greenBorder?: boolean;
  className?: string;
}

const SIZE_MAP = {
  xs: 'w-7 h-7 text-[11px]',
  sm: 'w-9 h-9 text-xs',
  md: 'w-11 h-11 text-sm',
  lg: 'w-16 h-16 text-lg',
  xl: 'w-24 h-24 text-2xl',
};

export const UserAvatar: React.FC<UserAvatarProps> = ({
  photoURL,
  name,
  size = 'md',
  greenBorder = true,
  className = '',
}) => {
  const [imgError, setImgError] = React.useState(false);

  React.useEffect(() => {
    setImgError(false);
  }, [photoURL]);

  const initial = (name || '').trim().charAt(0).toUpperCase() || '?';
  const sizeCls = SIZE_MAP[size];

  if (photoURL && !imgError) {
    return (
      <img
        src={photoURL}
        alt={name || 'User profile'}
        referrerPolicy="no-referrer"
        onError={() => setImgError(true)}
        className={`${sizeCls} rounded-full object-cover shrink-0 ${
          greenBorder ? 'ring-2 ring-[#00E67A]' : 'ring-1 ring-slate-700'
        } bg-slate-800 ${className}`}
      />
    );
  }

  return (
    <div
      className={`${sizeCls} rounded-full shrink-0 bg-slate-700 text-slate-200 font-semibold flex items-center justify-center ring-2 ring-slate-500 ${className}`}
      aria-label={name || 'Unset profile photo'}
    >
      {initial}
    </div>
  );
};
