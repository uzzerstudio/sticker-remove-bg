'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
import { useStickerStore } from './sticker-store';
import { useLanguage } from '@/components/language-provider';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { RotateCcw, Move, Eraser } from 'lucide-react';

interface StickerCanvasProps {
  className?: string;
}

const TOUCH_OFFSET_Y = 80; // Pixels to offset the brush upwards on mobile

// createOutline — CPU port of the high-fidelity outline pipeline:
// Matches the export logic exactly for perfect parity.
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

  // 1. Extract thresholded alpha
  const srcCtx = compositeCanvas.getContext('2d', { willReadFrequently: true })!;
  const pixels = srcCtx.getImageData(0, 0, w, h).data;
  const binary = new Uint8Array(w * h);
  for (let i = 0; i < binary.length; i++) {
    const isOpaque = pixels[i * 4 + 3] >= 128;
    binary[i] = isInner ? (isOpaque ? 0 : 255) : (isOpaque ? 255 : 0);
  }

  // 2. Dilation (Box sweep)
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

  // 3. 3x Box Blur ≈ Gaussian
  const blurRad = Math.max(1, Math.round(absWidth * 0.35 * 1.73));
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
    const final = new Uint8Array(w * h);
    for (let col = 0; col < w; col++) {
      let sum = 0;
      for (let y = -blurRad; y <= blurRad; y++) sum += (y >= 0 && y < h) ? hPass[y * w + col] : 0;
      final[0 * w + col] = Math.round(sum / norm);
      for (let row = 1; row < h; row++) {
        const addY = row + blurRad; if (addY < h) sum += hPass[addY * w + col];
        const remY = row - blurRad - 1; if (remY >= 0) sum -= hPass[remY * w + col];
        final[row * w + col] = Math.round(sum / norm);
      }
    }
    return final;
  }

  const b1 = boxBlur(dilated);
  const b2 = boxBlur(b1);
  const b3 = boxBlur(b2);

  // 4. Compose and mask
  const outCanvas = document.createElement('canvas');
  outCanvas.width = w;
  outCanvas.height = h;
  const outCtx = outCanvas.getContext('2d')!;
  const outlineData = outCtx.createImageData(w, h);
  const outBinary = outlineData.data;

  for (let i = 0; i < w * h; i++) {
    const alpha = b3[i];
    // Threshold with feColorMatrix(20 -10) equivalent to harden the edges
    const a = Math.round(Math.min(1, Math.max(0, 20 * (alpha / 255) - 10)) * 255);
    if (a <= 0) continue;

    // For inner outlines (dilation of outside), only draw where it was originally transparent
    if (isInner && pixels[i * 4 + 3] < 128) continue;

    const idx = i * 4;
    outBinary[idx] = rC;
    outBinary[idx + 1] = gC;
    outBinary[idx + 2] = bC;
    outBinary[idx + 3] = a;
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
  const renderParamsRef = useRef({
    drawX: 0,
    drawY: 0,
    cropLeft: 0,
    cropTop: 0,
    finalSrcWidth: 0,
    finalSrcHeight: 0,
    logicalWidth: 0,
    logicalHeight: 0,
    dpr: 1
  });

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
    undoImage,
    redoImage,
    setBrushSize,
    processedImageHistory,
    processedImageIndex,
    manualFillHistory,
    manualFillIndex,
    transparencyHistory,
    transparencyIndex,
  } = useStickerStore();

  const canUndo = transparencyIndex > 0 || manualFillIndex > 0 || processedImageIndex > 0;
  const canRedo = transparencyIndex < transparencyHistory.length - 1 ||
    manualFillIndex < manualFillHistory.length - 1 ||
    processedImageIndex < processedImageHistory.length - 1;

  const [isMobile, setIsMobile] = useState(false);
  const [fillMaskImg, setFillMaskImg] = useState<HTMLImageElement | null>(null);

  // Detect mobile view
  useEffect(() => {
    setIsMobile(window.innerWidth < 768);
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);
  const [transparencyImg, setTransparencyImg] = useState<HTMLImageElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState<{ x: number, y: number } | null>(null);
  const [dragCurrent, setDragCurrent] = useState<{ x: number, y: number } | null>(null);
  const lastPosRef = useRef<{ x: number, y: number } | null>(null);
  const brushCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [mousePos, setMousePos] = useState<{ x: number, y: number } | null>(null);
  const [marginDragState, setMarginDragState] = useState<{ edge: 'top' | 'right' | 'bottom' | 'left' | null; startVal: number; startPos: number }>({ edge: null, startVal: 0, startPos: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const panStartRef = useRef<{ x: number, y: number } | null>(null);
  const scrollStartRef = useRef<{ left: number, top: number } | null>(null);

  // Mobile Pinch-to-Zoom refs
  const touchDistStartRef = useRef<number | null>(null);
  const touchZoomStartRef = useRef<number | null>(null);
  const touchFocalPointRef = useRef<{ x: number; y: number } | null>(null);
  const touchScreenMidpointRef = useRef<{ x: number; y: number } | null>(null);

  // Source tracking to ignore synthetic mouse events on mobile
  const dragSourceRef = useRef<'mouse' | 'touch' | null>(null);
  const lastTouchTimeRef = useRef(0);

  // Precision Brush Refs
  const handleStartRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const initialPosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  // Stores brush position in CANVAS coordinates so panning doesn't lose it
  const brushCanvasPosRef = useRef<{ x: number; y: number } | null>(null);
  // Ref to the controls panel for imperative position updates (avoids React render lag)
  const controlsPanelRef = useRef<HTMLDivElement | null>(null);
  const brushSizeForControls = useRef(brushSize);
  brushSizeForControls.current = brushSize;
  const zoomForControls = useRef(zoom);
  zoomForControls.current = zoom;

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

  // Convert canvas pixel coordinates back to screen (viewport) coordinates
  const canvasToScreen = useCallback((cx: number, cy: number) => {
    if (!canvasRef.current) return { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    const rect = canvasRef.current.getBoundingClientRect();
    const canvas = canvasRef.current;
    return {
      x: rect.left + (cx / canvas.width) * rect.width,
      y: rect.top + (cy / canvas.height) * rect.height,
    };
  }, []);

  // Replaces the middle-click block with a global context menu block when panning
  useEffect(() => {
    const handleContextMenuCapture = (e: MouseEvent) => {
      // If panning is active or if we are clicking inside the container, block it
      if (isPanning || (containerRef.current && containerRef.current.contains(e.target as Node))) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    // Use capture to stop it before the browser triggers the menu
    window.addEventListener('contextmenu', handleContextMenuCapture, { capture: true });
    return () => window.removeEventListener('contextmenu', handleContextMenuCapture, { capture: true });
  }, [isPanning]);

  // Undo/Redo shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault();
        if (e.shiftKey) {
          if (activeTool === 'erase' || activeTool === 'brush_erase') redoErase();
          else if (activeTool === 'fill') redo();
          else redoImage();
        } else {
          if (activeTool === 'erase' || activeTool === 'brush_erase') undoErase();
          else if (activeTool === 'fill') undo();
          else undoImage();
        }
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'y') {
        e.preventDefault();
        if (activeTool === 'erase' || activeTool === 'brush_erase') redoErase();
        else if (activeTool === 'fill') redo();
        else redoImage();
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
  }, [undo, redo, undoErase, redoErase, undoImage, redoImage, activeTool, zoom, setZoom, outlineWidth, setOutlineWidth, setActiveTool]);

  // Shared Brush Stroke Logic
  const startBrushStroke = useCallback((clientX: number, clientY: number) => {
    const coords = getClampedCoords(clientX, clientY);
    const img = imageRef.current;
    if (!img) return;
    const { drawX, drawY, cropLeft, cropTop, dpr } = renderParamsRef.current;

    const offCanvas = document.createElement('canvas');
    offCanvas.width = img.naturalWidth;
    offCanvas.height = img.naturalHeight;
    const bCtx = offCanvas.getContext('2d')!;
    if (transparencyImg) bCtx.drawImage(transparencyImg, 0, 0);

    const localX = (coords.x / dpr) - drawX + cropLeft;
    const localY = (coords.y / dpr) - drawY + cropTop;

    bCtx.lineJoin = 'round';
    bCtx.lineCap = 'round';
    bCtx.lineWidth = brushSize;
    bCtx.strokeStyle = 'black';
    bCtx.beginPath();
    bCtx.moveTo(localX, localY);
    bCtx.lineTo(localX, localY);
    bCtx.stroke();

    brushCanvasRef.current = offCanvas;
    lastPosRef.current = coords;
    setTransparencyMaskOnly(offCanvas.toDataURL());
  }, [brushSize, getClampedCoords, transparencyImg, setTransparencyMaskOnly]);

  const continueBrushStroke = useCallback((clientX: number, clientY: number) => {
    if (!brushCanvasRef.current) return;
    const coords = getClampedCoords(clientX, clientY);
    const { drawX, drawY, cropLeft, cropTop, dpr } = renderParamsRef.current;
    const bCtx = brushCanvasRef.current.getContext('2d')!;

    bCtx.lineJoin = 'round';
    bCtx.lineCap = 'round';
    bCtx.lineWidth = brushSize;
    bCtx.strokeStyle = 'black';

    const last = lastPosRef.current || coords;
    const lastLocalX = (last.x / dpr) - drawX + cropLeft;
    const lastLocalY = (last.y / dpr) - drawY + cropTop;
    const currentLocalX = (coords.x / dpr) - drawX + cropLeft;
    const currentLocalY = (coords.y / dpr) - drawY + cropTop;

    bCtx.beginPath();
    bCtx.moveTo(lastLocalX, lastLocalY);
    bCtx.lineTo(currentLocalX, currentLocalY);
    bCtx.stroke();

    lastPosRef.current = coords;
    setTransparencyMaskOnly(brushCanvasRef.current.toDataURL());
  }, [brushSize, getClampedCoords, setTransparencyMaskOnly]);

  // Center the brush cursor every time the tool is activated on mobile
  useEffect(() => {
    if (activeTool === 'brush_erase' && isMobile) {
      const initX = window.innerWidth / 2;
      const initY = (window.innerHeight / 2) - 50;
      setMousePos({ x: initX, y: initY });
      // Also init canvas position so panning stays consistent
      setTimeout(() => {
        const coords = getClampedCoords(initX, initY);
        brushCanvasPosRef.current = coords;
      }, 0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTool, isMobile]); // Only re-run when tool or device type changes, not on every mousePos update

  // When user scrolls the canvas, update mousePos from the stored canvas-space position
  // so the brush mira stays at the same canvas location after panning
  useEffect(() => {
    if (!isMobile || activeTool !== 'brush_erase') return;
    const scrollContainer = containerRef.current?.parentElement;
    if (!scrollContainer) return;

    const handleScroll = () => {
      if (brushCanvasPosRef.current) {
        const sp = canvasToScreen(brushCanvasPosRef.current.x, brushCanvasPosRef.current.y);
        setMousePos(sp);
      }
    };

    scrollContainer.addEventListener('scroll', handleScroll, { passive: true });
    return () => scrollContainer.removeEventListener('scroll', handleScroll);
  }, [isMobile, activeTool, canvasToScreen]);

  // Handle Margin Dragging
  useEffect(() => {
    if (!marginDragState.edge) return;

    // Set global cursor and disable selection to prevent browser drag/selection icons
    const originalSelect = document.body.style.userSelect;
    const originalCursor = document.body.style.cursor;
    document.body.style.userSelect = 'none';
    if (marginDragState.edge === 'top' || marginDragState.edge === 'bottom') {
      document.body.style.cursor = 'ns-resize';
    } else {
      document.body.style.cursor = 'ew-resize';
    }

    const handleMove = (e: MouseEvent | TouchEvent) => {
      const isTouch = 'touches' in e;
      const clientX = isTouch ? (e as TouchEvent).touches[0].clientX : (e as MouseEvent).clientX;
      const clientY = isTouch ? (e as TouchEvent).touches[0].clientY : (e as MouseEvent).clientY;

      const { edge, startVal, startPos } = marginDragState;
      const currentPos = edge === 'left' || edge === 'right' ? clientX : clientY;
      const diff = (currentPos - startPos) / zoom;

      if (isTouch) e.preventDefault(); // Stop scrolling

      setPadding((prev) => {
        const newPadding = { ...prev };
        if (edge === 'left') newPadding.left = Math.round(startVal - diff);
        if (edge === 'right') newPadding.right = Math.round(startVal + diff);
        if (edge === 'top') newPadding.top = Math.round(startVal - diff);
        if (edge === 'bottom') newPadding.bottom = Math.round(startVal + diff);
        return newPadding;
      });
    };

    const handleUp = () => setMarginDragState({ edge: null, startVal: 0, startPos: 0 });

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    window.addEventListener('touchmove', handleMove, { passive: false });
    window.addEventListener('touchend', handleUp);

    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
      window.removeEventListener('touchmove', handleMove);
      window.removeEventListener('touchend', handleUp);
      document.body.style.userSelect = originalSelect;
      document.body.style.cursor = originalCursor;
    };
  }, [marginDragState.edge, marginDragState.startVal, marginDragState.startPos, setPadding, zoom]);

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
    const outlineSpace = outlineWidth > 0 ? outlineWidth * 2 : 0;

    const logicalWidth = finalSrcWidth + totalPaddingH + outlineSpace;
    const logicalHeight = finalSrcHeight + totalPaddingV + outlineSpace;

    canvas.width = logicalWidth * dpr;
    canvas.height = logicalHeight * dpr;
    ctx.scale(dpr, dpr);

    ctx.clearRect(0, 0, logicalWidth, logicalHeight);

    const drawX = extraLeft + (outlineWidth > 0 ? outlineWidth : 0);
    const drawY = extraTop + (outlineWidth > 0 ? outlineWidth : 0);

    // Save params for mouse interaction mapping
    renderParamsRef.current = {
      drawX, drawY, cropLeft, cropTop, finalSrcWidth, finalSrcHeight, logicalWidth, logicalHeight, dpr
    };

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
      // Draw mask relative to image position, accounted for cropping
      cCtx.drawImage(fillMaskImg, cropLeft, cropTop, finalSrcWidth, finalSrcHeight, drawX, drawY, finalSrcWidth, finalSrcHeight);
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
      // Draw mask relative to image position, accounted for cropping
      pngCtx.drawImage(transparencyImg, cropLeft, cropTop, finalSrcWidth, finalSrcHeight, drawX, drawY, finalSrcWidth, finalSrcHeight);
      pngCtx.restore();
    }

    tempCtx.drawImage(pngCanvas, 0, 0);

    if (outlineWidth !== 0) {
      if (outlineWidth > 0) {
        // Outer outline is drawn BEFORE the image (UNDER)
        createOutline(ctx, tempCanvas, outlineWidth, outlineColor, logicalWidth, logicalHeight);
        ctx.drawImage(tempCanvas, 0, 0);
      } else {
        // Inner outline is drawn AFTER the image (OVER)
        ctx.drawImage(tempCanvas, 0, 0);
        createOutline(ctx, tempCanvas, outlineWidth, outlineColor, logicalWidth, logicalHeight);
      }
    } else {
      ctx.drawImage(tempCanvas, 0, 0);
    }
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
      } else {
        // Natural wheel scroll (vertical by default, horizontal with shift)
        const scrollContainer = containerRef.current?.parentElement;
        if (scrollContainer) {
          if (e.shiftKey) {
            scrollContainer.scrollLeft += e.deltaY;
            e.preventDefault();
          } else {
            // Browser handles vertical scroll naturally
          }
        }
      }
    };

    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => container.removeEventListener('wheel', handleWheel);
  }, []);

  // Mobile Pinch-to-Zoom Logic
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const getDistance = (touches: TouchList) => {
      const dx = touches[0].clientX - touches[1].clientX;
      const dy = touches[0].clientY - touches[1].clientY;
      return Math.sqrt(dx * dx + dy * dy);
    };

    const getMidpoint = (touches: TouchList) => {
      return {
        x: (touches[0].clientX + touches[1].clientX) / 2,
        y: (touches[0].clientY + touches[1].clientY) / 2,
      };
    };

    const handleTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 1) lastTouchTimeRef.current = Date.now();
      if (e.touches.length === 2) {
        touchDistStartRef.current = getDistance(e.touches);
        const state = useStickerStore.getState();
        touchZoomStartRef.current = state.zoom;

        const midpoint = getMidpoint(e.touches);
        const scrollContainer = containerRef.current?.parentElement;
        if (scrollContainer) {
          const rect = scrollContainer.getBoundingClientRect();
          // Content position relative to the scroll container's top-left
          const contentX = midpoint.x - rect.left + scrollContainer.scrollLeft;
          const contentY = midpoint.y - rect.top + scrollContainer.scrollTop;

          // Store unzoomed content position
          touchFocalPointRef.current = {
            x: contentX / state.zoom,
            y: contentY / state.zoom
          };
          touchScreenMidpointRef.current = midpoint;
        }
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (e.touches.length === 2 && touchDistStartRef.current !== null &&
        touchZoomStartRef.current !== null && touchFocalPointRef.current !== null &&
        touchScreenMidpointRef.current !== null) {

        e.preventDefault(); // Stop page scroll while pinching
        const currentDist = getDistance(e.touches);
        const ratio = currentDist / touchDistStartRef.current;
        const newZoom = Math.max(0.1, Math.min(5, touchZoomStartRef.current * ratio));

        const state = useStickerStore.getState();
        state.setZoom(newZoom);

        // Adjust scroll to keep focal point at the same screen position
        const scrollContainer = containerRef.current?.parentElement;
        if (scrollContainer) {
          const rect = scrollContainer.getBoundingClientRect();
          const focal = touchFocalPointRef.current;
          const mid = touchScreenMidpointRef.current;

          // New scroll position = (focalPoint * newZoom) - (screenPosition - containerTopLeft)
          scrollContainer.scrollLeft = (focal.x * newZoom) - (mid.x - rect.left);
          scrollContainer.scrollTop = (focal.y * newZoom) - (mid.y - rect.top);
        }
      }
    };

    const handleTouchEnd = () => {
      touchDistStartRef.current = null;
      touchZoomStartRef.current = null;
      touchFocalPointRef.current = null;
      touchScreenMidpointRef.current = null;
    };

    container.addEventListener('touchstart', handleTouchStart, { passive: false });
    container.addEventListener('touchmove', handleTouchMove, { passive: false });
    container.addEventListener('touchend', handleTouchEnd);
    container.addEventListener('touchcancel', handleTouchEnd);

    return () => {
      container.removeEventListener('touchstart', handleTouchStart);
      container.removeEventListener('touchmove', handleTouchMove);
      container.removeEventListener('touchend', handleTouchEnd);
      container.removeEventListener('touchcancel', handleTouchEnd);
    };
  }, []);

  const handleMouseDown = (e: React.MouseEvent) => {
    // CRITICAL: Block synthetic mouse events on mobile
    if (dragSourceRef.current === 'touch' || Date.now() - lastTouchTimeRef.current < 500) return;

    // Right click (button 2) for Hand Tool / Panning
    if (e.button === 2) {
      e.preventDefault();
      const scrollContainer = containerRef.current?.parentElement;
      if (scrollContainer) {
        setIsPanning(true);
        dragSourceRef.current = 'mouse';
        panStartRef.current = { x: e.clientX, y: e.clientY };
        scrollStartRef.current = { left: scrollContainer.scrollLeft, top: scrollContainer.scrollTop };
      }
      return;
    }

    if (activeTool === 'none' || !canvasRef.current) return;

    // If activeTool is 'adjust_margin', treat left click as Panning instead of Area selection
    if (activeTool === 'adjust_margin' && e.button === 0) {
      const scrollContainer = containerRef.current?.parentElement;
      if (scrollContainer) {
        setIsPanning(true);
        dragSourceRef.current = 'mouse';
        panStartRef.current = { x: e.clientX, y: e.clientY };
        scrollStartRef.current = { left: scrollContainer.scrollLeft, top: scrollContainer.scrollTop };
      }
      return;
    }

    if (e.button === 0) {
      const coords = getClampedCoords(e.clientX, e.clientY);
      setIsDragging(true);
      dragSourceRef.current = 'mouse';
      setDragStart(coords);
      setDragCurrent(coords);
      lastPosRef.current = coords;

      if (activeTool === 'brush_erase') {
        const img = imageRef.current;
        if (!img) return;
        const { drawX, drawY, cropLeft, cropTop, dpr } = renderParamsRef.current;

        const offCanvas = document.createElement('canvas');
        offCanvas.width = img.naturalWidth;
        offCanvas.height = img.naturalHeight;
        const bCtx = offCanvas.getContext('2d')!;
        if (transparencyImg) {
          bCtx.drawImage(transparencyImg, 0, 0);
        }

        const localX = (coords.x / dpr) - drawX + cropLeft;
        const localY = (coords.y / dpr) - drawY + cropTop;

        bCtx.lineJoin = 'round';
        bCtx.lineCap = 'round';
        bCtx.lineWidth = brushSize;
        bCtx.strokeStyle = 'black';
        bCtx.beginPath();
        bCtx.moveTo(localX, localY);
        bCtx.lineTo(localX, localY);
        bCtx.stroke();

        brushCanvasRef.current = offCanvas;
        setTransparencyMask(offCanvas.toDataURL());
      }
      e.preventDefault();
    }
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    lastTouchTimeRef.current = Date.now();
    if (activeTool === 'none' || !canvasRef.current || e.touches.length !== 1) return;

    const touch = e.touches[0];
    const clientX = touch.clientX;
    const clientY = isMobile && activeTool === 'brush_erase' ? touch.clientY - TOUCH_OFFSET_Y : touch.clientY;

    // If activeTool is 'adjust_margin', treat single touch as Panning instead of Area selection
    // On mobile with brush_erase, touching the canvas is ONLY for panning (not erasing) — use the Erase Handle
    if (activeTool === 'adjust_margin' || (isMobile && activeTool === 'brush_erase')) {
      const scrollContainer = containerRef.current?.parentElement;
      if (scrollContainer) {
        setIsPanning(true);
        dragSourceRef.current = 'touch';
        panStartRef.current = { x: touch.clientX, y: touch.clientY };
        scrollStartRef.current = { left: scrollContainer.scrollLeft, top: scrollContainer.scrollTop };
      }
      return;
    }

    const coords = getClampedCoords(clientX, clientY);
    setIsDragging(true);
    dragSourceRef.current = 'touch';
    setDragStart(coords);
    setDragCurrent(coords);
    lastPosRef.current = coords;

    // Update visual mouse pos for the brush indicator
    setMousePos({ x: clientX, y: clientY });

    if (activeTool === 'brush_erase') {
      startBrushStroke(clientX, clientY);
    }
    // Prevent scrolling and synthetic mouse events
    e.preventDefault();
  };

  useEffect(() => {
    if (!isDragging && !isPanning) return;

    const handleGlobalMouseMove = (e: MouseEvent | TouchEvent) => {
      const isTouch = 'touches' in e;
      if (isTouch) lastTouchTimeRef.current = Date.now();

      // CRITICAL: Ignore synthetic mouse events on mobile
      if (!isTouch && (dragSourceRef.current === 'touch' || Date.now() - lastTouchTimeRef.current < 500)) return;
      if (isTouch && dragSourceRef.current === 'mouse') return;

      let clientX, clientY;
      if (isTouch) {
        const touch = (e as TouchEvent).touches[0];
        if (!touch) return;
        clientX = touch.clientX;
        clientY = touch.clientY;
        // Apply offset ONLY when drawing (not when panning) and only on mobile
        if (dragSourceRef.current === 'touch' && activeTool === 'brush_erase' && !isPanning) {
          clientY -= TOUCH_OFFSET_Y;
        }
      } else {
        clientX = (e as MouseEvent).clientX;
        clientY = (e as MouseEvent).clientY;
      }

      if (isPanning && panStartRef.current && scrollStartRef.current) {
        const scrollContainer = containerRef.current?.parentElement;
        if (scrollContainer) {
          const dx = clientX - panStartRef.current.x;
          const dy = clientY - panStartRef.current.y;
          // Inverted scroll to mimic mobile "pulling the content"
          scrollContainer.scrollLeft = scrollStartRef.current.left - dx;
          scrollContainer.scrollTop = scrollStartRef.current.top - dy;
          if (isTouch) e.preventDefault(); // Stop mobile scroll
        }
        return;
      }

      if (isDragging) {
        if (isTouch) e.preventDefault(); // Stop mobile scroll
        const coords = getClampedCoords(clientX, clientY);
        setDragCurrent(coords);
        setMousePos({ x: clientX, y: clientY });

        if (activeTool === 'brush_erase' && brushCanvasRef.current) {
          continueBrushStroke(clientX, clientY);
        }
      }
    };

    const handleGlobalMouseUp = () => {
      if (isPanning) {
        setIsPanning(false);
        dragSourceRef.current = null;
        panStartRef.current = null;
        scrollStartRef.current = null;
        document.body.style.cursor = 'default';
        return;
      }

      if (!dragStart || !dragCurrent || !canvasRef.current || !isDragging) {
        setIsDragging(false);
        dragSourceRef.current = null;
        lastPosRef.current = null;
        return;
      }

      const img = imageRef.current;
      if (!img) return;

      if (activeTool === 'fill' || activeTool === 'erase') {
        const { drawX, drawY, cropLeft, cropTop, dpr } = renderParamsRef.current;

        const x1 = Math.min(dragStart.x, dragCurrent.x);
        const y1 = Math.min(dragStart.y, dragCurrent.y);
        const x2 = Math.max(dragStart.x, dragCurrent.x);
        const y2 = Math.max(dragStart.y, dragCurrent.y);

        // Convert drag rect to image-local space
        const localX1 = (x1 / dpr) - drawX + cropLeft;
        const localY1 = (y1 / dpr) - drawY + cropTop;
        const localX2 = (x2 / dpr) - drawX + cropLeft;
        const localY2 = (y2 / dpr) - drawY + cropTop;

        const width = localX2 - localX1;
        const height = localY2 - localY1;

        if (width > 0 && height > 0) {
          const fillCanvas = document.createElement('canvas');
          fillCanvas.width = img.naturalWidth;
          fillCanvas.height = img.naturalHeight;
          const fCtx = fillCanvas.getContext('2d')!;

          const currentImg = activeTool === 'erase' ? transparencyImg : fillMaskImg;
          if (currentImg) fCtx.drawImage(currentImg, 0, 0);

          fCtx.fillStyle = 'black';
          fCtx.fillRect(localX1, localY1, width, height);

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

      const wasTouch = dragSourceRef.current === 'touch';
      setIsDragging(false);
      dragSourceRef.current = null;
      setDragStart(null);
      setDragCurrent(null);
      lastPosRef.current = null;
      brushCanvasRef.current = null;
      if (wasTouch) setMousePos(null);
    };

    window.addEventListener('mousemove', handleGlobalMouseMove);
    window.addEventListener('mouseup', handleGlobalMouseUp);
    window.addEventListener('touchmove', handleGlobalMouseMove, { passive: false });
    window.addEventListener('touchend', handleGlobalMouseUp);
    window.addEventListener('touchcancel', handleGlobalMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleGlobalMouseMove);
      window.removeEventListener('mouseup', handleGlobalMouseUp);
      window.removeEventListener('touchmove', handleGlobalMouseMove);
      window.removeEventListener('touchend', handleGlobalMouseUp);
      window.removeEventListener('touchcancel', handleGlobalMouseUp);
    };
  }, [isDragging, isPanning, dragStart, dragCurrent, fillMaskImg, transparencyImg, getClampedCoords, setManualFillMask, setTransparencyMask, setTransparencyMaskOnly, commitTransparencyHistory, activeTool, brushSize]);


  // Track mouse position for the brush preview even when not dragging
  useEffect(() => {
    if (activeTool !== 'brush_erase' || isMobile) {
      setMousePos(null);
      return;
    }

    const handleMouseMove = (e: MouseEvent) => {
      if (Date.now() - lastTouchTimeRef.current < 500) return;
      setMousePos({ x: e.clientX, y: e.clientY });
    };

    const handleMouseLeave = () => setMousePos(null);

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseleave', handleMouseLeave);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseleave', handleMouseLeave);
    };
  }, [activeTool, isMobile]);


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
    const wallThreshold = 30;

    const tempFillCanvas = document.createElement('canvas');
    tempFillCanvas.width = width;
    tempFillCanvas.height = height;
    const tempFCtx = tempFillCanvas.getContext('2d')!;
    const tempFData = tempFCtx.createImageData(width, height);
    const fPixels = tempFData.data;

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

    tempFCtx.putImageData(tempFData, 0, 0);

    const img = imageRef.current;
    if (!img) return;

    const fillCanvas = document.createElement('canvas');
    fillCanvas.width = img.naturalWidth;
    fillCanvas.height = img.naturalHeight;
    const fCtx = fillCanvas.getContext('2d')!;

    const currentImg = activeTool === 'erase' ? transparencyImg : fillMaskImg;
    if (currentImg) {
      fCtx.drawImage(currentImg, 0, 0);
    }

    const { drawX, drawY, cropLeft, cropTop, logicalWidth, logicalHeight } = renderParamsRef.current;
    fCtx.drawImage(
      tempFillCanvas,
      0, 0, width, height,
      cropLeft - drawX, cropTop - drawY, logicalWidth, logicalHeight
    );

    if (activeTool === 'erase') {
      setTransparencyMask(fillCanvas.toDataURL());
      toast({ title: "Color borrado" });
    } else {
      setManualFillMask(fillCanvas.toDataURL());
      toast({ title: "Hueco rellenado" });
    }
  };


  if (!originalImage) return null;

  const cropLeftNum = Math.max(0, -padding.left);
  const cropTopNum = Math.max(0, -padding.top);
  const cropRightNum = Math.max(0, -padding.right);
  const cropBottomNum = Math.max(0, -padding.bottom);

  const actualImgWidth = Math.max(0, imageWidth - cropLeftNum - cropRightNum);
  const actualImgHeight = Math.max(0, imageHeight - cropTopNum - cropBottomNum);

  const extraH = Math.max(0, padding.left) + Math.max(0, padding.right);
  const extraV = Math.max(0, padding.top) + Math.max(0, padding.bottom);

  const canvasDisplayWidth = (actualImgWidth + extraH + outlineWidth * 2) * zoom;
  const canvasDisplayHeight = (actualImgHeight + extraV + outlineWidth * 2) * zoom;

  return (
    <div
      className={cn(
        "flex-1 w-full min-h-0 relative overflow-auto custom-scrollbar",
        isPanning ? "cursor-grabbing" : "cursor-default",
        className
      )}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div
        ref={containerRef}
        onMouseDown={handleMouseDown}
        className="w-max min-w-full h-max min-h-full flex items-center justify-center p-4 sm:p-8"
      >
        <div
          className="relative rounded-sm shadow-2xl flex-shrink-0"
          style={{
            width: canvasDisplayWidth > 0 ? `${canvasDisplayWidth}px` : 'auto',
            height: canvasDisplayHeight > 0 ? `${canvasDisplayHeight}px` : 'auto',
            ...(outlineWidth > 0
              ? {
                backgroundColor: 'hsl(var(--background))',
                outline: '1px dashed hsl(var(--border))',
                outlineOffset: '2px',
              }
              : {
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
          <canvas
            ref={canvasRef}
            onClick={handleCanvasClick}
            onTouchStart={handleTouchStart}
            className={cn(
              "absolute inset-0",
              isPanning ? "cursor-grabbing" :
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

          {/* Floating Undo/Redo for Mobile (Top Center) */}
          {isMobile && (canUndo || canRedo) && (
            <div
              className="fixed top-4 left-1/2 -translate-x-1/2 z-[200] flex gap-2 bg-background/80 backdrop-blur-md border border-border p-1.5 rounded-full shadow-lg animate-in fade-in slide-in-from-top-4 duration-300"
              onMouseDown={(e) => e.stopPropagation()}
              onTouchStart={(e) => e.stopPropagation()}
            >
              {canUndo && (
                <button
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (activeTool === 'brush_erase' || activeTool === 'erase') undoErase();
                    else if (activeTool === 'fill') undo();
                    else if (activeTool === 'none' && processedImageIndex > 0) undoImage();
                    else {
                      if (transparencyIndex > 0) undoErase();
                      else if (manualFillIndex > 0) undo();
                      else if (processedImageIndex > 0) undoImage();
                    }
                  }}
                  className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-secondary active:scale-95 transition-all text-foreground"
                >
                  <RotateCcw className="w-5 h-5" />
                </button>
              )}
              {canUndo && canRedo && <div className="w-px h-6 bg-border self-center" />}
              {canRedo && (
                <button
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (activeTool === 'brush_erase' || activeTool === 'erase') redoErase();
                    else if (activeTool === 'fill') redo();
                    else if (activeTool === 'none' && processedImageIndex < processedImageHistory.length - 1) redoImage();
                    else {
                      if (transparencyIndex < transparencyHistory.length - 1) redoErase();
                      else if (manualFillIndex < manualFillHistory.length - 1) redo();
                      else if (processedImageIndex < processedImageHistory.length - 1) redoImage();
                    }
                  }}
                  className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-secondary active:scale-95 transition-all text-foreground"
                >
                  <RotateCcw className="w-5 h-5 scale-x-[-1]" />
                </button>
              )}
            </div>
          )}

          {/* Floating Brush Interaction Handles for Mobile — minimal icons anchored below cursor */}
          {activeTool === 'brush_erase' && isMobile && mousePos && (
            <div
              ref={controlsPanelRef}
              className="fixed z-[250] flex gap-3"
              style={{
                left: mousePos.x,
                top: mousePos.y + (brushSize * zoom / 2) + 12,
                transform: 'translateX(-50%)',
                pointerEvents: 'auto',
              }}
              onMouseDown={(e) => e.stopPropagation()}
              onTouchStart={(e) => e.stopPropagation()}
            >
              {/* Move/Position Handle */}
              <div
                className="w-10 h-10 bg-background/70 backdrop-blur-sm border border-border/60 flex items-center justify-center rounded-full active:scale-90 transition-transform touch-none shadow-md"
                onTouchStart={(e) => {
                  e.stopPropagation();
                  const touch = e.touches[0];
                  handleStartRef.current = { x: touch.clientX, y: touch.clientY };
                  initialPosRef.current = mousePos || { x: window.innerWidth / 2, y: window.innerHeight / 2 };
                }}
                onTouchMove={(e) => {
                  e.stopPropagation();
                  const touch = e.touches[0];
                  const dx = touch.clientX - handleStartRef.current.x;
                  const dy = touch.clientY - handleStartRef.current.y;
                  const newPos = {
                    x: initialPosRef.current.x + dx,
                    y: initialPosRef.current.y + dy
                  };
                  setMousePos(newPos);
                  // Track canvas position so panning preserves location
                  brushCanvasPosRef.current = getClampedCoords(newPos.x, newPos.y);
                  // Update controls panel position imperatively (no React lag)
                  if (controlsPanelRef.current) {
                    controlsPanelRef.current.style.left = `${newPos.x}px`;
                    controlsPanelRef.current.style.top = `${newPos.y + brushSizeForControls.current * zoomForControls.current / 2 + 12}px`;
                  }
                }}
              >
                <Move className="w-4 h-4 text-foreground" />
              </div>

              {/* Erase Handle */}
              <div
                className="w-10 h-10 bg-pink-500/90 backdrop-blur-sm flex items-center justify-center rounded-full active:scale-90 transition-transform touch-none shadow-md shadow-pink-500/30"
                style={{ userSelect: 'none', WebkitUserSelect: 'none' } as React.CSSProperties}
                onTouchStart={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  const touch = e.touches[0];
                  handleStartRef.current = { x: touch.clientX, y: touch.clientY };
                  initialPosRef.current = mousePos || { x: window.innerWidth / 2, y: window.innerHeight / 2 };
                  startBrushStroke(initialPosRef.current.x, initialPosRef.current.y);
                }}
                onTouchMove={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  const touch = e.touches[0];
                  const dx = touch.clientX - handleStartRef.current.x;
                  const dy = touch.clientY - handleStartRef.current.y;
                  const newPos = {
                    x: initialPosRef.current.x + dx,
                    y: initialPosRef.current.y + dy
                  };
                  setMousePos(newPos);
                  brushCanvasPosRef.current = getClampedCoords(newPos.x, newPos.y);
                  // Update controls panel position imperatively (no React lag)
                  if (controlsPanelRef.current) {
                    controlsPanelRef.current.style.left = `${newPos.x}px`;
                    controlsPanelRef.current.style.top = `${newPos.y + brushSizeForControls.current * zoomForControls.current / 2 + 12}px`;
                  }
                  continueBrushStroke(newPos.x, newPos.y);
                }}
                onTouchEnd={(e) => {
                  e.stopPropagation();
                  commitTransparencyHistory();
                  toast({ title: "Borrado completado" });
                }}
              >
                <Eraser className="w-4 h-4 text-white" />
              </div>
            </div>
          )}

          {/* Floating Brush Size Control for Mobile (Left side) */}
          {activeTool === 'brush_erase' && isMobile && (
            <div className="fixed left-4 top-1/2 -translate-y-1/2 z-[200] bg-background/90 backdrop-blur-md border border-border p-4 rounded-2xl shadow-xl flex flex-col items-center gap-4 animate-in fade-in slide-in-from-left-4 duration-300">
              <div className="flex flex-col items-center gap-2 h-40">
                <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest leading-none rotate-180 [writing-mode:vertical-lr]">
                  {brushSize}px
                </span>
                <input
                  type="range"
                  min="5"
                  max="100"
                  step="1"
                  value={brushSize}
                  onChange={(e) => setBrushSize(parseInt(e.target.value))}
                  className="w-1.5 h-full rounded-lg appearance-none bg-secondary cursor-pointer accent-primary [writing-mode:vertical-lr] cursor-ns-resize"
                  style={{ direction: 'rtl' }}
                />
              </div>
              <div
                className="w-8 h-8 rounded-full bg-primary/20 border border-primary/30 flex items-center justify-center pointer-events-none"
                style={{ width: Math.max(8, brushSize / 2), height: Math.max(8, brushSize / 2) }}
              >
                <div className="w-1 h-1 bg-primary rounded-full" />
              </div>
            </div>
          )}

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

          {activeTool === 'adjust_margin' && (
            <>
              <div className="absolute inset-0 border border-blue-500/50 pointer-events-none" />
              <div
                className="absolute top-0 left-0 right-0 h-4 -mt-2 cursor-ns-resize z-50 flex items-center justify-center group"
                onMouseDown={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  setMarginDragState({ edge: 'top', startVal: padding.top, startPos: e.clientY });
                }}
                onTouchStart={(e) => {
                  e.stopPropagation();
                  setMarginDragState({ edge: 'top', startVal: padding.top, startPos: e.touches[0].clientY });
                }}
              >
                <div className="w-12 h-1.5 bg-blue-500 rounded-full opacity-50 group-hover:opacity-100" />
              </div>
              {/* BOTTOM */}
              <div
                className="absolute bottom-0 left-0 right-0 h-4 -mb-2 cursor-ns-resize z-50 flex items-center justify-center group"
                onMouseDown={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  setMarginDragState({ edge: 'bottom', startVal: padding.bottom, startPos: e.clientY });
                }}
                onTouchStart={(e) => {
                  e.stopPropagation();
                  setMarginDragState({ edge: 'bottom', startVal: padding.bottom, startPos: e.touches[0].clientY });
                }}
              >
                <div className="w-12 h-1.5 bg-blue-500 rounded-full opacity-50 group-hover:opacity-100" />
              </div>
              {/* LEFT */}
              <div
                className="absolute left-0 top-0 bottom-0 w-4 -ml-2 cursor-ew-resize z-50 flex items-center justify-center group"
                onMouseDown={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  setMarginDragState({ edge: 'left', startVal: padding.left, startPos: e.clientX });
                }}
                onTouchStart={(e) => {
                  e.stopPropagation();
                  setMarginDragState({ edge: 'left', startVal: padding.left, startPos: e.touches[0].clientX });
                }}
              >
                <div className="w-1.5 h-12 bg-blue-500 rounded-full opacity-50 group-hover:opacity-100" />
              </div>
              {/* RIGHT */}
              <div
                className="absolute right-0 top-0 bottom-0 w-4 -mr-2 cursor-ew-resize z-50 flex items-center justify-center group"
                onMouseDown={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  setMarginDragState({ edge: 'right', startVal: padding.right, startPos: e.clientX });
                }}
                onTouchStart={(e) => {
                  e.stopPropagation();
                  setMarginDragState({ edge: 'right', startVal: padding.right, startPos: e.touches[0].clientX });
                }}
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
