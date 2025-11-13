'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { useLocalStorage } from '@/hooks/use-local-storage';

export function LanguageToggle() {
  const [language, setLanguage] = useLocalStorage('wordmates-lang', 'EN');
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  const toggleLanguage = () => {
    setLanguage(language === 'EN' ? 'EL' : 'EN');
  };

  if (!isMounted) {
    return (
      <Button variant="ghost" size="icon" className="w-12">
        ...
      </Button>
    );
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggleLanguage}
      className="w-12 text-lg font-bold"
      aria-label={`Switch to ${language === 'EN' ? 'Greek' : 'English'}`}
    >
      {language}
    </Button>
  );
}
