import { NextRequest, NextResponse } from 'next/server';
import sharp from 'sharp';

interface ExportRequest {
  image: string; // base64 data URL
  format: 'png' | 'webp';
  quality: 'high' | 'medium' | 'low';
}

async function optimizeImage(
  imageBuffer: Buffer,
  format: 'png' | 'webp',
  quality: 'high' | 'medium' | 'low'
): Promise<Buffer> {
  const qualityMap = {
    high: { png: 100, webp: 95 },
    medium: { png: 85, webp: 80 },
    low: { png: 70, webp: 60 },
  };

  const q = qualityMap[quality];

  if (format === 'webp') {
    return sharp(imageBuffer)
      .webp({
        quality: q.webp,
        effort: 6, // Max compression effort
        lossless: quality === 'high',
      })
      .toBuffer();
  }

  // PNG optimization
  return sharp(imageBuffer)
    .png({
      compressionLevel: 9, // Max compression
      quality: q.png,
      effort: 10, // Max effort for smaller size
      adaptiveFiltering: true,
    })
    .toBuffer();
}

export async function POST(request: NextRequest) {
  try {
    const body: ExportRequest = await request.json();
    const { image, format = 'png', quality = 'high' } = body;

    if (!image) {
      return NextResponse.json(
        { success: false, error: 'No image provided' },
        { status: 400 }
      );
    }

    // Extract base64 data from data URL
    const matches = image.match(/^data:image\/\w+;base64,(.+)$/);
    if (!matches) {
      return NextResponse.json(
        { success: false, error: 'Invalid image format' },
        { status: 400 }
      );
    }

    const base64Data = matches[1];
    const imageBuffer = Buffer.from(base64Data, 'base64');

    // Optimize image
    const optimizedBuffer = await optimizeImage(imageBuffer, format, quality);

    // Return as base64 data URL
    const resultBase64 = optimizedBuffer.toString('base64');
    const mimeType = format === 'png' ? 'image/png' : 'image/webp';
    const resultDataUrl = `data:${mimeType};base64,${resultBase64}`;

    return NextResponse.json({
      success: true,
      image: resultDataUrl,
      originalSize: imageBuffer.length,
      optimizedSize: optimizedBuffer.length,
      reduction: Math.round((1 - optimizedBuffer.length / imageBuffer.length) * 100),
    });
  } catch (error) {
    console.error('Export optimization error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to optimize image' },
      { status: 500 }
    );
  }
}
