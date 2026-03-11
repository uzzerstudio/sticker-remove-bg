'use client';

import { useLanguage } from '@/components/language-provider';
import { useStickerStore } from './sticker-store';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Wand2, RotateCcw, Crop, ChevronUp, ChevronDown, ChevronLeft, ChevronRight, Minus, Plus } from 'lucide-react';

// Preset colors for outline - includes off-whites for canvas visibility
const OUTLINE_PRESETS = [
  { color: '#F0F0F0', name: 'Gris claro', desc: 'Visible en canvas' },
  { color: '#FFFFFF', name: 'Blanco', desc: 'Puro' },
  { color: '#E8E8E8', name: 'Gris', desc: 'Más oscuro' },
  { color: '#D0D0D0', name: 'Gris medio', desc: 'Muy visible' },
  { color: '#000000', name: 'Negro', desc: '' },
  { color: '#FFD700', name: 'Dorado', desc: '' },
];

export function ControlPanel() {
  const { t } = useLanguage();
  const {
    outlineWidth,
    outlineWidthCm,
    setOutlineWidth,
    setOutlineWidthCm,
    outlineColor,
    setOutlineColor,
    padding,
    setPadding,
    setPaddingUniform,
    reset,
    originalImage,
  } = useStickerStore();

  if (!originalImage) return null;

  // Permitir valores negativos (mínimo -100 para recortar)
  const adjustPadding = (side: 'top' | 'bottom' | 'left' | 'right', delta: number) => {
    setPadding((prev) => ({
      ...prev,
      [side]: Math.max(-100, prev[side] + delta),
    }));
  };

  const setPaddingSide = (side: 'top' | 'bottom' | 'left' | 'right', value: number) => {
    setPadding((prev) => ({
      ...prev,
      [side]: Math.max(-100, value),
    }));
  };

  return (
    <div className="space-y-4">
      {/* Outline Controls */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <div className="w-6 h-6 rounded-md bg-gradient-to-br from-pink-500 to-violet-500 flex items-center justify-center">
              <Wand2 className="w-3.5 h-3.5 text-white" />
            </div>
            {t('editor.outline')}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Outline Width in cm */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-sm">{t('editor.outlineWidth')}</Label>
              <div className="flex items-center gap-1">
                <Input
                  type="number"
                  value={outlineWidthCm.toFixed(2)}
                  onChange={(e) => setOutlineWidthCm(parseFloat(e.target.value) || 0)}
                  className="w-20 h-8 text-right text-sm"
                  min={0}
                  max={2}
                  step={0.01}
                />
                <span className="text-sm text-muted-foreground">cm</span>
              </div>
            </div>
            <Slider
              value={[outlineWidth]}
              onValueChange={([value]) => setOutlineWidth(value)}
              min={0}
              max={50}
              step={1}
              className="w-full"
            />
            <p className="text-xs text-muted-foreground">
              {outlineWidth}px • {outlineWidthCm.toFixed(2)}cm
            </p>
          </div>

          {/* Outline Color */}
          <div className="space-y-2">
            <Label className="text-sm">{t('editor.outlineColor')}</Label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={outlineColor}
                onChange={(e) => setOutlineColor(e.target.value)}
                className="w-10 h-10 rounded-lg border cursor-pointer"
              />
              <Input
                type="text"
                value={outlineColor}
                onChange={(e) => setOutlineColor(e.target.value)}
                className="flex-1"
                placeholder="#F0F0F0"
              />
            </div>
            
            {/* Color presets - 2 rows */}
            <div className="space-y-2">
              <div className="flex gap-2 flex-wrap">
                {OUTLINE_PRESETS.map((preset) => (
                  <button
                    key={preset.color}
                    onClick={() => setOutlineColor(preset.color)}
                    className="flex flex-col items-center gap-0.5 p-1.5 rounded-lg border-2 transition-all hover:scale-105"
                    style={{
                      borderColor: outlineColor === preset.color ? 'hsl(var(--primary))' : 'transparent',
                      backgroundColor: 'hsl(var(--card))',
                    }}
                    title={preset.name}
                  >
                    <div
                      className="w-8 h-8 rounded border"
                      style={{ backgroundColor: preset.color }}
                    />
                    <span className="text-[10px] text-muted-foreground">{preset.name}</span>
                  </button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground italic">
                💡 Usa tonos grises para que el contorno se vea en canvas
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Canvas Controls */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Crop className="w-4 h-4" />
            {t('editor.canvas')}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Quick padding buttons */}
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              className="flex-1 text-xs"
              onClick={() => setPaddingUniform(0)}
            >
              0px
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="flex-1 text-xs"
              onClick={() => setPaddingUniform(10)}
            >
              +10px
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="flex-1 text-xs"
              onClick={() => setPaddingUniform(-10)}
            >
              -10px
            </Button>
          </div>

          {/* Individual padding controls */}
          <div className="space-y-2">
            <Label className="text-sm">Márgenes (negativos = recortar)</Label>
            
            {/* Canvas Size Visualization with controls */}
            <div className="flex flex-col items-center gap-1 p-4 bg-muted/50 rounded-lg">
              {/* Top padding control */}
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={() => adjustPadding('top', -5)}
                >
                  <Minus className="w-3 h-3" />
                </Button>
                <div className="flex flex-col items-center">
                  <ChevronUp className="w-4 h-4 text-muted-foreground" />
                  <Input
                    type="number"
                    value={padding.top}
                    onChange={(e) => setPaddingSide('top', parseInt(e.target.value) || 0)}
                    className="w-14 h-7 text-xs text-center"
                  />
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={() => adjustPadding('top', 5)}
                >
                  <Plus className="w-3 h-3" />
                </Button>
              </div>

              {/* Middle row */}
              <div className="flex items-center gap-2">
                {/* Left padding control */}
                <div className="flex flex-col items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={() => adjustPadding('left', -5)}
                  >
                    <Minus className="w-3 h-3" />
                  </Button>
                  <div className="flex items-center gap-1">
                    <ChevronLeft className="w-4 h-4 text-muted-foreground" />
                    <Input
                      type="number"
                      value={padding.left}
                      onChange={(e) => setPaddingSide('left', parseInt(e.target.value) || 0)}
                      className="w-12 h-7 text-xs text-center"
                    />
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={() => adjustPadding('left', 5)}
                  >
                    <Plus className="w-3 h-3" />
                  </Button>
                </div>

                {/* Image area */}
                <div className="w-16 h-16 border-2 border-dashed border-primary/50 rounded flex items-center justify-center bg-background">
                  <span className="text-xs text-muted-foreground">Img</span>
                </div>

                {/* Right padding control */}
                <div className="flex flex-col items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={() => adjustPadding('right', -5)}
                  >
                    <Minus className="w-3 h-3" />
                  </Button>
                  <div className="flex items-center gap-1">
                    <Input
                      type="number"
                      value={padding.right}
                      onChange={(e) => setPaddingSide('right', parseInt(e.target.value) || 0)}
                      className="w-12 h-7 text-xs text-center"
                    />
                    <ChevronRight className="w-4 h-4 text-muted-foreground" />
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={() => adjustPadding('right', 5)}
                  >
                    <Plus className="w-3 h-3" />
                  </Button>
                </div>
              </div>

              {/* Bottom padding control */}
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={() => adjustPadding('bottom', -5)}
                >
                  <Minus className="w-3 h-3" />
                </Button>
                <div className="flex flex-col items-center">
                  <Input
                    type="number"
                    value={padding.bottom}
                    onChange={(e) => setPaddingSide('bottom', parseInt(e.target.value) || 0)}
                    className="w-14 h-7 text-xs text-center"
                  />
                  <ChevronDown className="w-4 h-4 text-muted-foreground" />
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={() => adjustPadding('bottom', 5)}
                >
                  <Plus className="w-3 h-3" />
                </Button>
              </div>
            </div>
          </div>

          {/* Auto Crop Button */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => useStickerStore.getState().autoCrop()}
            className="w-full"
          >
            <Crop className="w-4 h-4 mr-2" />
            {t('editor.autoCrop')}
          </Button>

          {/* Reset Button */}
          <Button
            variant="outline"
            size="sm"
            onClick={reset}
            className="w-full"
          >
            <RotateCcw className="w-4 h-4 mr-2" />
            {t('editor.resetCanvas')}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
