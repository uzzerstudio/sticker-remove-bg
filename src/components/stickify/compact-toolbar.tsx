'use client';

import { useState, useCallback } from 'react';
import { useLanguage } from '@/components/language-provider';
import { useStickerStore } from './sticker-store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Upload,
  Download,
  Loader2,
  Undo2,
  Wand2,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Crop,
  Layers,
  PaintBucket,
  Trash2,
  Sparkles,
  Eraser,
  RotateCcw,
  Plus,
  Minus,
  Move,
} from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { type Locale } from '@/i18n/config';
import UPNG from 'upng-js';
import pako from 'pako';

// Inject pako into window globally so UPNG.js automatically uses it for maximum DEFLATE compression
if (typeof window !== 'undefined') {
  (window as any).pako = pako;
}

// Import Transformers.js for browser AI
const getTransformers = async () => {
  const { pipeline, env } = await import('@huggingface/transformers');
  // Disable searching for local models by default
  env.allowLocalModels = false;
  // Base URL for model files
  env.remoteHost = 'https://huggingface.co';
  return { pipeline };
};

type Quality = 'high' | 'medium' | 'low';

// Preset colors for outline
const OUTLINE_PRESETS = [
  { color: '#FFFFFF', name: 'Blanco' },
  { color: '#F0F0F0', name: 'Gris' },
  { color: '#000000', name: 'Negro' },
  { color: '#FFD700', name: 'Dorado' },
];

// Helper to apply threshold to a canvas
function thresholdCanvasAlpha(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;
  for (let i = 0; i < data.length; i += 4) {
    // Threshold alpha at 128 (50%) - pure math cleaning
    data[i + 3] = data[i + 3] < 128 ? 0 : 255;
  }
  ctx.putImageData(imageData, 0, 0);
}

/**
 * createOutline — CPU port of the editor's SVG filter pipeline:
 *   feColorMatrix(threshold) → feMorphology(dilate) → feGaussianBlur → feColorMatrix(re-threshold)
 *
 * @param ctx     Target rendering context (outline is drawn here first; caller draws original on top)
 * @param compositeCanvas  The fully composited sticker (fill + PNG − erases)
 * @param outlineWidth Outline radius in logical canvas pixels
 * @param outlineColor  Hex color string (e.g. '#FF0000')
 * @param w / h   Canvas logical dimensions
 */
