'use client';

import { useLanguage } from '@/components/language-provider';
import { Heart } from 'lucide-react';

export function Footer() {
  const { t } = useLanguage();

  return (
    <footer className="mt-auto border-t bg-background">
      <div className="container flex flex-col sm:flex-row items-center justify-between gap-2 py-4 px-4 text-sm text-muted-foreground">
        <div className="flex items-center gap-1">
          <span>{t('footer.madeWith')}</span>
          <Heart className="w-4 h-4 text-pink-500 fill-pink-500" />
          <span>© 2025 Stickify. {t('footer.rights')}.</span>
        </div>
        <div className="text-xs">
          {t('footer.version')} 1.0.0
        </div>
      </div>
    </footer>
  );
}
