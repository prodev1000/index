// src/browser/utils.ts
import sharp from 'sharp';
import path from 'path';
import { InteractiveElement, Rect } from './models';

// Define the colors used for highlighting (RGB)
const colors = [
    { r: 204, g: 0, b: 0 },
    { r: 0, g: 136, b: 0 },
    { r: 0, g: 0, b: 204 },
    { r: 204, g: 112, b: 0 },
    { r: 102, g: 0, b: 102 },
    { r: 0, g: 102, b: 102 },
    { r: 204, g: 51, b: 153 },
    { r: 44, g: 0, b: 102 },
    { r: 204, g: 35, b: 0 },
    { r: 28, g: 102, b: 66 },
    { r: 170, g: 0, b: 0 },
    { r: 36, g: 82, b: 123 },
];

const fontPath = path.join(__dirname, 'fonts', 'OpenSans-Medium.ttf');

interface PlacedLabel {
    left: number;
    top: number;
    right: number;
    bottom: number;
}

/**
 * Highlight elements on a screenshot using Sharp.
 * @param elements - Dictionary of elements to highlight (index -> element).
 * @param screenshotB64 - Base64 encoded screenshot.
 * @returns Base64 encoded screenshot with highlights.
 */
export async function putHighlightElementsOnScreenshot(
    elements: Record<number, InteractiveElement>,
    screenshotB64: string
): Promise<string> {
    try {
        const imageBuffer = Buffer.from(screenshotB64, 'base64');
        const image = sharp(imageBuffer);
        const metadata = await image.metadata();
        const imageWidth = metadata.width ?? 0;
        const imageHeight = metadata.height ?? 0;

        const compositeOperations: sharp.OverlayOptions[] = [];
        const placedLabels: PlacedLabel[] = [];

        for (const indexStr in elements) {
            const index = parseInt(indexStr, 10);
            const element = elements[index];

            // Skip sheet elements (if applicable, based on Python logic)
            if (element.browser_agent_id.startsWith("row_") || element.browser_agent_id.startsWith("column_")) {
                continue;
            }

            const color = colors[index % colors.length];
            const rect = element.viewport; // Use viewport coordinates
            const rectWidth = Math.max(1, Math.round(rect.width ?? 1)); // Ensure width/height > 0
            const rectHeight = Math.max(1, Math.round(rect.height ?? 1));
            const rectX = Math.round(rect.x);
            const rectY = Math.round(rect.y);

            // --- Draw Rectangle --- Create a transparent overlay with the border
            const borderThickness = 2;
            const borderSvg = `
                <svg width="${rectWidth}" height="${rectHeight}">
                    <rect x="0" y="0" width="${rectWidth}" height="${rectHeight}"
                          stroke="rgb(${color.r},${color.g},${color.b})" stroke-width="${borderThickness}" fill="none" />
                </svg>`;
            compositeOperations.push({
                input: Buffer.from(borderSvg),
                left: rectX,
                top: rectY,
            });

            // --- Prepare Label --- Create SVG for the label
            const text = String(index);
            const fontSize = 14;
            const padding = 3;
            // Estimate text width/height (Sharp doesn't provide precise metrics easily like PIL)
            // This is a rough estimation, might need refinement
            const estimatedCharWidth = fontSize * 0.6;
            const textWidth = text.length * estimatedCharWidth;
            const textHeight = fontSize;

            const labelWidth = Math.round(textWidth + padding * 2);
            const labelHeight = Math.round(textHeight + padding * 2);

            // --- Label Positioning Logic ---
            let labelX: number;
            let labelY: number;

            if (labelWidth > rectWidth || labelHeight > rectHeight) {
                labelX = rectX + rectWidth;
                labelY = rectY;
            } else {
                labelX = rectX + rectWidth - labelWidth;
                labelY = rectY;
            }

            // --- Check for Overlaps ---
            let currentLabelRect: PlacedLabel = {
                left: labelX,
                top: labelY,
                right: labelX + labelWidth,
                bottom: labelY + labelHeight,
            };

            for (const existing of placedLabels) {
                const overlaps = !(currentLabelRect.right < existing.left ||
                                 currentLabelRect.left > existing.right ||
                                 currentLabelRect.bottom < existing.top ||
                                 currentLabelRect.top > existing.bottom);
                if (overlaps) {
                    labelY = existing.bottom + 2;
                    currentLabelRect = {
                        left: labelX,
                        top: labelY,
                        right: labelX + labelWidth,
                        bottom: labelY + labelHeight,
                    };
                    // Re-check against all previous labels after moving
                    // This simple approach might not be perfect for complex overlaps
                }
            }

            // --- Ensure Label is within Bounds ---
            if (labelX < 0) labelX = 0;
            if (labelX + labelWidth >= imageWidth) labelX = imageWidth - labelWidth - 1;
            if (labelY < 0) labelY = 0;
            if (labelY + labelHeight >= imageHeight) labelY = imageHeight - labelHeight - 1;

            currentLabelRect = { left: labelX, top: labelY, right: labelX + labelWidth, bottom: labelY + labelHeight };
            placedLabels.push(currentLabelRect);

            // --- Create Label SVG ---
            const labelSvg = `
                <svg width="${labelWidth}" height="${labelHeight}">
                    <rect x="0" y="0" width="${labelWidth}" height="${labelHeight}" fill="rgb(${color.r},${color.g},${color.b})" />
                    <text x="${padding}" y="${fontSize - 1 + padding}" font-family="Open Sans, sans-serif" font-size="${fontSize}px" fill="white">${text}</text>
                </svg>`;
                // Note: font-family assumes Open Sans is available or falls back.
                // For precise font rendering, ensure the font is installed or use sharp's text features if needed.

            compositeOperations.push({
                input: Buffer.from(labelSvg),
                left: Math.round(labelX),
                top: Math.round(labelY),
            });
        }

        // Apply all composite operations
        const finalImageBuffer = await image.composite(compositeOperations).png().toBuffer();
        return finalImageBuffer.toString('base64');

    } catch (error) {
        console.error(`Failed to add highlights to screenshot: ${error}`);
        return screenshotB64; // Return original on error
    }
}

