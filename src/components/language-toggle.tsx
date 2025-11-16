'use client';

import { useEffect } from 'react';
import { Globe } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { useLocalStorage } from '@/hooks/use-local-storage';
import { useFirebase } from '@/components/firebase-provider';
import { isGuestProfile } from '@/types/user';
import { cn } from '@/lib/utils';

type LanguageToggleProps = {
  variant?: 'text' | 'icon';
  className?: string;
};

export function LanguageToggle({ variant = 'text', className }: LanguageToggleProps) {
  const [language, setLanguage] = useLocalStorage('wordmates-lang', 'EN');
  const { profile, savePreferences } = useFirebase();
  const isClient = typeof window !== 'undefined';
  const isIcon = variant === 'icon';
  const buttonClasses = cn(
    isIcon
      ? 'h-11 w-11 rounded-full border border-white/20 bg-black/30 text-white'
      : 'h-11 w-12 text-lg font-bold',
    className
  );

  useEffect(() => {
    if (!profile?.preferences?.language) return;
    if (profile.preferences.language !== language) {
      setLanguage(profile.preferences.language);
    }
  }, [language, profile?.preferences?.language, setLanguage]);

  const toggleLanguage = () => {
    const next = language === 'EN' ? 'EL' : 'EN';
    setLanguage(next);
    if (profile && !isGuestProfile(profile)) {
      void savePreferences({ language: next });
    }
  };

  const content = isIcon ? (
    <>
      <Globe className="h-5 w-5" />
      <span className="sr-only">Language: {language}</span>
    </>
  ) : (
    language
  );

  if (!isClient) {
    return (
      <Button variant="ghost" size="icon" className={buttonClasses}>
        {isIcon ? <Globe className="h-5 w-5" /> : '...'}
      </Button>
    );
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggleLanguage}
      className={buttonClasses}
      aria-label={`Switch to ${language === 'EN' ? 'Greek' : 'English'}`}
    >
      {content}
    </Button>
  );
}
