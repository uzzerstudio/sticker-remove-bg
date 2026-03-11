'use client';

import { Header } from '@/components/stickify/header';
import { Footer } from '@/components/stickify/footer';
import { ImageUploader } from '@/components/stickify/image-uploader';
import { StickerCanvas } from '@/components/stickify/sticker-canvas';
import { useStickerStore } from '@/components/stickify/sticker-store';
import { useLanguage } from '@/components/language-provider';
import { Sparkles } from 'lucide-react';
import { CompactToolbar } from '@/components/stickify/compact-toolbar';

export default function Home() {
  const { t } = useLanguage();
  const { originalImage } = useStickerStore();

  return (
    <div className="h-screen flex flex-col bg-background overflow-hidden">
      <Header />

      <main className="flex-1 flex flex-col min-h-0 overflow-hidden">
        {!originalImage ? (
          // Upload State - Centrado en pantalla
          <div className="flex-1 flex flex-col items-center justify-center gap-6 p-4 overflow-auto">
            <div className="text-center space-y-2">
              <h1 className="text-3xl sm:text-4xl font-bold bg-gradient-to-r from-pink-500 to-violet-500 bg-clip-text text-transparent">
                {t('app.name')}
              </h1>
              <p className="text-muted-foreground text-lg">
                {t('app.tagline')}
              </p>
            </div>
            <ImageUploader />
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Sparkles className="w-4 h-4 text-pink-500" />
              <span>{t('app.description')}</span>
            </div>
          </div>
        ) : (
          // Editor State - Canvas arriba, opciones abajo
          <>
            {/* Canvas Area - Takes remaining space */}
            <StickerCanvas />

            {/* Options Panel - Fixed at bottom */}
            <CompactToolbar />
          </>
        )}
      </main>

      {/* <Footer /> */}
    </div>
  );
}
