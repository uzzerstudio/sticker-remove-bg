'use client';

import { useTheme } from 'next-themes';
import { useLanguage } from '@/components/language-provider';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Sun, Moon, Languages, Sparkles } from 'lucide-react';
import { locales, type Locale } from '@/i18n/config';

export function Header() {
  const { theme, setTheme } = useTheme();
  const { locale, setLocale, t } = useLanguage();

  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container flex h-14 items-center justify-between px-4">
        <div className="flex items-center gap-2">
          <img
            src="/sticker-logo.png"
            alt={t('app.name')}
            className="w-10 h-10 object-contain drop-shadow-sm"
          />
          <span className="font-bold text-lg bg-gradient-to-r from-pink-500 to-violet-500 bg-clip-text text-transparent">
            {t('app.name')}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {/* Language Selector */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-9 w-9">
                <Languages className="h-5 w-5" />
                <span className="sr-only">{t('header.language')}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {locales.map((loc) => (
                <DropdownMenuItem
                  key={loc}
                  onClick={() => setLocale(loc)}
                  className={locale === loc ? 'bg-accent' : ''}
                >
                  {loc === 'es' ? t('header.spanish') : t('header.english')}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Theme Toggle */}
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9"
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          >
            {theme === 'dark' ? (
              <Sun className="h-5 w-5" />
            ) : (
              <Moon className="h-5 w-5" />
            )}
            <span className="sr-only">
              {theme === 'dark' ? t('header.lightMode') : t('header.darkMode')}
            </span>
          </Button>
        </div>
      </div>
    </header>
  );
}
