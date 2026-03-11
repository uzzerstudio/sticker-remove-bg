'use client';

import { useState, useCallback } from 'react';
import { useLanguage } from '@/components/language-provider';
import { useStickerStore } from './sticker-store';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Download, Loader2, Zap, FileImage } from 'lucide-react';
import { toast } from '@/hooks/use-toast';

type Quality = 'high' | 'medium' | 'low';

// Apply gaussian blur to alpha channel for anti-aliasing
function blurAlphaChannel(alpha: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  const result = new Uint8Array(alpha.length);
  const kernelSize = Math.ceil(radius * 2) | 1;
  const halfKernel = Math.floor(kernelSize / 2);
  
  for (let pass = 0; pass < 2; pass++) {
    const tempH = new Uint8Array(alpha.length);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let sum = 0;
        let count = 0;
        for (let k = -halfKernel; k <= halfKernel; k++) {
          const nx = x + k;
          if (nx >= 0 && nx < width) {
            sum += alpha[y * width + nx];
            count++;
          }
        }
        tempH[y * width + x] = Math.round(sum / count);
      }
    }
    
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let sum = 0;
        let count = 0;
        for (let k = -halfKernel; k <= halfKernel; k++) {
          const ny = y + k;
          if (ny >= 0 && ny < height) {
            sum += tempH[ny * width + x];
            count++;
          }
        }
        result[y * width + x] = Math.round(sum / count);
      }
    }
    
    for (let i = 0; i < alpha.length; i++) {
      alpha[i] = result[i];
    }
  }
  
  return result;
}

// Create outline - quality affects anti-aliasing
function createOutline(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement | HTMLCanvasElement,
  drawX: number,
  drawY: number,
  outlineWidth: number,
  outlineColor: string,
  canvasWidth: number,
  canvasHeight: number,
  antiAlias: boolean
) {
  if (outlineWidth <= 0) return;

  const hex = outlineColor.replace('#', '');
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);

  const maskCanvas = document.createElement('canvas');
  maskCanvas.width = canvasWidth;
  maskCanvas.height = canvasHeight;
  const maskCtx = maskCanvas.getContext('2d')!;
  maskCtx.drawImage(img, drawX, drawY);

  const maskData = maskCtx.getImageData(0, 0, canvasWidth, canvasHeight);
  const originalAlpha = new Uint8Array(canvasWidth * canvasHeight);
  
  for (let i = 0; i < originalAlpha.length; i++) {
    originalAlpha[i] = maskData.data[i * 4 + 3] > 128 ? 255 : 0;
  }

  const dilatedAlpha = new Uint8Array(originalAlpha);
  
  for (let pass = 0; pass < outlineWidth; pass++) {
    const tempAlpha = new Uint8Array(dilatedAlpha);
    
    for (let y = 1; y < canvasHeight - 1; y++) {
      for (let x = 1; x < canvasWidth - 1; x++) {
        const idx = y * canvasWidth + x;
        
        const neighbors = [
          dilatedAlpha[idx - canvasWidth - 1],
          dilatedAlpha[idx - canvasWidth],
          dilatedAlpha[idx - canvasWidth + 1],
          dilatedAlpha[idx - 1],
          dilatedAlpha[idx + 1],
          dilatedAlpha[idx + canvasWidth - 1],
          dilatedAlpha[idx + canvasWidth],
          dilatedAlpha[idx + canvasWidth + 1],
          dilatedAlpha[idx],
        ];
        
        if (neighbors.some(a => a > 128)) {
          tempAlpha[idx] = 255;
        }
      }
    }
    
    for (let i = 0; i < dilatedAlpha.length; i++) {
      dilatedAlpha[i] = tempAlpha[i];
    }
  }

  const outlineAlpha = new Uint8Array(dilatedAlpha.length);
  
  for (let i = 0; i < outlineAlpha.length; i++) {
    if (dilatedAlpha[i] > 128 && originalAlpha[i] < 128) {
      outlineAlpha[i] = 255;
    }
  }

  // Apply anti-aliasing only if enabled
  const finalAlpha = antiAlias 
    ? blurAlphaChannel(outlineAlpha, canvasWidth, canvasHeight, 1.5)
    : outlineAlpha;

  const outlineData = ctx.createImageData(canvasWidth, canvasHeight);
  
  for (let i = 0; i < finalAlpha.length; i++) {
    const px = i * 4;
    const alpha = finalAlpha[i];
    
    if (alpha > 0) {
      outlineData.data[px] = r;
      outlineData.data[px + 1] = g;
      outlineData.data[px + 2] = b;
      outlineData.data[px + 3] = alpha;
    }
  }

  ctx.putImageData(outlineData, 0, 0);
}

