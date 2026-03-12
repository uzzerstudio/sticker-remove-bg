'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
import { useStickerStore } from './sticker-store';
import { useLanguage } from '@/components/language-provider';
import { toast } from '@/hooks/use-toast';
import { ZoomIn, ZoomOut, Maximize2, Crop } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface StickerCanvasProps {
  className?: string;
}

// Apply gaussian blur to alpha channel for anti-aliasing
// Helper to apply threshold to a canvas
function thresholdCanvasAlpha(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;
  for (let i = 0; i < data.length; i += 4) {
    // Threshold alpha at 128 (50%)
    data[i + 3] = data[i + 3] < 128 ? 0 : 255;
  }
  ctx.putImageData(imageData, 0, 0);
}

/**
 * createOutline — CPU port of the high-fidelity outline pipeline:
 * Matches the export logic exactly for perfect parity.
 */
function createOutline(
  ctx: CanvasRenderingContext2D,
  compositeCanvas: HTMLCanvasElement,
  outlineWidth: number,
  outlineColor: string,
  w: number,
  h: number
) {
  if (outlineWidth <= 0) return;

  const hex = outlineColor.replace('#', '');
  const rC = parseInt(hex.substring(0, 2), 16);
  const gC = parseInt(hex.substring(2, 4), 16);
  const bC = parseInt(hex.substring(4, 6), 16);

  // 1. Extract thresholded alpha
  const srcCtx = compositeCanvas.getContext('2d', { willReadFrequently: true })!;
  const pixels = srcCtx.getImageData(0, 0, w, h).data;
  const binary = new Uint8Array(w * h);
  for (let i = 0; i < binary.length; i++) {
    binary[i] = pixels[i * 4 + 3] >= 128 ? 255 : 0;
  }

  // 2. Dilation (Box sweep)
  const dilated = new Uint8Array(w * h);
  {
    const tmp = new Uint8Array(w * h);
    for (let row = 0; row < h; row++) {
      let last = -0x7fffffff;
      for (let col = 0; col < w; col++) {
        if (binary[row * w + col]) last = col;
        if (col - last <= outlineWidth) tmp[row * w + col] = 255;
      }
      last = 0x7fffffff;
      for (let col = w - 1; col >= 0; col--) {
        if (binary[row * w + col]) last = col;
        if (last - col <= outlineWidth) tmp[row * w + col] = 255;
      }
    }
    for (let col = 0; col < w; col++) {
      let last = -0x7fffffff;
      for (let row = 0; row < h; row++) {
        if (tmp[row * w + col]) last = row;
        if (row - last <= outlineWidth) dilated[row * w + col] = 255;
      }
      last = 0x7fffffff;
      for (let row = h - 1; row >= 0; row--) {
        if (tmp[row * w + col]) last = row;
        if (last - row <= outlineWidth) dilated[row * w + col] = 255;
      }
    }
  }

  // 3. 3x Box Blur ≈ Gaussian
  const blurRad = Math.max(1, Math.round(outlineWidth * 0.35 * 1.73));
  function boxBlur(src: Uint8Array): Uint8Array {
    const hPass = new Float32Array(w * h);
    const norm = 2 * blurRad + 1;
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

  // 4. Smooth Edge Formula (Matches SVG 20 -10)
  const outCanvas = document.createElement('canvas');
  outCanvas.width = w;
  outCanvas.height = h;
  const outCtx = outCanvas.getContext('2d')!;
  const outlineData = outCtx.createImageData(w, h);

  for (let i = 0; i < blurred.length; i++) {
    const a = Math.round(Math.min(1, Math.max(0, 20 * (blurred[i] / 255) - 10)) * 255);
    if (a > 0) {
      const px = i * 4;
      outlineData.data[px] = rC;
      outlineData.data[px + 1] = gC;
      outlineData.data[px + 2] = bC;
      outlineData.data[px + 3] = a;
    }
  }
  outCtx.putImageData(outlineData, 0, 0);
  ctx.drawImage(outCanvas, 0, 0);
}

export function StickerCanvas({ className }: StickerCanvasProps) {
  const { t } = useLanguage();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const hasFittedOnceRef = useRef(false);
  const didJustDragRef = useRef(false);

  const {
    processedImage,
    originalImage,
    outlineWidth,
    setOutlineWidth,
    outlineColor,
    padding,
    setPadding,
    zoom,
    setZoom,
    isProcessing,
    setIsProcessing,
    imageWidth,
    imageHeight,
    setImageDimensions,
    triggerFitCounter,
    activeTool,
    setActiveTool,
    manualFillMask,
    setManualFillMask,
    transparencyMask,
    setTransparencyMask,
    setTransparencyMaskOnly,
    commitTransparencyHistory,
    brushSize,
    undo,
    redo,
    undoErase,
    redoErase,
  } = useStickerStore();

  const [fillMaskImg, setFillMaskImg] = useState<HTMLImageElement | null>(null);
  const [transparencyImg, setTransparencyImg] = useState<HTMLImageElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState<{ x: number, y: number } | null>(null);
  const [dragCurrent, setDragCurrent] = useState<{ x: number, y: number } | null>(null);
  const lastPosRef = useRef<{ x: number, y: number } | null>(null);
  const brushCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [mousePos, setMousePos] = useState<{ x: number, y: number } | null>(null);
  const [marginDragState, setMarginDragState] = useState<{ edge: 'top' | 'right' | 'bottom' | 'left' | null; startVal: number; startPos: number }>({ edge: null, startVal: 0, startPos: 0 });

  // Undo/Redo shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault();
        if (e.shiftKey) {
          if (activeTool === 'erase' || activeTool === 'brush_erase') redoErase();
          else redo();
        } else {
          if (activeTool === 'erase' || activeTool === 'brush_erase') undoErase();
          else undo();
        }
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'y') {
        e.preventDefault();
        if (activeTool === 'erase' || activeTool === 'brush_erase') redoErase();
        else redo();
      }
      if (e.key === 'Escape') {
        setActiveTool('none');
      }

      // Keyboard shortcuts for adjustment
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setZoom(zoom + 0.1);
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setZoom(zoom - 0.1);
      }
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        setOutlineWidth(outlineWidth + 1);
      }
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        setOutlineWidth(Math.max(0, outlineWidth - 1));
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [undo, redo, undoErase, redoErase, activeTool, zoom, setZoom, outlineWidth, setOutlineWidth, setActiveTool]);

  // Handle Margin Dragging
  useEffect(() => {
    if (!marginDragState.edge) return;
    const handleMouseMove = (e: MouseEvent) => {
      const { edge, startVal, startPos } = marginDragState;
      const currentPos = edge === 'left' || edge === 'right' ? e.clientX : e.clientY;
      const diff = (currentPos - startPos) / zoom;

      let newPadding = { ...padding };
      // Move left boundary: moving right (currentPos > startPos) decreases padding.
      if (edge === 'left') newPadding.left = Math.round(startVal - diff);
      // Move right boundary: moving right (currentPos > startPos) increases padding.
      if (edge === 'right') newPadding.right = Math.round(startVal + diff);
      // Move top boundary: moving down (currentPos > startPos) decreases padding.
      if (edge === 'top') newPadding.top = Math.round(startVal - diff);
      // Move bottom boundary: moving down (currentPos > startPos) increases padding.
      if (edge === 'bottom') newPadding.bottom = Math.round(startVal + diff);

      setPadding(newPadding);
    };
    const handleMouseUp = () => setMarginDragState({ edge: null, startVal: 0, startPos: 0 });

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [marginDragState, padding, setPadding, zoom]);

  // Load fill mask image when it changes
  useEffect(() => {
    if (!manualFillMask) {
      setFillMaskImg(null);
      return;
    }
    const img = new Image();
    img.src = manualFillMask;
    img.onload = () => setFillMaskImg(img);
  }, [manualFillMask]);

  // Load transparency mask image when it changes
  useEffect(() => {
    if (!transparencyMask) {
      setTransparencyImg(null);
      return;
    }
    const img = new Image();
    img.src = transparencyMask;
    img.onload = () => setTransparencyImg(img);
  }, [transparencyMask]);

  const drawImage = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d', { willReadFrequently: true });
    const img = imageRef.current;

    if (!canvas || !ctx || !img) return;

    // Calculate crop offsets (for negative padding)
    const cropLeft = Math.max(0, -padding.left);
    const cropTop = Math.max(0, -padding.top);
    const cropRight = Math.max(0, -padding.right);
    const cropBottom = Math.max(0, -padding.bottom);

    const srcX = cropLeft;
    const srcY = cropTop;
    const srcWidth = img.naturalWidth - cropLeft - cropRight;
    const srcHeight = img.naturalHeight - cropTop - cropBottom;

    const finalSrcWidth = Math.max(1, srcWidth);
    const finalSrcHeight = Math.max(1, srcHeight);

    const extraLeft = Math.max(0, padding.left);
    const extraTop = Math.max(0, padding.top);
    const extraRight = Math.max(0, padding.right);
    const extraBottom = Math.max(0, padding.bottom);

    const totalPaddingH = extraLeft + extraRight;
    const totalPaddingV = extraTop + extraBottom;
    const dpr = window.devicePixelRatio || 1;
    const outlineSpace = outlineWidth * 2;

    const logicalWidth = finalSrcWidth + totalPaddingH + outlineSpace;
    const logicalHeight = finalSrcHeight + totalPaddingV + outlineSpace;

    canvas.width = logicalWidth * dpr;
    canvas.height = logicalHeight * dpr;
    ctx.scale(dpr, dpr);

    ctx.clearRect(0, 0, logicalWidth, logicalHeight);

    const drawX = extraLeft + outlineWidth;
    const drawY = extraTop + outlineWidth;

    const croppedCanvas = document.createElement('canvas');
    croppedCanvas.width = finalSrcWidth;
    croppedCanvas.height = finalSrcHeight;
    const croppedCtx = croppedCanvas.getContext('2d')!;
    croppedCtx.drawImage(img, srcX, srcY, finalSrcWidth, finalSrcHeight, 0, 0, finalSrcWidth, finalSrcHeight);

    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = logicalWidth;
    tempCanvas.height = logicalHeight;
    const tempCtx = tempCanvas.getContext('2d', { willReadFrequently: true })!;

    if (fillMaskImg) {
      const colorCanvas = document.createElement('canvas');
      colorCanvas.width = logicalWidth;
      colorCanvas.height = logicalHeight;
      const cCtx = colorCanvas.getContext('2d')!;
      cCtx.fillStyle = outlineColor;
      cCtx.fillRect(0, 0, logicalWidth, logicalHeight);
      cCtx.globalCompositeOperation = 'destination-in';
      cCtx.drawImage(fillMaskImg, 0, 0, logicalWidth, logicalHeight);
      tempCtx.drawImage(colorCanvas, 0, 0);
    }

    const pngCanvas = document.createElement('canvas');
    pngCanvas.width = logicalWidth;
    pngCanvas.height = logicalHeight;
    const pngCtx = pngCanvas.getContext('2d')!;
    pngCtx.drawImage(croppedCanvas, drawX, drawY);

    if (transparencyImg) {
      pngCtx.save();
      pngCtx.globalCompositeOperation = 'destination-out';
      pngCtx.drawImage(transparencyImg, 0, 0, logicalWidth, logicalHeight);
      pngCtx.restore();
    }

    tempCtx.drawImage(pngCanvas, 0, 0);

    if (outlineWidth > 0) {
      createOutline(ctx, tempCanvas, outlineWidth, outlineColor, logicalWidth, logicalHeight);
    }
    ctx.drawImage(tempCanvas, 0, 0);
  }, [outlineWidth, outlineColor, padding, fillMaskImg, transparencyImg]);

  // Fit image to screen helper
  const fitToScreen = useCallback(() => {
    if (!containerRef.current || !imageRef.current) return;

    const container = containerRef.current;
    const containerWidth = container.clientWidth;
    const containerHeight = container.clientHeight;

    if (containerWidth === 0 || containerHeight === 0) return;

    const img = imageRef.current;

    const cropLeft = Math.max(0, -padding.left);
    const cropTop = Math.max(0, -padding.top);
    const cropRight = Math.max(0, -padding.right);
    const cropBottom = Math.max(0, -padding.bottom);

    const srcWidth = img.naturalWidth - cropLeft - cropRight;
    const srcHeight = img.naturalHeight - cropTop - cropBottom;

    const extraLeft = Math.max(0, padding.left);
    const extraTop = Math.max(0, padding.top);
    const extraRight = Math.max(0, padding.right);
    const extraBottom = Math.max(0, padding.bottom);

    const totalPaddingH = extraLeft + extraRight;
    const totalPaddingV = extraTop + extraBottom;
    const outlineSpace = outlineWidth * 2;

    const totalWidth = Math.max(1, srcWidth) + totalPaddingH + outlineSpace;
    const totalHeight = Math.max(1, srcHeight) + totalPaddingV + outlineSpace;

    const marginSpace = 32;
    const scaleX = (containerWidth - marginSpace) / totalWidth;
    const scaleY = (containerHeight - marginSpace) / totalHeight;

    let newZoom = Math.min(scaleX, scaleY);
    if (newZoom > 1) newZoom = 1;

    setZoom(Math.max(0.1, Math.round(newZoom * 100) / 100));
  }, [padding, outlineWidth, setZoom]);

  // Load image when it changes
  useEffect(() => {
    const image = processedImage || originalImage;
    if (!image) {
      imageRef.current = null;
      hasFittedOnceRef.current = false;
      return;
    }

    const img = new Image();
    img.onload = () => {
      imageRef.current = img;
      setImageDimensions(img.naturalWidth, img.naturalHeight);
      setIsProcessing(false);

      if (!hasFittedOnceRef.current) {
        hasFittedOnceRef.current = true;
        const tryFit = () => {
          const container = containerRef.current;
          if (container && container.clientWidth > 0 && container.clientHeight > 0) {
            fitToScreen();
          } else {
            setTimeout(tryFit, 50);
          }
        };
        setTimeout(tryFit, 50);
      }

      setTimeout(drawImage, 0);
    };
    img.src = image;
  }, [processedImage, originalImage, setImageDimensions, setIsProcessing, drawImage, fitToScreen]);

  // Redraw when settings change
  useEffect(() => {
    if (imageRef.current) {
      drawImage();
    }
  }, [drawImage, padding, outlineWidth]);

  // Explicit trigger for "Fit to Screen" button
  useEffect(() => {
    if (triggerFitCounter > 0) {
      fitToScreen();
    }
  }, [triggerFitCounter, fitToScreen]);

  const handleZoomIn = () => setZoom(zoom + 0.1);
  const handleZoomOut = () => setZoom(zoom - 0.1);

  // Helper to get clamped canvas coordinates from screen coordinates
  const getClampedCoords = useCallback((clientX: number, clientY: number) => {
    if (!canvasRef.current) return { x: 0, y: 0 };
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    const x = Math.round((clientX - rect.left) * scaleX);
    const y = Math.round((clientY - rect.top) * scaleY);

    return {
      x: Math.max(0, Math.min(canvas.width, x)),
      y: Math.max(0, Math.min(canvas.height, y))
    };
  }, []);

  // Zoom on Ctrl+MouseWheel
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const state = useStickerStore.getState();
        const currentZoom = state.zoom;
        const delta = e.deltaY < 0 ? 0.1 : -0.1;
        state.setZoom(Math.max(0.1, Math.min(5, currentZoom + delta)));
      }
    };

    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => container.removeEventListener('wheel', handleWheel);
  }, []);

  const handleMouseDown = (e: React.MouseEvent) => {
    if (activeTool === 'none' || !canvasRef.current) return;

    const coords = getClampedCoords(e.clientX, e.clientY);
    setIsDragging(true);
    setDragStart(coords);
    setDragCurrent(coords);
    lastPosRef.current = coords;

    if (activeTool === 'brush_erase') {
      const canvas = canvasRef.current;
      const offCanvas = document.createElement('canvas');
      offCanvas.width = canvas.width;
      offCanvas.height = canvas.height;
      const bCtx = offCanvas.getContext('2d')!;
      if (transparencyImg) {
        bCtx.drawImage(transparencyImg, 0, 0);
      }

      // Initial point
      bCtx.lineJoin = 'round';
      bCtx.lineCap = 'round';
      bCtx.lineWidth = brushSize;
      bCtx.strokeStyle = 'black';
      bCtx.beginPath();
      bCtx.moveTo(coords.x, coords.y);
      bCtx.lineTo(coords.x, coords.y);
      bCtx.stroke();

      brushCanvasRef.current = offCanvas;
      setTransparencyMask(offCanvas.toDataURL());
    }

    e.preventDefault();
  };

  useEffect(() => {
    if (!isDragging) return;

    const handleGlobalMouseMove = (e: MouseEvent) => {
      const coords = getClampedCoords(e.clientX, e.clientY);
      setDragCurrent(coords);
      setMousePos({ x: e.clientX, y: e.clientY });

      if (activeTool === 'brush_erase' && brushCanvasRef.current) {
        const bCtx = brushCanvasRef.current.getContext('2d')!;
        bCtx.lineJoin = 'round';
        bCtx.lineCap = 'round';
        bCtx.lineWidth = brushSize;
        bCtx.strokeStyle = 'black';

        const last = lastPosRef.current || coords;
        bCtx.beginPath();
        bCtx.moveTo(last.x, last.y);
        bCtx.lineTo(coords.x, coords.y);
        bCtx.stroke();

        lastPosRef.current = coords;
        setTransparencyMaskOnly(brushCanvasRef.current.toDataURL());
      }
    };

    const handleGlobalMouseUp = () => {
      if (!dragStart || !dragCurrent || !canvasRef.current) {
        setIsDragging(false);
        lastPosRef.current = null;
        return;
      }

      const canvas = canvasRef.current;

      if (activeTool === 'fill' || activeTool === 'erase') {
        const x1 = Math.min(dragStart.x, dragCurrent.x);
        const y1 = Math.min(dragStart.y, dragCurrent.y);
        const x2 = Math.max(dragStart.x, dragCurrent.x);
        const y2 = Math.max(dragStart.y, dragCurrent.y);
        const width = x2 - x1;
        const height = y2 - y1;

        if (width > 4 && height > 4) {
          const fillCanvas = document.createElement('canvas');
          fillCanvas.width = canvas.width;
          fillCanvas.height = canvas.height;
          const fCtx = fillCanvas.getContext('2d')!;

          const currentImg = activeTool === 'erase' ? transparencyImg : fillMaskImg;
          if (currentImg) fCtx.drawImage(currentImg, 0, 0);

          fCtx.fillStyle = 'black';
          fCtx.fillRect(x1, y1, width, height);

          if (activeTool === 'erase') {
            setTransparencyMask(fillCanvas.toDataURL());
          } else {
            setManualFillMask(fillCanvas.toDataURL());
          }
          toast({ title: activeTool === 'erase' ? "Área borrada" : "Área rellenada" });
          didJustDragRef.current = true;
        } else {
          didJustDragRef.current = false;
        }
      } else if (activeTool === 'brush_erase') {
        commitTransparencyHistory();
        toast({ title: "Borrado completado" });
        didJustDragRef.current = true;
      }

      setIsDragging(false);
      setDragStart(null);
      setDragCurrent(null);
      lastPosRef.current = null;
      brushCanvasRef.current = null;
    };

    window.addEventListener('mousemove', handleGlobalMouseMove);
    window.addEventListener('mouseup', handleGlobalMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleGlobalMouseMove);
      window.removeEventListener('mouseup', handleGlobalMouseUp);
    };
  }, [isDragging, dragStart, dragCurrent, fillMaskImg, transparencyImg, getClampedCoords, setManualFillMask, setTransparencyMask, setTransparencyMaskOnly, commitTransparencyHistory, activeTool, brushSize]);

  // Track mouse position for the brush preview even when not dragging
  useEffect(() => {
    if (activeTool !== 'brush_erase') {
      setMousePos(null);
      return;
    }

    const handleMouseMove = (e: MouseEvent) => {
      setMousePos({ x: e.clientX, y: e.clientY });
    };

    const handleMouseLeave = () => setMousePos(null);

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseleave', handleMouseLeave);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseleave', handleMouseLeave);
    };
  }, [activeTool]);

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (didJustDragRef.current) {
      didJustDragRef.current = false;
      return;
    }

    if ((activeTool !== 'fill' && activeTool !== 'erase') || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();

    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const x = Math.round((e.clientX - rect.left) * scaleX);
    const y = Math.round((e.clientY - rect.top) * scaleY);

    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    const startPx = ctx.getImageData(x, y, 1, 1).data;
    const [startR, startG, startB, startA] = startPx;

    if (activeTool === 'fill' && startA > 30) return;
    if (activeTool === 'erase' && startA <= 30) return;

    const width = canvas.width;
    const height = canvas.height;
    const imageData = ctx.getImageData(0, 0, width, height);
    const data = imageData.data;

    // ─── Flood Fill / Erase Logic ──────────────────────────────────────────
    // Since the outline is now drawn directly on the canvas, we can use the 
    // actual alpha values (data[i*4 + 3]) as the boundaries.
    const wallThreshold = 30; // Alpha > 30 is considered a wall/content

    const fillCanvas = document.createElement('canvas');
    fillCanvas.width = width;
    fillCanvas.height = height;
    const fCtx = fillCanvas.getContext('2d')!;

    const currentImg = activeTool === 'erase' ? transparencyImg : fillMaskImg;
    if (currentImg) fCtx.drawImage(currentImg, 0, 0);

    const fData = fCtx.getImageData(0, 0, width, height);
    const fPixels = fData.data;
    const stack: [number, number][] = [[x, y]];
    const visited = new Uint8Array(width * height);
    const tolerance = 48;

    while (stack.length > 0) {
      const [currX, currY] = stack.pop()!;
      if (currX < 0 || currX >= width || currY < 0 || currY >= height) continue;
      const idx = currY * width + currX;
      if (visited[idx]) continue;
      visited[idx] = 1;

      let isMatch = false;
      if (activeTool === 'fill') {
        // Wall = any pixel with alpha > wallThreshold (includes image + outline)
        isMatch = data[idx * 4 + 3] <= wallThreshold;
      } else {
        const pxIdx = idx * 4;
        const r = data[pxIdx], g = data[pxIdx + 1], b = data[pxIdx + 2], a = data[pxIdx + 3];
        const dist = Math.sqrt(
          Math.pow(r - startR, 2) + Math.pow(g - startG, 2) + Math.pow(b - startB, 2)
        );
        isMatch = a > wallThreshold && dist < tolerance;
      }

      if (isMatch) {
        const pxIdx = idx * 4;
        fPixels[pxIdx + 3] = 255;
        stack.push([currX - 1, currY]); stack.push([currX + 1, currY]);
        stack.push([currX, currY - 1]); stack.push([currX, currY + 1]);
      }
    }

    fCtx.putImageData(fData, 0, 0);
    if (activeTool === 'erase') {
      setTransparencyMask(fillCanvas.toDataURL());
      toast({ title: "Color borrado" });
    } else {
      setManualFillMask(fillCanvas.toDataURL());
      toast({ title: "Hueco rellenado" });
    }
  };


  if (!originalImage) return null;

  // Calculate sizes for React style to prevent stretching
  const cropLeft = Math.max(0, -padding.left);
  const cropTop = Math.max(0, -padding.top);
  const cropRight = Math.max(0, -padding.right);
  const cropBottom = Math.max(0, -padding.bottom);

  const actualImgWidth = Math.max(0, imageWidth - cropLeft - cropRight);
  const actualImgHeight = Math.max(0, imageHeight - cropTop - cropBottom);

  const extraH = Math.max(0, padding.left) + Math.max(0, padding.right);
  const extraV = Math.max(0, padding.top) + Math.max(0, padding.bottom);

  const canvasDisplayWidth = (actualImgWidth + extraH + outlineWidth * 2) * zoom;
  const canvasDisplayHeight = (actualImgHeight + extraV + outlineWidth * 2) * zoom;

  return (
    <div className={cn("flex-1 w-full min-h-0 relative overflow-auto custom-scrollbar", className)}>
      <div
        ref={containerRef}
        onMouseDown={handleMouseDown}
        className="min-w-full min-h-full flex items-center justify-center p-2 sm:p-4"
      >
        {/* Background wrapper — checkerboard when no outline, solid theme color when outline is active */}
        <div
          className="relative rounded-sm shadow-2xl"
          style={{
            width: canvasDisplayWidth > 0 ? `${canvasDisplayWidth}px` : 'auto',
            height: canvasDisplayHeight > 0 ? `${canvasDisplayHeight}px` : 'auto',
            ...(outlineWidth > 0
              ? {
                // Solid background matching the app's dark theme
                backgroundColor: 'hsl(var(--background))',
                outline: '1px dashed hsl(var(--border))',
                outlineOffset: '2px',
              }
              : {
                // Checkerboard for transparency preview (no outline)
                backgroundColor: '#e0e0e0',
                backgroundImage: `linear-gradient(45deg, #f0f0f0 25%, transparent 25%),
                                   linear-gradient(-45deg, #f0f0f0 25%, transparent 25%),
                                   linear-gradient(45deg, transparent 75%, #f0f0f0 75%),
                                   linear-gradient(-45deg, transparent 75%, #f0f0f0 75%)`,
                backgroundSize: '20px 20px',
                backgroundPosition: '0 0, 0 10px, 10px -10px, -10px 0px',
              }),
          }}
        >
          {/* Canvas is transparent itself; we draw original + fills + high-fidelity outline directly onto it */}
          <canvas
            ref={canvasRef}
            onClick={handleCanvasClick}
            className={cn(
              "absolute inset-0",
              activeTool === 'brush_erase' ? "cursor-none" :
                (activeTool === 'fill' || activeTool === 'erase') ? "cursor-crosshair" : "cursor-default"
            )}
            style={{
              width: '100%',
              height: '100%',
              maxWidth: 'none',
              display: 'block',
              background: 'transparent',
            }}
          />
          {isDragging && dragStart && dragCurrent && activeTool !== 'brush_erase' && (
            <div
              className="absolute bg-indigo-500/40 ring-1 ring-indigo-600 shadow-[0_0_0_1px_rgba(255,255,255,0.5)] pointer-events-none"
              style={{
                left: Math.min(dragStart.x, dragCurrent.x) / (canvasRef.current?.width || 1) * 100 + '%',
                top: Math.min(dragStart.y, dragCurrent.y) / (canvasRef.current?.height || 1) * 100 + '%',
                width: Math.abs(dragCurrent.x - dragStart.x) / (canvasRef.current?.width || 1) * 100 + '%',
                height: Math.abs(dragCurrent.y - dragStart.y) / (canvasRef.current?.height || 1) * 100 + '%',
                boxSizing: 'border-box'
              }}
            />
          )}

          {/* Brush Preview Circle */}
          {activeTool === 'brush_erase' && mousePos && (
            <div
              className="fixed pointer-events-none border border-white/50 bg-white/20 rounded-full z-[100] shadow-[0_0_0_1px_rgba(0,0,0,0.3)]"
              style={{
                left: mousePos.x,
                top: mousePos.y,
                width: brushSize * zoom,
                height: brushSize * zoom,
                transform: 'translate(-50%, -50%)',
              }}
            />
          )}
          {isProcessing && (
            <div className="absolute inset-0 bg-background/60 backdrop-blur-sm flex items-center justify-center rounded-sm">
              <div className="flex flex-col items-center gap-2">
                <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
                <span className="text-xs font-medium text-primary animate-pulse">
                  {t('upload.processing')}
                </span>
              </div>
            </div>
          )}

          {/* Margin draggable edges */}
          {activeTool === 'adjust_margin' && (
            <>
              <div className="absolute inset-0 border border-blue-500/50 pointer-events-none" />
              {/* TOP */}
              <div
                className="absolute top-0 left-0 right-0 h-4 -mt-2 cursor-ns-resize z-50 flex items-center justify-center group"
                onMouseDown={(e) => { e.stopPropagation(); setMarginDragState({ edge: 'top', startVal: padding.top, startPos: e.clientY }); }}
              >
                <div className="w-12 h-1.5 bg-blue-500 rounded-full opacity-50 group-hover:opacity-100" />
              </div>
              {/* BOTTOM */}
              <div
                className="absolute bottom-0 left-0 right-0 h-4 -mb-2 cursor-ns-resize z-50 flex items-center justify-center group"
                onMouseDown={(e) => { e.stopPropagation(); setMarginDragState({ edge: 'bottom', startVal: padding.bottom, startPos: e.clientY }); }}
              >
                <div className="w-12 h-1.5 bg-blue-500 rounded-full opacity-50 group-hover:opacity-100" />
              </div>
              {/* LEFT */}
              <div
                className="absolute left-0 top-0 bottom-0 w-4 -ml-2 cursor-ew-resize z-50 flex items-center justify-center group"
                onMouseDown={(e) => { e.stopPropagation(); setMarginDragState({ edge: 'left', startVal: padding.left, startPos: e.clientX }); }}
              >
                <div className="w-1.5 h-12 bg-blue-500 rounded-full opacity-50 group-hover:opacity-100" />
              </div>
              {/* RIGHT */}
              <div
                className="absolute right-0 top-0 bottom-0 w-4 -mr-2 cursor-ew-resize z-50 flex items-center justify-center group"
                onMouseDown={(e) => { e.stopPropagation(); setMarginDragState({ edge: 'right', startVal: padding.right, startPos: e.clientX }); }}
              >
                <div className="w-1.5 h-12 bg-blue-500 rounded-full opacity-50 group-hover:opacity-100" />
              </div>
            </>
          )}

        </div>
      </div>
    </div>
  );
}