/**
 * Scale down a base64 encoded image using Sharp.
 * @param imageB64 - Base64 encoded image string.
 * @param scaleFactor - Factor to scale the image by (e.g., 0.5 for half size).
 * @returns Base64 encoded scaled image.
 */
export async function scaleB64Image(imageB64: string, scaleFactor: number): Promise<string> {
    try {
        const imageBuffer = Buffer.from(imageB64, 'base64');
        const image = sharp(imageBuffer);
        const metadata = await image.metadata();

        if (!metadata.width || !metadata.height) {
            return imageB64; // Cannot scale if dimensions are unknown
        }

        const newWidth = Math.round(metadata.width * scaleFactor);
        const newHeight = Math.round(metadata.height * scaleFactor);

        const resizedImageBuffer = await image
            .resize(newWidth, newHeight, { kernel: sharp.kernel.lanczos3 })
            .png() // Ensure output is PNG
            .toBuffer();

        return resizedImageBuffer.toString('base64');
    } catch (error) {
        console.error(`Failed to scale image: ${error}`);
        return imageB64; // Return original on error
    }
}

/**
 * Calculate Intersection over Union (IoU) between two rectangles.
 */
export function calculateIou(rect1: Rect, rect2: Rect): number {
    const intersectLeft = Math.max(rect1.left, rect2.left);
    const intersectTop = Math.max(rect1.top, rect2.top);
    const intersectRight = Math.min(rect1.right, rect2.right);
    const intersectBottom = Math.min(rect1.bottom, rect2.bottom);

    if (intersectRight < intersectLeft || intersectBottom < intersectTop) {
        return 0.0; // No intersection
    }

    const intersectArea = (intersectRight - intersectLeft) * (intersectBottom - intersectTop);
    const area1 = rect1.width * rect1.height;
    const area2 = rect2.width * rect2.height;
    const unionArea = area1 + area2 - intersectArea;

    return unionArea > 0 ? intersectArea / unionArea : 0.0;
}

/**
 * Check if rect1 is fully contained within rect2.
 */
export function isFullyContained(rect1: Rect, rect2: Rect): boolean {
    return (
        rect1.left >= rect2.left &&
        rect1.right <= rect2.right &&
        rect1.top >= rect2.top &&
        rect1.bottom <= rect2.bottom
    );
}

/**
 * Filter overlapping elements based on IoU, containment, and weight.
 * @param elements - Array of elements to filter.
 * @param iouThreshold - IoU threshold for overlap.
 * @returns Filtered array of elements.
 */