function createOutline(
  ctx: CanvasRenderingContext2D,
  compositeCanvas: HTMLCanvasElement,
  outlineWidth: number,
  outlineColor: string,
  w: number,
  h: number
) {
  if (outlineWidth === 0) return;

  const isInner = outlineWidth < 0;
  const absWidth = Math.abs(outlineWidth);

  const hex = outlineColor.replace('#', '');
  const rC = parseInt(hex.substring(0, 2), 16);
  const gC = parseInt(hex.substring(2, 4), 16);
  const bC = parseInt(hex.substring(4, 6), 16);

  // ── Step 1: Extract + threshold alpha at 50% (feColorMatrix) ─────────────
  const srcCtx = compositeCanvas.getContext('2d', { willReadFrequently: true })!;
  const pixels = srcCtx.getImageData(0, 0, w, h).data;
  const binary = new Uint8Array(w * h);
  for (let i = 0; i < binary.length; i++) {
    const isOpaque = pixels[i * 4 + 3] >= 128;
    binary[i] = isInner ? (isOpaque ? 0 : 255) : (isOpaque ? 255 : 0);
  }

  // ── Step 2: Box dilation by outlineWidth (feMorphology dilate) ───────────
  // Fast O(W×H) separable 1-D sweep (Chebyshev / box metric)
  const dilated = new Uint8Array(w * h);
  {
    const tmp = new Uint8Array(w * h);
    for (let row = 0; row < h; row++) {
      let last = -0x7fffffff;
      for (let col = 0; col < w; col++) {
        if (binary[row * w + col]) last = col;
        if (col - last <= absWidth) tmp[row * w + col] = 255;
      }
      last = 0x7fffffff;
      for (let col = w - 1; col >= 0; col--) {
        if (binary[row * w + col]) last = col;
        if (last - col <= absWidth) tmp[row * w + col] = 255;
      }
    }
    for (let col = 0; col < w; col++) {
      let last = -0x7fffffff;
      for (let row = 0; row < h; row++) {
        if (tmp[row * w + col]) last = row;
        if (row - last <= absWidth) dilated[row * w + col] = 255;
      }
      last = 0x7fffffff;
      for (let row = h - 1; row >= 0; row--) {
        if (tmp[row * w + col]) last = row;
        if (last - row <= absWidth) dilated[row * w + col] = 255;
      }
    }
  }

  // ── Step 3: Gaussian approximate (Iterated Box Blur) ─────────────────────
  // 3 passes of box-blur with radius matching stroke/2 scaled by 1.73 for SVG parity
  const blurRad = Math.max(1, Math.round(absWidth * 0.35 * 1.73));

  function boxBlur(src: Uint8Array): Uint8Array {
    const hPass = new Float32Array(w * h);
    const norm = 2 * blurRad + 1;
    // Horizontal
    for (let row = 0; row < h; row++) {
      let sum = 0;
      for (let x = -blurRad; x <= blurRad; x++) sum += (x >= 0 && x < w) ? src[row * w + x] : 0;
      hPass[row * w + 0] = sum / norm;
      for (let col = 1; col < w; col++) {
        const addX = col + blurRad; if (addX < w) sum += src[row * w + addX];
        const remX = col - blurRad - 1; if (remX >= 0) sum -= src[row * w + remX];
        hPass[row * w + col] = sum / norm;
      }
    }
    const out = new Uint8Array(w * h);
    // Vertical
    for (let col = 0; col < w; col++) {
      let sum = 0;
      for (let y = -blurRad; y <= blurRad; y++) sum += (y >= 0 && y < h) ? hPass[y * w + col] : 0;
      out[0 * w + col] = Math.max(0, Math.min(255, sum / norm));
      for (let row = 1; row < h; row++) {
        const addY = row + blurRad; if (addY < h) sum += hPass[addY * w + col];
        const remY = row - blurRad - 1; if (remY >= 0) sum -= hPass[remY * w + col];
        out[row * w + col] = Math.max(0, Math.min(255, sum / norm));
      }
    }
    return out;
  }

  let blurred = boxBlur(dilated);
  blurred = boxBlur(blurred);
  blurred = boxBlur(blurred);

  // ── Step 4: feColorMatrix(20 -10) equivalent ─────────────────────────────
  // new_alpha = clamp(20 × blur_norm − 10, 0, 1) × 255
  // Matches SVG second feColorMatrix: tight outline + only ~1-2px smooth edge
  const outlineData = ctx.createImageData(w, h);
  for (let i = 0; i < blurred.length; i++) {
    const a = Math.round(Math.min(1, Math.max(0, 20 * (blurred[i] / 255) - 10)) * 255);
    if (a > 0) {
      if (isInner && pixels[i * 4 + 3] < 128) continue; // Only draw inner outline inside the object
      const px = i * 4;
      outlineData.data[px] = rC;
      outlineData.data[px + 1] = gC;
      outlineData.data[px + 2] = bC;
      outlineData.data[px + 3] = a;
    }
  }
  ctx.putImageData(outlineData, 0, 0);
}


