'use client';

import { useCallback, useState } from 'react';
import { useLanguage } from '@/components/language-provider';
import { useStickerStore } from './sticker-store';
import { Upload, Image as ImageIcon, X, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

interface ImageUploaderProps {
  className?: string;
  compact?: boolean;
}

export function ImageUploader({ className, compact = false }: ImageUploaderProps) {
  const { t } = useLanguage();
  const { originalImage, setOriginalImage, isProcessing } = useStickerStore();
  const [isDragging, setIsDragging] = useState(false);

  const handleFile = useCallback((file: File) => {
    if (!ACCEPTED_TYPES.includes(file.type)) {
      alert(t('errors.invalidFormat'));
      return;
    }

    if (file.size > MAX_FILE_SIZE) {
      alert(t('errors.fileTooBig'));
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
  }, [setOriginalImage, t]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    const file = e.dataTransfer.files[0];
    if (file) {
      handleFile(file);
    }
  }, [handleFile]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleFile(file);
    }
  }, [handleFile]);

  const handleRemove = useCallback(() => {
    setOriginalImage(null);
    useStickerStore.getState().setProcessedImage(null);
  }, [setOriginalImage]);

  // Compact mode - solo botón
  if (compact || originalImage) {
    return (
      <div className={cn("relative", className)}>
        <input
          type="file"
          accept={ACCEPTED_TYPES.join(',')}
          onChange={handleInputChange}
          className="hidden"
          id="image-upload-compact"
        />
        <label htmlFor="image-upload-compact" className="cursor-pointer">
          <Button
            variant="outline"
            size="sm"
            className="w-full"
            asChild
            disabled={isProcessing}
          >
            <span>
              <Upload className="w-4 h-4 mr-2" />
              {t('upload.uploadNew')}
            </span>
          </Button>
        </label>
      </div>
    );
  }

  // Full upload state
  return (
    <div
      className={cn(
        "relative w-full aspect-square max-w-xs sm:max-w-sm mx-auto rounded-2xl border-2 border-dashed transition-all duration-200",
        "flex flex-col items-center justify-center gap-3 sm:gap-4 p-4 sm:p-6 cursor-pointer",
        isDragging
          ? "border-primary bg-primary/5 scale-[1.02]"
          : "border-muted-foreground/25 hover:border-primary/50 hover:bg-muted/50",
        className
      )}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
    >
      <input
        type="file"
        accept={ACCEPTED_TYPES.join(',')}
        onChange={handleInputChange}
        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
      />

      <div className="flex flex-col items-center gap-3 text-center">
        <div className={cn(
          "w-14 h-14 sm:w-16 sm:h-16 rounded-full flex items-center justify-center transition-colors",
          isDragging ? "bg-primary/20" : "bg-muted"
        )}>
          {isDragging ? (
            <ImageIcon className="h-7 w-7 sm:h-8 sm:w-8 text-primary" />
          ) : (
            <Upload className="h-7 w-7 sm:h-8 sm:w-8 text-muted-foreground" />
          )}
        </div>

        <div className="space-y-1">
          <p className="font-medium text-sm sm:text-base">
            {isDragging ? t('upload.dragHere') : t('upload.subtitle')}
          </p>
          <p className="text-xs sm:text-sm text-muted-foreground hidden sm:block">
            {t('upload.formats')} • {t('upload.maxSize')}
          </p>
        </div>
      </div>
    </div>
  );
}
