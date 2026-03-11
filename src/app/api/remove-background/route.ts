import { NextRequest, NextResponse } from 'next/server';
import sharp from 'sharp';

interface RemoveBackgroundRequest {
  image: string; // base64 data URL
  tolerance?: number; // color tolerance for flood fill (default: 30)
}

// Optimized flood fill using scanline algorithm
function floodFillScanline(
  pixels: Uint8Array,
  width: number,
  height: number,
  startX: number,
  startY: number,
  tolerance: number,
  visited: Uint8Array
): void {
  const startIdx = (startY * width + startX) * 4;
  const startR = pixels[startIdx];
  const startG = pixels[startIdx + 1];
  const startB = pixels[startIdx + 2];

  // Skip if already visited
  if (visited[startY * width + startX]) return;

  // Stack for scanline ranges
  const stack: [number, number, number, number][] = [];
  stack.push([startX, startX, startY, 1]);
  stack.push([startX, startX, startY - 1, -1]);

  while (stack.length > 0) {
    const [x1, x2, y, dy] = stack.pop()!;

    // Skip if out of bounds
    if (y < 0 || y >= height) continue;

    let newX1 = x1;
    let newX2 = x2;

    // Find left bound
    let x = x1;
    while (x >= 0) {
      const idx = y * width + x;
      if (visited[idx]) break;

      const pixelIdx = idx * 4;
      const colorDiff = Math.sqrt(
        Math.pow(pixels[pixelIdx] - startR, 2) +
        Math.pow(pixels[pixelIdx + 1] - startG, 2) +
        Math.pow(pixels[pixelIdx + 2] - startB, 2)
      );

      if (colorDiff > tolerance) break;
      x--;
    }
    newX1 = x + 1;

    // Find right bound
    x = x2;
    while (x < width) {
      const idx = y * width + x;
      if (visited[idx]) break;

      const pixelIdx = idx * 4;
      const colorDiff = Math.sqrt(
        Math.pow(pixels[pixelIdx] - startR, 2) +
        Math.pow(pixels[pixelIdx + 1] - startG, 2) +
        Math.pow(pixels[pixelIdx + 2] - startB, 2)
      );

      if (colorDiff > tolerance) break;
      x++;
    }
    newX2 = x - 1;

    // Mark this scanline as visited and transparent
    for (x = newX1; x <= newX2; x++) {
      const idx = y * width + x;
      visited[idx] = 1;
      pixels[idx * 4 + 3] = 0; // Set alpha to 0 (transparent)
    }

    // Check scanlines above and below
    for (const nextY of [y - dy, y + dy]) {
      if (nextY < 0 || nextY >= height) continue;

      let inRange = false;
      let rangeStart = 0;

      for (x = newX1; x <= newX2 + 1; x++) {
        const idx = nextY * width + x;
        const isBackground = x <= newX2 && !visited[idx] && (() => {
          const pixelIdx = idx * 4;
          const colorDiff = Math.sqrt(
            Math.pow(pixels[pixelIdx] - startR, 2) +
            Math.pow(pixels[pixelIdx + 1] - startG, 2) +
            Math.pow(pixels[pixelIdx + 2] - startB, 2)
          );
          return colorDiff <= tolerance;
        })();

        if (isBackground && !inRange) {
          inRange = true;
          rangeStart = x;
        } else if (!isBackground && inRange) {
          inRange = false;
          stack.push([rangeStart, x - 1, nextY, dy]);
        }
      }
    }
  }
}

// Get all edge pixels from the perimeter
function getEdgePixels(width: number, height: number): [number, number][] {
  const edges: [number, number][] = [];

  // Sample every few pixels from edges for efficiency
  const step = Math.max(1, Math.floor(Math.min(width, height) / 100));

  // Top edge
  for (let x = 0; x < width; x += step) {
    edges.push([x, 0]);
  }

  // Bottom edge
  for (let x = 0; x < width; x += step) {
    edges.push([x, height - 1]);
  }

  // Left edge
  for (let y = 0; y < height; y += step) {
    edges.push([0, y]);
  }

  // Right edge
  for (let y = 0; y < height; y += step) {
    edges.push([width - 1, y]);
  }

  return edges;
}

// Simple background removal - just flood fill from edges
function removeBackgroundSimple(
  pixels: Uint8Array,
  width: number,
  height: number,
  tolerance: number
): void {
  const visited = new Uint8Array(width * height);
  const edgePixels = getEdgePixels(width, height);

  // Flood fill from each edge pixel
  for (const [x, y] of edgePixels) {
    if (!visited[y * width + x]) {
      floodFillScanline(pixels, width, height, x, y, tolerance, visited);
    }
  }
}

async function removeBackground(
  imageBuffer: Buffer,
  tolerance: number = 30
): Promise<Buffer> {
  const image = sharp(imageBuffer);
  const metadata = await image.metadata();

  if (!metadata.width || !metadata.height) {
    throw new Error('Invalid image dimensions');
  }

  // Resize if too large for performance
  let processedImage = image;
  let scale = 1;
  const maxDimension = 2000;

  if (metadata.width > maxDimension || metadata.height > maxDimension) {
    scale = maxDimension / Math.max(metadata.width, metadata.height);
    processedImage = image.resize(
      Math.round(metadata.width * scale),
      Math.round(metadata.height * scale),
      { fastShrinkOnLoad: false }
    );
  }

  // Get raw pixel data with alpha channel
  const { data, info } = await processedImage
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const pixels = new Uint8Array(data);
  const width = info.width;
  const height = info.height;

  // Remove background - clean and simple
  removeBackgroundSimple(pixels, width, height, tolerance);

  // Convert back to image buffer
  let result = await sharp(Buffer.from(pixels), {
    raw: {
      width,
      height,
      channels: 4,
    },
  }).png({ compressionLevel: 6 });

  // Scale back to original size if we resized
  if (scale < 1) {
    result = result.resize(metadata.width, metadata.height, {
      kernel: sharp.kernel.lanczos3,
    });
  }

  return result.toBuffer();
}

export async function POST(request: NextRequest) {
  try {
    const body: RemoveBackgroundRequest = await request.json();
    const { image, tolerance = 30 } = body;

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

    // Process image to remove background
    const processedBuffer = await removeBackground(imageBuffer, tolerance);

    // Return as base64 data URL
    const resultBase64 = processedBuffer.toString('base64');
    const resultDataUrl = `data:image/png;base64,${resultBase64}`;

    return NextResponse.json({
      success: true,
      image: resultDataUrl,
    });
  } catch (error) {
    console.error('Background removal error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to process image' },
      { status: 500 }
    );
  }
}
