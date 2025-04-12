import { InteractiveElement } from './models.js';

/**
 * Highlight interactive elements on a screenshot
 */
export function putHighlightElementsOnScreenshot(
  elements: Record<number, InteractiveElement>, 
  screenshotB64: string
): string {
  try {
    // In TypeScript version, we'll use HTML Canvas for image manipulation
    // This needs to be run in a browser or Node.js with canvas library
    
    // For this implementation, we would need to:
    // 1. Convert base64 to Image
    // 2. Create canvas and draw the image
    // 3. Draw rectangles and labels for each element
    // 4. Convert back to base64
    
    // This is a simplified placeholder - in a full implementation,
    // you would use a library like node-canvas or handle this in browser context
    console.log(`Highlighting ${Object.keys(elements).length} elements on screenshot`);
    
    // For now, return the original screenshot
    // In a complete implementation, you would return the highlighted screenshot
    return screenshotB64;
  } catch (e) {
    console.error("Failed to add highlights to screenshot:", e);
    return screenshotB64;
  }
}

/**
 * Scale a base64 encoded image
 */
export function scaleB64Image(imageB64: string, scaleFactor: number): string {
  // Similar to putHighlightElementsOnScreenshot, this would need 
  // canvas manipulation in a browser or node-canvas in Node.js
  
  // For this simplified implementation, we return the original image
  return imageB64;
}

/**
 * Calculate Intersection over Union between two rectangles
 */
export function calculateIOU(rect1: Record<string, number>, rect2: Record<string, number>): number {
  // Calculate intersection
  const intersectLeft = Math.max(rect1.left, rect2.left);
  const intersectTop = Math.max(rect1.top, rect2.top);
  const intersectRight = Math.min(rect1.right, rect2.right);
  const intersectBottom = Math.min(rect1.bottom, rect2.bottom);
  
  // Check if intersection exists
  if (intersectRight < intersectLeft || intersectBottom < intersectTop) {
    return 0.0;  // No intersection
  }
  
  // Calculate area of each rectangle
  const area1 = (rect1.right - rect1.left) * (rect1.bottom - rect1.top);
  const area2 = (rect2.right - rect2.left) * (rect2.bottom - rect2.top);
  
  // Calculate area of intersection
  const intersectionArea = (intersectRight - intersectLeft) * (intersectBottom - intersectTop);
  
  // Calculate union area
  const unionArea = area1 + area2 - intersectionArea;
  
  // Calculate IoU
  return unionArea > 0 ? intersectionArea / unionArea : 0.0;
}

/**
 * Check if rect1 is fully contained within rect2
 */
export function isFullyContained(rect1: Record<string, number>, rect2: Record<string, number>): boolean {
  return (
    rect1.left >= rect2.left &&
    rect1.right <= rect2.right &&
    rect1.top >= rect2.top &&
    rect1.bottom <= rect2.bottom
  );
}

/**
 * Filter overlapping elements using weight and IoU
 */
export function filterOverlappingElements(
  elements: InteractiveElement[], 
  iouThreshold: number = 0.7
): InteractiveElement[] {
  if (!elements || elements.length === 0) {
    return [];
  }
  
  // Sort by area (descending), then by weight (descending)
  const sortedElements = [...elements].sort((a, b) => {
    const areaA = a.rect.width * a.rect.height;
    const areaB = b.rect.width * b.rect.height;
    
    if (areaB !== areaA) {
      return areaB - areaA; // Descending by area
    }
    return b.weight - a.weight; // Descending by weight
  });
  
  const filteredElements: InteractiveElement[] = [];
  
  // Add elements one by one, checking against already added elements
  for (const current of sortedElements) {
    let shouldAdd = true;
    
    // Convert rect object to format needed by IOU calculation
    const currentRect = {
      left: current.rect.x,
      top: current.rect.y,
      right: current.rect.x + current.rect.width,
      bottom: current.rect.y + current.rect.height
    };
    
    // For each element already in our filtered list
    for (let i = 0; i < filteredElements.length; i++) {
      const existing = filteredElements[i];
      
      // Convert rect object to format needed by IOU calculation
      const existingRect = {
        left: existing.rect.x,
        top: existing.rect.y,
        right: existing.rect.x + existing.rect.width,
        bottom: existing.rect.y + existing.rect.height
      };
      
      // Check overlap with IoU
      const iou = calculateIOU(currentRect, existingRect);
      if (iou > iouThreshold) {
        shouldAdd = false;
        break;
      }
      
      // Check if current element is fully contained within an existing element with higher weight
      if (isFullyContained(currentRect, existingRect)) {
        if (existing.weight >= current.weight && existing.zIndex === current.zIndex) {
          shouldAdd = false;
          break;
        } else {
          // If current element has higher weight and is more than 50% of the size of the existing element, remove the existing element
          const currentArea = current.rect.width * current.rect.height;
          const existingArea = existing.rect.width * existing.rect.height;
          
          if (currentArea >= existingArea * 0.5) {
            filteredElements.splice(i, 1);
            break;
          }
        }
      }
    }
    
    if (shouldAdd) {
      filteredElements.push(current);
    }
  }
  
  return filteredElements;
}

/**
 * Sort elements by position (top to bottom, left to right)
 */
export function sortElementsByPosition(elements: InteractiveElement[]): InteractiveElement[] {
  if (!elements || elements.length === 0) {
    return [];
  }
  
  // Define what "same row" means
  const ROW_THRESHOLD = 20;  // pixels
  
  // First, group elements into rows based on Y position
  const rows: InteractiveElement[][] = [];
  let currentRow: InteractiveElement[] = [];
  
  // Copy and sort elements by Y position
  const sortedByY = [...elements].sort((a, b) => a.rect.y - b.rect.y);
  
  // Group into rows
  for (const element of sortedByY) {
    if (currentRow.length === 0) {
      // Start a new row
      currentRow.push(element);
    } else {
      // Check if this element is in the same row as the previous ones
      const lastElement = currentRow[currentRow.length - 1];
      if (Math.abs(element.rect.y - lastElement.rect.y) <= ROW_THRESHOLD) {
        // Same row
        currentRow.push(element);
      } else {
        // New row
        rows.push([...currentRow]);
        currentRow = [element];
      }
    }
  }
  
  // Add the last row if not empty
  if (currentRow.length > 0) {
    rows.push([...currentRow]);
  }
  
  // Sort each row by X position (left to right)
  for (const row of rows) {
    row.sort((a, b) => a.rect.x - b.rect.x);
  }
  
  // Flatten the rows back into a single array
  const sortedElements: InteractiveElement[] = rows.flatMap(row => row);
  
  // Update indices
  for (let i = 0; i < sortedElements.length; i++) {
    sortedElements[i].index = i;
  }
  
  return sortedElements;
}

/**
 * Combine browser elements and CV elements and filter duplicates
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
  
  // Sort elements by position
  const sortedElements = sortElementsByPosition(filtered);
  
  return sortedElements;
}