export function filterOverlappingElements(
    elements: InteractiveElement[],
    iouThreshold: number = 0.7
): InteractiveElement[] {
    if (!elements || elements.length === 0) {
        return [];
    }

    // Sort by area (descending), then by weight (descending)
    elements.sort((a, b) => {
        const areaA = a.rect.width * a.rect.height;
        const areaB = b.rect.width * b.rect.height;
        if (areaB !== areaA) {
            return areaB - areaA; // Larger area first
        }
        return b.weight - a.weight; // Higher weight first
    });

    const filteredElements: InteractiveElement[] = [];
    const removedIndices = new Set<number>(); // Keep track of elements to remove later

    for (let i = 0; i < elements.length; i++) {
        if (removedIndices.has(i)) continue; // Skip if already marked for removal

        const current = elements[i];
        let shouldAdd = true;

        for (let j = i + 1; j < elements.length; j++) {
            if (removedIndices.has(j)) continue;

            const existing = elements[j]; // Compare against elements later in the sorted list

            const iou = calculateIou(current.rect, existing.rect);

            if (iou > iouThreshold) {
                // High overlap: remove the element with lower weight (or smaller area if weights equal)
                // Since we sorted, 'current' has higher priority (larger area or weight)
                removedIndices.add(j);
                continue; // Move to the next element to compare against
            }

            // Check containment
            if (isFullyContained(existing.rect, current.rect)) {
                 // 'existing' is inside 'current'. Remove 'existing' as 'current' has higher priority.
                 removedIndices.add(j);
                 continue;
            }
            if (isFullyContained(current.rect, existing.rect)) {
                // 'current' is inside 'existing'. Since 'current' has higher priority,
                // we should remove 'existing' IF 'current' isn't significantly smaller.
                const currentArea = current.rect.width * current.rect.height;
                const existingArea = existing.rect.width * existing.rect.height;
                // Python logic: remove existing if current is >= 50% of existing size
                if (currentArea >= existingArea * 0.5) {
                     removedIndices.add(j);
                     // Don't break here, continue checking 'current' against others
                } else {
                    // 'current' is small and contained, discard 'current'
                    shouldAdd = false;
                    break; // Stop comparing 'current'
                }
            }
        }

        if (shouldAdd) {
            filteredElements.push(current);
        }
    }

    // The logic above might be slightly different from the Python one due to iteration order.
    // Let's refine based on the Python logic's apparent intent:
    // Sort by area desc, weight desc.
    // Iterate and keep track of elements to keep.
    // For each element, compare with already *kept* elements.

    const finalFiltered: InteractiveElement[] = [];
    elements.forEach(current => {
        let overlapsExisting = false;
        for (let i = finalFiltered.length - 1; i >= 0; i--) {
            const existing = finalFiltered[i];
            const iou = calculateIou(current.rect, existing.rect);

            if (iou > iouThreshold) {
                // High overlap with an already kept element. Since current has lower or equal priority,
                // discard current.
                overlapsExisting = true;
                break;
            }

            if (isFullyContained(current.rect, existing.rect)) {
                 // Current is inside an already kept element. Discard current.
                 overlapsExisting = true;
                 break;
            }

            if (isFullyContained(existing.rect, current.rect)) {
                // An already kept element is inside current. Remove the kept element.
                // This happens because current has higher priority (came earlier in sort).
                finalFiltered.splice(i, 1);
                // Continue checking against other kept elements
            }
        }

        if (!overlapsExisting) {
            finalFiltered.push(current);
        }
    });


    return finalFiltered;
}

/**
 * Sort elements by position (top-to-bottom, left-to-right) and assign indices.
 * @param elements - Array of elements to sort.
 * @returns Sorted array of elements with updated indices.
 */
export function sortElementsByPosition(elements: InteractiveElement[]): InteractiveElement[] {
    if (!elements || elements.length === 0) {
        return [];
    }

    const ROW_THRESHOLD = 20; // Pixels to consider elements in the same row

    // Sort primarily by top position, then by left position
    elements.sort((a, b) => {
        const yDiff = a.rect.top - b.rect.top;
        if (Math.abs(yDiff) > ROW_THRESHOLD) {
            return yDiff; // Different rows
        }
        // Within the same row (or close enough), sort by left position
        return a.rect.left - b.rect.left;
    });

    // Re-assign indices based on the sorted order
    return elements.map((element, index) => ({
        ...element,
        index: index,
    }));
}

/**
 * Combine browser elements and CV elements, filter duplicates/overlaps, and sort.
 * @param browserElements - Elements detected via browser JS.
 * @param cvElements - Elements detected via CV (mocked or real).
 * @param iouThreshold - IoU threshold for filtering.
 * @returns Combined, filtered, and sorted array of elements.
 */
export function combineAndFilterElements(
    browserElements: InteractiveElement[],
    cvElements: InteractiveElement[],
    iouThreshold: number = 0.7
): InteractiveElement[] {
    // Combine elements
    const allElements = [...browserElements, ...cvElements];

    // Filter overlapping elements
    const filtered = filterOverlappingElements(allElements, iouThreshold);

    // Sort elements by position and assign final indices
    const sortedElements = sortElementsByPosition(filtered);

    return sortedElements;
}
