'use client';

import { useCallback, useState } from 'react';
import { useLanguage } from '@/components/language-provider';
import { useStickerStore } from './sticker-store';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Eraser, Loader2, Wand2, RotateCcw, Undo2 } from 'lucide-react';
import { toast } from '@/hooks/use-toast';

export function BackgroundRemover() {
  const { t } = useLanguage();
  const { originalImage, setProcessedImage, setIsProcessing, isProcessing, processedImage } = useStickerStore();
  const [tolerance, setTolerance] = useState(30);

  const removeBackground = useCallback(async () => {
    if (!originalImage) return;

    setIsProcessing(true);

    try {
      const response = await fetch('/api/remove-background', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          image: processedImage || originalImage,
          tolerance,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to remove background');
      }

      const data = await response.json();

      if (data.success && data.image) {
        setProcessedImage(data.image);
        toast({
          title: '✓ ' + t('upload.removeBackground'),
        });
      } else {
        throw new Error(data.error || 'Unknown error');
      }
    } catch (error) {
      console.error('Background removal error:', error);
      toast({
        title: t('errors.processingFailed'),
        variant: 'destructive',
      });
    } finally {
      setIsProcessing(false);
    }
  }, [originalImage, processedImage, setProcessedImage, setIsProcessing, t, tolerance]);

  const resetToOriginal = useCallback(() => {
    setProcessedImage(null);
    toast({
      title: '↩️ Imagen restaurada',
    });
  }, [setProcessedImage]);

  if (!originalImage) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <div className="w-6 h-6 rounded-md bg-gradient-to-br from-emerald-500 to-teal-500 flex items-center justify-center">
            <Wand2 className="w-3.5 h-3.5 text-white" />
          </div>
          {t('upload.removeBackground')}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Tolerance Slider */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-sm">Tolerancia</Label>
            <span className="text-sm text-muted-foreground">{tolerance}</span>
          </div>
          <Slider
            value={[tolerance]}
            onValueChange={([value]) => setTolerance(value)}
            min={5}
            max={80}
            step={5}
            className="w-full"
          />
          <p className="text-xs text-muted-foreground">
            Menor = más preciso | Mayor = elimina más área
          </p>
        </div>

        {/* Action Buttons */}
        <div className="flex gap-2">
          <Button
            className="flex-1 bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600 text-white"
            onClick={removeBackground}
            disabled={isProcessing}
          >
            {isProcessing ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                {t('upload.processing')}
              </>
            ) : (
              <>
                <Eraser className="w-4 h-4 mr-2" />
                {t('upload.removeBackground')}
              </>
            )}
          </Button>
          
          {processedImage && (
            <Button
              variant="outline"
              onClick={resetToOriginal}
              disabled={isProcessing}
              title="Restaurar imagen original"
            >
              <Undo2 className="w-4 h-4" />
            </Button>
          )}
        </div>

        {/* Status */}
        {processedImage && (
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">
              ✓ Fondo removido
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-xs text-muted-foreground"
              onClick={resetToOriginal}
            >
              <RotateCcw className="w-3 h-3 mr-1" />
              Restaurar
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