export function CompactToolbar() {
  const { t } = useLanguage();
  const {
    originalImage,
    processedImage,
    outlineWidth,
    outlineWidthCm,
    setOutlineWidth,
    setOutlineWidthCm,
    outlineColor,
    setOutlineColor,
    padding,
    setPadding,
    setProcessedImage,
    isProcessing,
    setIsProcessing,
    zoom,
    setZoom,
    autoCrop,
    triggerFit,
    activeTool,
    setActiveTool,
    manualFillMask,
    setManualFillMask,
    transparencyMask,
    setTransparencyMask,
    brushSize,
    setBrushSize,
  } = useStickerStore();

  const [format, setFormat] = useState<'png' | 'webp' | 'jpg'>('png');
  const [quality, setQuality] = useState<Quality>('high');
  const [isExporting, setIsExporting] = useState(false);

  // Brush sizes
  const BRUSH_SIZES = [
    { label: 'S', value: 15, radius: 2 },
    { label: 'M', value: 35, radius: 4 },
    { label: 'L', value: 65, radius: 6 },
  ];

  // Zoom handlers
  const handleZoomIn = () => setZoom(zoom + 0.1);
  const handleZoomOut = () => setZoom(zoom - 0.1);
  const handleFitToScreen = () => triggerFit();

  // Remove background using Local browser AI (Transformers.js)
  const handleRemoveBackground = useCallback(async () => {
    if (!originalImage) return;
    setIsProcessing(true);

    try {
      toast({ title: 'Cargando modelo de IA...', description: 'La primera vez tardará ~1 min (~70MB). Luego será instantáneo.', duration: 5000 });

      const { pipeline } = await getTransformers();

      // Load the model (runs only once)
      const segmenter = await pipeline('image-segmentation', 'briaai/RMBG-1.4');

      // Process the image
      const output = await segmenter(originalImage);

      // Handle the array output
      const result = Array.isArray(output) ? output[0] : output;

      // Get the mask data (RMBG-1.4 returns a mask)
      const rawMask = result.mask || result;

      const maskCanvas = document.createElement('canvas');
      maskCanvas.width = rawMask.width;
      maskCanvas.height = rawMask.height;
      const maskCtx = maskCanvas.getContext('2d')!;

      // 1. Create the Alpha Mask from the raw data
      const maskData = rawMask.data as Uint8Array;
      const rgba = new Uint8ClampedArray(rawMask.width * rawMask.height * 4);

      if (rawMask.channels === 1) {
        for (let i = 0; i < maskData.length; ++i) {
          const idx = i * 4;
          rgba[idx] = 0; rgba[idx + 1] = 0; rgba[idx + 2] = 0;
          rgba[idx + 3] = maskData[i];
        }
      } else {
        rgba.set(maskData);
      }
      maskCtx.putImageData(new ImageData(rgba, rawMask.width, rawMask.height), 0, 0);

      // 2. Load original image and apply mask
      const originalImg = new Image();
      originalImg.src = originalImage;
      await new Promise((resolve) => { originalImg.onload = resolve; });

      const finalCanvas = document.createElement('canvas');
      finalCanvas.width = originalImg.width;
      finalCanvas.height = originalImg.height;
      const finalCtx = finalCanvas.getContext('2d')!;

      // Draw original
      finalCtx.drawImage(originalImg, 0, 0);

      // Apply mask using destination-in
      finalCtx.globalCompositeOperation = 'destination-in';
      finalCtx.drawImage(maskCanvas, 0, 0, originalImg.width, originalImg.height);

      setProcessedImage(finalCanvas.toDataURL());
      toast({ title: '✓ Fondo removido perfectamente' });
      setIsProcessing(false);

    } catch (error) {
      console.error('Local AI error:', error);
      toast({
        title: 'Error de IA Local',
        description: 'No se pudo cargar el modelo en tu navegador.',
        variant: 'destructive'
      });
      setIsProcessing(false);
    }
  }, [originalImage, setProcessedImage, setIsProcessing]);

  // Reset image
  const resetImage = useCallback(() => {
    setProcessedImage(null);
    toast({ title: '↩️ Imagen restaurada' });
  }, [setProcessedImage]);

  // Export
  const handleExport = useCallback(async () => {
    const image = processedImage || originalImage;
    if (!image) return;
    setIsExporting(true);

    try {
      const img = new Image();
      img.crossOrigin = 'anonymous';

      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error('Failed to load'));
        img.src = image;
      });

      const cropLeft = Math.max(0, -padding.left);
      const cropTop = Math.max(0, -padding.top);
      const cropRight = Math.max(0, -padding.right);
      const cropBottom = Math.max(0, -padding.bottom);

      const srcWidth = img.width - cropLeft - cropRight;
      const srcHeight = img.height - cropTop - cropBottom;

      const extraLeft = Math.max(0, padding.left);
      const extraTop = Math.max(0, padding.top);
      const extraRight = Math.max(0, padding.right);
      const extraBottom = Math.max(0, padding.bottom);

      const outlineSpace = outlineWidth > 0 ? outlineWidth * 2 : 0;
      const canvasWidth = Math.max(1, srcWidth) + extraLeft + extraRight + outlineSpace;
      const canvasHeight = Math.max(1, srcHeight) + extraTop + extraBottom + outlineSpace;

      const canvas = document.createElement('canvas');
      canvas.width = canvasWidth;
      canvas.height = canvasHeight;
      const ctx = canvas.getContext('2d')!;
      if (format === 'jpg') {
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, canvasWidth, canvasHeight);
      } else {
        ctx.clearRect(0, 0, canvasWidth, canvasHeight);
      }

      const drawX = extraLeft + (outlineWidth > 0 ? outlineWidth : 0);
      const drawY = extraTop + (outlineWidth > 0 ? outlineWidth : 0);

      const croppedCanvas = document.createElement('canvas');
      croppedCanvas.width = Math.max(1, srcWidth);
      croppedCanvas.height = Math.max(1, srcHeight);
      const croppedCtx = croppedCanvas.getContext('2d')!;
      croppedCtx.drawImage(img, cropLeft, cropTop, Math.max(1, srcWidth), Math.max(1, srcHeight), 0, 0, Math.max(1, srcWidth), Math.max(1, srcHeight));

      const useAntiAlias = quality === 'high';

      let fillMaskImg: HTMLImageElement | null = null;
      if (manualFillMask) {
        fillMaskImg = new Image();
        fillMaskImg.src = manualFillMask;
        await new Promise((res) => fillMaskImg!.onload = res);
      }

      // 3b. Draw transparency mask
      let transImg: HTMLImageElement | null = null;
      if (transparencyMask) {
        transImg = new Image();
        transImg.src = transparencyMask;
        await new Promise<void>((resolve) => {
          transImg!.onload = () => resolve();
        });
      }

      // ── Build composite canvas (fill + PNG − erases) ───────────────────────
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = canvasWidth;
      tempCanvas.height = canvasHeight;
      const tCtx = tempCanvas.getContext('2d')!;

      // Layer 1: fill mask colored with outline color (immune to erase)
      if (fillMaskImg) {
        const colorCanvas = document.createElement('canvas');
        colorCanvas.width = canvasWidth;
        colorCanvas.height = canvasHeight;
        const cCtx = colorCanvas.getContext('2d')!;
        cCtx.fillStyle = outlineColor;
        cCtx.fillRect(0, 0, canvasWidth, canvasHeight);
        cCtx.globalCompositeOperation = 'destination-in';
        cCtx.drawImage(fillMaskImg, 0, 0, canvasWidth, canvasHeight);
        tCtx.drawImage(colorCanvas, 0, 0);
      }

      // Layer 2: PNG with erase mask applied to its own layer
      // NOTE: No alpha thresholding here — we preserve the PNG's natural
      // anti-aliased edges so the exported image matches the editor quality.
      const pngCanvas = document.createElement('canvas');
      pngCanvas.width = canvasWidth;
      pngCanvas.height = canvasHeight;
      const pngCtx = pngCanvas.getContext('2d')!;
      pngCtx.drawImage(croppedCanvas, drawX, drawY);
      if (transImg) {
        pngCtx.save();
        pngCtx.globalCompositeOperation = 'destination-out';
        pngCtx.drawImage(transImg, 0, 0, canvasWidth, canvasHeight);
        pngCtx.restore();
      }
      // ⚠️  Do NOT call thresholdCanvasAlpha here — it destroys anti-aliasing
      tCtx.drawImage(pngCanvas, 0, 0);
      // ─────────────────────────────────────────────────────────────────────

      // ── Outline (CPU equivalent of SVG filter) — drawn depending on sign ──
      if (outlineWidth !== 0) {
        if (outlineWidth > 0) {
          // outer: drawn under composite
          createOutline(ctx, tempCanvas, outlineWidth, outlineColor, canvasWidth, canvasHeight);
          ctx.drawImage(tempCanvas, 0, 0);
        } else {
          // inner: drawn over composite
          ctx.drawImage(tempCanvas, 0, 0);
          createOutline(ctx, tempCanvas, outlineWidth, outlineColor, canvasWidth, canvasHeight);
        }
      } else {
        ctx.drawImage(tempCanvas, 0, 0);
      }




      // ── Client-side Export (Static friendly) ─────────────────────────────
      if (format === 'png') {
        // UPNG.js compresses PNGs much better than native canvas.toBlob
        const imgData = ctx.getImageData(0, 0, canvasWidth, canvasHeight);

        // cnum = 256 -> Lossy color quantization (Visual lossless), typical of TinyPNG / iloveimg
        // This drops a 800kb file to ~180kb while mapping 16m colors to the best 256.
        const pngBuffer = UPNG.encode([imgData.data.buffer], canvasWidth, canvasHeight, 256);

        const blob = new Blob([pngBuffer], { type: 'image/png' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `sticker-${Date.now()}.png`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);

        toast({
          title: `✓ Exportado como PNG`,
          description: `El archivo ha sido optimizado con máxima calidad.`,
        });
      } else {
        const mimeType = format === 'jpg' ? 'image/jpeg' : 'image/webp';
        const fileExt = format === 'jpg' ? 'jpg' : 'webp';
        const displayFormat = format === 'jpg' ? 'JPG' : 'WEBP';
        // Para acercarse al peso original de un JPEG, 0.82 reduce drásticamente el peso manteniendo la calidad visual.
        const qualityValue = quality === 'high' ? 0.82 : quality === 'medium' ? 0.60 : 0.40;

        canvas.toBlob((blob) => {
          if (!blob) throw new Error('Failed to create blob');

          const url = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = url;
          link.download = `sticker-${Date.now()}.${fileExt}`;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          URL.revokeObjectURL(url);

          toast({
            title: `✓ Exportado como ${displayFormat}`,
            description: `Calidad: ${quality === 'high' ? 'Máxima' : quality === 'medium' ? 'Media' : 'Baja'}`,
          });
        }, mimeType, qualityValue);
      }

    } catch (error) {
      console.error('Export error:', error);
      toast({ title: 'Error al exportar', variant: 'destructive' });
    } finally {
      setIsExporting(false);
    }
  }, [originalImage, processedImage, outlineWidth, outlineColor, padding, format, quality, manualFillMask, transparencyMask]);

  // File upload handler
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const result = ev.target?.result as string;
      useStickerStore.getState().setOriginalImage(result);
      useStickerStore.getState().setProcessedImage(null);
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className="flex-shrink-0 border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 p-2 sm:p-3 safe-bottom">
      {/* 2x2 Grid on mobile, Flex row on PC */}
      <div className="max-w-[1600px] mx-auto grid grid-cols-2 sm:flex sm:items-center sm:justify-between gap-y-3 gap-x-2 sm:gap-4">

        {/* Quadrant 1: Setup & Zoom */}
        <div className="flex items-center gap-1 sm:gap-4 order-1">
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            onChange={handleFileChange}
            className="hidden"
            id="image-upload-toolbar"
          />
          <label htmlFor="image-upload-toolbar">
            <Button variant="outline" size="sm" asChild className="h-9 px-2.5 sm:px-4 cursor-pointer">
              <span>
                <Upload className="w-4 h-4 mr-1.5 sm:mr-2" />
                <span className="text-xs font-semibold hidden sm:inline">{t('upload.title')}</span>
              </span>
            </Button>
          </label>

          <div className="flex items-center bg-muted/30 rounded-lg p-0.5 scale-90 sm:scale-100">
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleZoomOut} disabled={zoom <= 0.1}>
              <ZoomOut className="h-4 w-4" />
            </Button>
            <span className="text-xs font-bold min-w-[36px] text-center">{Math.round(zoom * 100)}%</span>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleZoomIn} disabled={zoom >= 5}>
              <ZoomIn className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Quadrant 2: Formatting (Outline & Color) */}
        <div className="order-2 sm:order-2 flex items-center justify-end flex-wrap gap-1 sm:gap-2">
          {/* Outline Rocker */}
          <div className="flex items-center bg-muted/30 rounded-lg p-0.5 border border-border/50 scale-90 sm:scale-100 origin-right">
            <Button variant="ghost" size="icon" className="h-6 w-6 sm:h-7 sm:w-7" onClick={() => setOutlineWidth(Math.max(-100, outlineWidth - 1))}>
              <Minus className="h-3 w-3" />
            </Button>
            <div className="flex items-center px-1 min-w-[34px] sm:min-w-[45px] justify-center">
              <span className="text-[10px] sm:text-xs font-bold">{outlineWidth}</span>
              <span className="text-[8px] sm:text-[10px] text-muted-foreground ml-0.5">px</span>
            </div>
            <Button variant="ghost" size="icon" className="h-6 w-6 sm:h-7 sm:w-7" onClick={() => setOutlineWidth(Math.min(100, outlineWidth + 1))}>
              <Plus className="h-3 w-3" />
            </Button>
          </div>

          {/* Inline Color & Custom */}
          <div className="flex items-center gap-1 bg-muted/30 p-1 rounded-lg scale-90 sm:scale-100 origin-right">
            {OUTLINE_PRESETS.slice(0, 2).map((preset) => (
              <button
                key={preset.color}
                onClick={() => setOutlineColor(preset.color)}
                className={cn("w-5 h-5 sm:w-6 sm:h-6 rounded border-2 transition-transform", outlineColor === preset.color && "border-primary")}
                style={{ backgroundColor: preset.color }}
              />
            ))}
            <div className="relative w-5 h-5 sm:w-6 sm:h-6 hover:scale-110 transition-transform">
              <input type="color" value={outlineColor} onChange={(e) => setOutlineColor(e.target.value)} className="absolute inset-0 opacity-0 cursor-pointer z-10" />
              <div className="w-5 h-5 sm:w-6 sm:h-6 rounded border-2 flex items-center justify-center overflow-hidden" style={{ backgroundColor: outlineColor }}>
                <div className="w-full h-full bg-gradient-to-br from-white/10 to-black/10" />
              </div>
            </div>
          </div>
        </div>

        {/* Quadrant 3: Background, Manual Tools & Margins */}
        <div className="order-3 sm:order-2 col-span-1 flex items-center gap-1 sm:gap-2">
          <Button
            variant="default" size="sm"
            className="h-8 sm:h-10 bg-violet-600 hover:bg-violet-700 text-white gap-1 px-3 sm:px-4 shadow-lg shadow-violet-500/10"
            disabled={!originalImage || isProcessing}
            onClick={handleRemoveBackground}
          >
            {isProcessing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <>
                <Sparkles className="h-3.5 w-3.5 text-amber-300" />
                <span className="text-[10px] sm:text-[11px] font-semibold">Fondo</span>
              </>
            )}
          </Button>

          <div className="flex items-center gap-0.5 bg-muted/30 p-0.5 rounded-lg scale-90 sm:scale-100 origin-left">
            <Button
              variant="ghost" size="icon" className={cn("h-7 w-7", activeTool === 'fill' && "bg-indigo-500/20 text-indigo-500")}
              onClick={() => setActiveTool(activeTool === 'fill' ? 'none' : 'fill')}
            >
              <PaintBucket className="w-4 h-4" />
            </Button>
            <Button
              variant="ghost" size="icon" className={cn("h-7 w-7", activeTool === 'erase' && "bg-red-500/20 text-red-500")}
              onClick={() => setActiveTool(activeTool === 'erase' ? 'none' : 'erase')}
            >
              <Eraser className="w-4 h-4" />
            </Button>

            {/* Eraser Pencil */}
            <Button
              variant="ghost" size="icon"
              className={cn(
                "h-7 w-7",
                activeTool === 'brush_erase' && "bg-pink-500/20 text-pink-500"
              )}
              onClick={() => setActiveTool(activeTool === 'brush_erase' ? 'none' : 'brush_erase')}
            >
              <div className="relative">
                <Eraser className="w-4 h-4" />
                <div className="absolute -bottom-1 -right-1 w-2 h-2 bg-pink-500 rounded-full border border-background" />
              </div>
            </Button>

            {/* Brush Size Selector (Only visible if brush tool is active) */}
            {activeTool === 'brush_erase' && (
              <div className="flex items-center gap-0.5 ml-1 px-1 border-l border-border/50">
                {BRUSH_SIZES.map((b) => (
                  <button
                    key={b.value}
                    onClick={() => setBrushSize(b.value)}
                    className={cn(
                      "flex items-center justify-center transition-all",
                      brushSize === b.value ? "text-pink-500 scale-110" : "text-muted-foreground opacity-50 hover:opacity-100"
                    )}
                  >
                    <div
                      className="rounded-full bg-current"
                      style={{ width: b.radius * 2, height: b.radius * 2 }}
                    />
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="w-px h-5 bg-border mx-0.5 hidden sm:block" />

          {/* Margins Control Block */}
          <div className="flex items-center gap-1 bg-muted/20 p-0.5 rounded-lg border border-border/50 scale-75 sm:scale-90 origin-left">
            <div className="grid grid-cols-2 gap-0.5">
              {['top', 'right', 'bottom', 'left'].map((key) => (
                <Input
                  key={key}
                  type="number"
                  value={padding[key as keyof typeof padding]}
                  onChange={(e) => setPadding({ ...padding, [key]: parseInt(e.target.value) || 0 })}
                  className="w-7 h-5 text-[8px] p-0 text-center bg-background border-muted"
                />
              ))}
            </div>
            <div className="flex flex-col gap-0.5 ml-1 pl-1 border-l border-border/50">
              <Button
                variant="ghost"
                size="icon"
                className={cn("h-5 w-5", activeTool === 'adjust_margin' && "bg-blue-500/20 text-blue-500")}
                onClick={() => setActiveTool(activeTool === 'adjust_margin' ? 'none' : 'adjust_margin')}
                title="Ajuste interactivo"
              >
                <Move className="h-3 w-3" />
              </Button>
              <div className="flex gap-0.5">
                <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => autoCrop()} title="Auto ajuste">
                  <Crop className="h-3 w-3" />
                </Button>
                <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => setPadding({ top: 0, right: 0, bottom: 0, left: 0 })} title="Reset">
                  <RotateCcw className="h-3 w-3" />
                </Button>
              </div>
            </div>
          </div>
        </div>

        {/* Quadrant 4: Final Export */}
        <div className="order-4 sm:order-3 flex items-center justify-end gap-1.5 sm:gap-3">
          <Select value={format} onValueChange={(v) => setFormat(v as 'png' | 'webp' | 'jpg')}>
            <SelectTrigger className="w-[62px] sm:w-[75px] h-8 sm:h-10 text-[10px] sm:text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="png">PNG</SelectItem>
              <SelectItem value="webp">WebP</SelectItem>
              <SelectItem value="jpg">JPG</SelectItem>
            </SelectContent>
          </Select>

          <Button
            size="sm"
            className="h-9 sm:h-11 bg-gradient-to-r from-pink-500 via-purple-500 to-indigo-600 text-white px-4 sm:px-6 shadow-lg shadow-purple-500/20 hover:scale-105 transition-transform"
            onClick={handleExport}
            disabled={isExporting || isProcessing}
          >
            {isExporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            <span className="ml-2 font-bold text-xs hidden sm:inline">{t('export.download')}</span>
          </Button>
        </div>
      </div>
    </div>
  );
}
