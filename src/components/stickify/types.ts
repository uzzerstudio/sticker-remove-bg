export interface Padding {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export interface StickerState {
  originalImage: string | null;
  processedImage: string | null;
  processedImageHistory: (string | null)[];
  processedImageIndex: number;
  outlineWidth: number; // in pixels
  outlineWidthCm: number; // in centimeters
  outlineColor: string;
  padding: Padding;
  zoom: number;
  isProcessing: boolean;
  imageWidth: number;
  imageHeight: number;
  dpi: number; // for cm to pixel conversion
  triggerFitCounter: number;
  manualFillMask: string | null;
  manualFillHistory: (string | null)[];
  manualFillIndex: number;
  transparencyMask: string | null;
  transparencyHistory: (string | null)[];
  transparencyIndex: number;
  activeTool: 'none' | 'fill' | 'erase' | 'brush_erase' | 'adjust_margin';
  brushSize: number;
}

export interface StickerStore extends StickerState {
  setOriginalImage: (image: string | null) => void;
  setProcessedImage: (image: string | null) => void;
  setOutlineWidth: (width: number) => void;
  setOutlineWidthCm: (cm: number) => void;
  setOutlineColor: (color: string) => void;
  setPadding: (padding: Padding | ((prev: Padding) => Padding)) => void;
  setPaddingUniform: (value: number) => void;
  setZoom: (zoom: number) => void;
  setIsProcessing: (processing: boolean) => void;
  setImageDimensions: (width: number, height: number) => void;
  autoCrop: () => void;
  triggerFit: () => void;
  setManualFillMask: (mask: string | null) => void;
  setTransparencyMask: (mask: string | null) => void;
  undo: () => void;
  redo: () => void;
  undoErase: () => void;
  redoErase: () => void;
  undoImage: () => void;
  redoImage: () => void;
  setActiveTool: (tool: 'none' | 'fill' | 'erase' | 'brush_erase' | 'adjust_margin') => void;
  setBrushSize: (size: number) => void;
  setTransparencyMaskOnly: (mask: string | null) => void;
  commitTransparencyHistory: () => void;
  reset: () => void;
  resetImage: () => void;
  cmToPixels: (cm: number) => number;
  pixelsToCm: (pixels: number) => number;
}

export interface ExportOptions {
  format: 'png' | 'webp';
  quality: 'high' | 'medium' | 'low';
  filename: string;
}

export const DPI_DEFAULT = 300; // Standard print DPI for stickers