export function ExportPanel() {
  const { t } = useLanguage();
  const { originalImage, processedImage, outlineWidth, outlineColor, padding, isProcessing } = useStickerStore();
  const [format, setFormat] = useState<'png' | 'webp'>('png');
  const [quality, setQuality] = useState<Quality>('high');
  const [isExporting, setIsExporting] = useState(false);

  const handleExport = useCallback(async () => {
    const image = processedImage || originalImage;
    if (!image) {
      toast({ title: 'No hay imagen para exportar', variant: 'destructive' });
      return;
    }

    setIsExporting(true);

    try {
      const img = new Image();
      img.crossOrigin = 'anonymous';

      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error('Failed to load image'));
        img.src = image;
      });

      // Calculate crop offsets (for negative padding)
      const cropLeft = Math.max(0, -padding.left);
      const cropTop = Math.max(0, -padding.top);
      const cropRight = Math.max(0, -padding.right);
      const cropBottom = Math.max(0, -padding.bottom);

      const srcX = cropLeft;
      const srcY = cropTop;
      const srcWidth = img.width - cropLeft - cropRight;
      const srcHeight = img.height - cropTop - cropBottom;

      const finalSrcWidth = Math.max(1, srcWidth);
      const finalSrcHeight = Math.max(1, srcHeight);

      // Calculate positive padding (extra space around)
      const extraLeft = Math.max(0, padding.left);
      const extraTop = Math.max(0, padding.top);
      const extraRight = Math.max(0, padding.right);
      const extraBottom = Math.max(0, padding.bottom);

      const totalPaddingH = extraLeft + extraRight;
      const totalPaddingV = extraTop + extraBottom;
      const outlineSpace = outlineWidth * 2;

      const canvasWidth = finalSrcWidth + totalPaddingH + outlineSpace;
      const canvasHeight = finalSrcHeight + totalPaddingV + outlineSpace;

      const canvas = document.createElement('canvas');
      canvas.width = canvasWidth;
      canvas.height = canvasHeight;
      const ctx = canvas.getContext('2d')!;

      ctx.clearRect(0, 0, canvasWidth, canvasHeight);

      const drawX = extraLeft + outlineWidth;
      const drawY = extraTop + outlineWidth;

      const croppedCanvas = document.createElement('canvas');
      croppedCanvas.width = finalSrcWidth;
      croppedCanvas.height = finalSrcHeight;
      const croppedCtx = croppedCanvas.getContext('2d')!;
      croppedCtx.drawImage(img, srcX, srcY, finalSrcWidth, finalSrcHeight, 0, 0, finalSrcWidth, finalSrcHeight);

      // Anti-aliasing only for high quality
      const useAntiAlias = quality === 'high';
      
      if (outlineWidth > 0) {
        createOutline(ctx, croppedCanvas, drawX, drawY, outlineWidth, outlineColor, canvasWidth, canvasHeight, useAntiAlias);
      }

      ctx.drawImage(croppedCanvas, drawX, drawY);

      // Get initial data URL
      const initialDataUrl = canvas.toDataURL('image/png');

      // Optimize via API
      const response = await fetch('/api/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image: initialDataUrl,
          format,
          quality,
        }),
      });

      const data = await response.json();

      if (data.success && data.image) {
        const link = document.createElement('a');
        link.href = data.image;
        link.download = `sticker-${Date.now()}.${format}`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        const originalKB = Math.round(data.originalSize / 1024);
        const optimizedKB = Math.round(data.optimizedSize / 1024);
        const reduction = data.reduction;

        toast({
          title: `✓ Exportado: ${optimizedKB}KB`,
          description: reduction > 0 ? `Optimizado (-${reduction}% de peso)` : undefined,
        });
      } else {
        throw new Error(data.error || 'Export failed');
      }
    } catch (error) {
      console.error('Export error:', error);
      toast({ title: 'Error al exportar', variant: 'destructive' });
    } finally {
      setIsExporting(false);
    }
  }, [originalImage, processedImage, outlineWidth, outlineColor, padding, format, quality]);

  if (!originalImage) return null;

  const formatPadding = (val: number) => val >= 0 ? `+${val}px` : `${val}px`;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Download className="w-4 h-4" />
          {t('export.title')}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Format Selection */}
        <div className="space-y-2">
          <Label className="text-sm">{t('export.format')}</Label>
          <Select value={format} onValueChange={(v) => setFormat(v as 'png' | 'webp')}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="png">
                <div className="flex items-center gap-2">
                  <FileImage className="w-4 h-4" />
                  PNG - Mejor calidad
                </div>
              </SelectItem>
              <SelectItem value="webp">
                <div className="flex items-center gap-2">
                  <Zap className="w-4 h-4" />
                  WebP - Menor peso
                </div>
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Quality Selection */}
        <div className="space-y-2">
          <Label className="text-sm">Calidad / Peso</Label>
          <Select value={quality} onValueChange={(v) => setQuality(v as Quality)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="high">
                <div>
                  <div className="font-medium">Alta calidad</div>
                  <div className="text-xs text-muted-foreground">Anti-aliasing activado, mayor peso</div>
                </div>
              </SelectItem>
              <SelectItem value="medium">
                <div>
                  <div className="font-medium">Equilibrado</div>
                  <div className="text-xs text-muted-foreground">Sin anti-aliasing, peso medio</div>
                </div>
              </SelectItem>
              <SelectItem value="low">
                <div>
                  <div className="font-medium">Peso mínimo</div>
                  <div className="text-xs text-muted-foreground">Máxima compresión, menor peso</div>
                </div>
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Tip */}
        <div className="text-xs text-muted-foreground bg-muted/50 p-2 rounded">
          💡 <strong>Tip:</strong> Usa <strong>WebP</strong> + <strong>Peso mínimo</strong> para stickers más livianos
        </div>

        {/* Current Settings Summary */}
        <div className="text-xs text-muted-foreground space-y-1 bg-muted/50 p-2 rounded">
          <p>• Contorno: {outlineWidth}px</p>
          <p>• Color: <span className="inline-block w-3 h-3 rounded align-middle border" style={{ backgroundColor: outlineColor }} /></p>
          <div className="grid grid-cols-2 gap-1">
            <span>↑ {formatPadding(padding.top)}</span>
            <span>↓ {formatPadding(padding.bottom)}</span>
            <span>← {formatPadding(padding.left)}</span>
            <span>→ {formatPadding(padding.right)}</span>
          </div>
        </div>

        {/* Export Button */}
        <Button
          className="w-full bg-gradient-to-r from-pink-500 to-violet-500 hover:from-pink-600 hover:to-violet-600 text-white"
          onClick={handleExport}
          disabled={isExporting || isProcessing}
        >
          {isExporting ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Optimizando...
            </>
          ) : (
            <>
              <Download className="w-4 h-4 mr-2" />
              {t('export.download')} {format.toUpperCase()}
            </>
          )}
        </Button>
      </CardContent>
    </Card>
  );
}
