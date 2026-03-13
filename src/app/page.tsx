'use client';

import { Header } from '@/components/stickify/header';
import { Footer } from '@/components/stickify/footer';
import { ImageUploader } from '@/components/stickify/image-uploader';
import { StickerCanvas } from '@/components/stickify/sticker-canvas';
import { useStickerStore } from '@/components/stickify/sticker-store';
import { useLanguage } from '@/components/language-provider';
import { Sparkles, Upload } from 'lucide-react';
import { CompactToolbar } from '@/components/stickify/compact-toolbar';
import { useState, useCallback } from 'react';
import { cn } from '@/lib/utils';

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

export default function Home() {
  const { t } = useLanguage();
  const { originalImage, setOriginalImage } = useStickerStore();
  const [isDraggingGlobal, setIsDraggingGlobal] = useState(false);

  const handleFile = useCallback((file: File) => {
    if (!ACCEPTED_TYPES.includes(file.type)) {
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const result = e.target?.result as string;
      setOriginalImage(result);

      // Get image dimensions
      const img = new Image();
      img.onload = () => {
        useStickerStore.getState().setImageDimensions(img.width, img.height);
      };
      img.src = result;
    };
    reader.readAsDataURL(file);
  }, [setOriginalImage]);

  const handleGlobalDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingGlobal(true);
  };

  const handleGlobalDragLeave = (e: React.DragEvent) => {
    // Only hide if we actually left the window or container
    if (e.currentTarget === e.target) {
      setIsDraggingGlobal(false);
    }
  };

  const handleGlobalDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingGlobal(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  return (
    <div
      className="h-screen flex flex-col bg-background overflow-hidden relative"
      onDragOver={handleGlobalDragOver}
      onDragLeave={handleGlobalDragLeave}
      onDrop={handleGlobalDrop}
    >
      <Header />

      <main className="flex-1 flex flex-col min-h-0 overflow-hidden relative">
        {!originalImage ? (
          // Upload State
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
          // Editor State
          <>
            <StickerCanvas />
            <CompactToolbar />
          </>
        )}

        {/* Global Drop Overlay */}
        {isDraggingGlobal && (
          <div className="absolute inset-0 z-[9999] bg-primary/10 backdrop-blur-md border-4 border-dashed border-primary m-4 rounded-3xl flex flex-col items-center justify-center gap-4 pointer-events-none animate-in fade-in zoom-in duration-200">
            <div className="w-20 h-20 bg-primary/20 rounded-full flex items-center justify-center shadow-xl">
              <Upload className="w-10 h-10 text-primary animate-bounce" />
            </div>
            <h2 className="text-2xl font-bold text-primary">
              {t('upload.dragHere')}
            </h2>
          </div>
        )}
      </main>
    </div>
  );
}
