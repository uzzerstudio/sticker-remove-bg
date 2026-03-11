import { create } from 'zustand';
import type { StickerState, Padding, StickerStore } from './types';
import { DPI_DEFAULT } from './types';

const initialPadding: Padding = { top: 0, bottom: 0, left: 0, right: 0 };

const initialState: StickerState = {
  originalImage: null,
  processedImage: null,
  outlineWidth: 0,
  outlineWidthCm: 0,
  outlineColor: '#FFFFFF', // Blanco por defecto
  padding: initialPadding,
  zoom: 1,
  isProcessing: false,
  imageWidth: 0,
  imageHeight: 0,
  dpi: DPI_DEFAULT,
  triggerFitCounter: 0,
  manualFillMask: null,
  manualFillHistory: [null],
  manualFillIndex: 0,
  transparencyMask: null,
  transparencyHistory: [null],
  transparencyIndex: 0,
  activeTool: 'none',
  brushSize: 20,
};

export const useStickerStore = create<StickerStore>((set, get) => ({
  ...initialState,

  setOriginalImage: (image) => set({
    ...initialState,
    originalImage: image,
    processedImage: null,
  }),
  setProcessedImage: (image) => set({ processedImage: image }),
  setOutlineWidth: (width) => {
    const cm = get().pixelsToCm(width);
    set({ outlineWidth: width, outlineWidthCm: cm });
  },
  setOutlineWidthCm: (cm) => {
    const pixels = get().cmToPixels(cm);
    set({ outlineWidthCm: cm, outlineWidth: Math.round(pixels) });
  },
  setOutlineColor: (color) => set({ outlineColor: color }),
  setPadding: (padding) => {
    if (typeof padding === 'function') {
      set({ padding: padding(get().padding) });
    } else {
      set({ padding });
    }
  },
  setPaddingUniform: (value) => set({
    padding: { top: value, bottom: value, left: value, right: value }
  }),
  setZoom: (zoom) => set({ zoom: Math.max(0.1, Math.min(5, zoom)) }),
  setIsProcessing: (processing) => set({ isProcessing: processing }),
  setImageDimensions: (width, height) => set({ imageWidth: width, imageHeight: height }),

  autoCrop: () => {
    const { processedImage, originalImage } = get();
    const image = processedImage || originalImage;
    if (!image) return;

    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0);

      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imageData.data;

      let minX = canvas.width;
      let maxX = 0;
      let minY = canvas.height;
      let maxY = 0;

      // Find bounding box of non-transparent pixels
      for (let y = 0; y < canvas.height; y++) {
        for (let x = 0; x < canvas.width; x++) {
          const idx = (y * canvas.width + x) * 4;
          const alpha = data[idx + 3];

          if (alpha > 10) { // Non-transparent pixel
            minX = Math.min(minX, x);
            maxX = Math.max(maxX, x);
            minY = Math.min(minY, y);
            maxY = Math.max(maxY, y);
          }
        }
      }

      // Calculate padding to crop to content (negative values)
      const newPadding = {
        top: -minY,
        bottom: -(canvas.height - maxY - 1),
        left: -minX,
        right: -(canvas.width - maxX - 1),
      };

      set({ padding: newPadding });
    };
    img.src = image;
  },

  triggerFit: () => set((state) => ({ triggerFitCounter: state.triggerFitCounter + 1 })),

  setManualFillMask: (mask) => {
    const { manualFillHistory, manualFillIndex } = get();
    const newHistory = manualFillHistory.slice(0, manualFillIndex + 1);
    newHistory.push(mask);
    set({
      manualFillMask: mask,
      manualFillHistory: newHistory,
      manualFillIndex: newHistory.length - 1
    });
  },

  setTransparencyMaskOnly: (mask) => set({ transparencyMask: mask }),

  commitTransparencyHistory: () => {
    const { transparencyMask, transparencyHistory, transparencyIndex } = get();
    const newHistory = transparencyHistory.slice(0, transparencyIndex + 1);
    newHistory.push(transparencyMask);
    set({
      transparencyHistory: newHistory,
      transparencyIndex: newHistory.length - 1
    });
  },

  setTransparencyMask: (mask) => {
    get().setTransparencyMaskOnly(mask);
    get().commitTransparencyHistory();
  },

  undo: () => {
    const { manualFillHistory, manualFillIndex } = get();
    if (manualFillIndex > 0) {
      const newIndex = manualFillIndex - 1;
      set({
        manualFillMask: manualFillHistory[newIndex],
        manualFillIndex: newIndex
      });
    }
  },

  redo: () => {
    const { manualFillHistory, manualFillIndex } = get();
    if (manualFillIndex < manualFillHistory.length - 1) {
      const newIndex = manualFillIndex + 1;
      set({
        manualFillMask: manualFillHistory[newIndex],
        manualFillIndex: newIndex
      });
    }
  },

  undoErase: () => {
    const { transparencyHistory, transparencyIndex } = get();
    if (transparencyIndex > 0) {
      const newIndex = transparencyIndex - 1;
      set({
        transparencyMask: transparencyHistory[newIndex],
        transparencyIndex: newIndex
      });
    }
  },

  redoErase: () => {
    const { transparencyHistory, transparencyIndex } = get();
    if (transparencyIndex < transparencyHistory.length - 1) {
      const newIndex = transparencyIndex + 1;
      set({
        transparencyMask: transparencyHistory[newIndex],
        transparencyIndex: newIndex
      });
    }
  },

  setActiveTool: (tool) => set({ activeTool: tool }),
  setBrushSize: (size) => set({ brushSize: size }),

  reset: () => set({
    ...initialState,
    originalImage: get().originalImage, // Keep the image
  }),

  resetImage: () => set({ processedImage: null }),

  cmToPixels: (cm: number) => {
    const dpi = get().dpi;
    return (cm / 2.54) * dpi;
  },

  pixelsToCm: (pixels: number) => {
    const dpi = get().dpi;
    return (pixels / dpi) * 2.54;
  },
}));
