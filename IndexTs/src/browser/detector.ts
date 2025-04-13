// src/browser/detector.ts
import { InteractiveElement } from './models';

/**
 * Simple computer vision detection result interface
 */
interface CVDetection {
    box: [number, number, number, number]; // [x1, y1, x2, y2]
    class_name: string;
    confidence: number;
}

/**
 * Detector class for element detection using computer vision.
 * This mock implementation generates fake elements for testing.
 */
export class Detector {
    private cvModelEndpoint?: string;
    private sheetsModelEndpoint?: string;

    /**
     * Create a new Detector instance
     * 
     * @param cvModelEndpoint - Optional endpoint for CV model
     * @param sheetsModelEndpoint - Optional endpoint for sheet detection model
     */
    constructor(cvModelEndpoint?: string, sheetsModelEndpoint?: string) {
        this.cvModelEndpoint = cvModelEndpoint;
        this.sheetsModelEndpoint = sheetsModelEndpoint;
    }

    /**
     * Detect elements from an image
     * 
     * @param imageB64 - Base64 encoded image data
     * @param detectSheets - Whether to detect spreadsheet elements
     * @returns Array of detected interactive elements
     */
    async detectFromImage(imageB64: string, detectSheets: boolean = false): Promise<InteractiveElement[]> {
        // If we had real CV endpoints, this would call those services
        // For now, we'll mock the functionality similar to the Python version
        if (detectSheets) {
            return this._generateSheetElements();
        } else {
            return this._generateCVElements();
        }
    }

    /**
     * Generate mock CV elements
     * @private
     */
    private _generateCVElements(): InteractiveElement[] {
        try {
            // Generate a random number of mock elements (3-8)
            const numElements = Math.floor(Math.random() * 6) + 3;
            console.log(`Generating ${numElements} mock CV elements`);

            const elements: InteractiveElement[] = [];
            const imageWidth = 800;
            const imageHeight = 600;

            for (let i = 0; i < numElements; i++) {
                // Generate random box dimensions
                const x1 = Math.floor(Math.random() * (imageWidth - 100)) + 10;
                const y1 = Math.floor(Math.random() * (imageHeight - 100)) + 10;
                const width = Math.floor(Math.random() * 150) + 50;
                const height = Math.floor(Math.random() * 70) + 30;
                const x2 = Math.min(x1 + width, imageWidth);
                const y2 = Math.min(y1 + height, imageHeight);

                // Create unique ID for the CV detection
                const indexId = `cv-${i}`;

                // Create element
                const element: InteractiveElement = {
                    index: i,
                    browser_agent_id: indexId,
                    tag_name: 'element',
                    text: '',
                    attributes: {},
                    weight: 1,
                    viewport: {
                        x: Math.round(x1),
                        y: Math.round(y1),
                        width: Math.round(width),
                        height: Math.round(height)
                    },
                    page: {
                        x: Math.round(x1),
                        y: Math.round(y1),
                        width: Math.round(width),
                        height: Math.round(height)
                    },
                    center: {
                        x: Math.round(x1 + width/2),
                        y: Math.round(y1 + height/2)
                    },
                    input_type: null,
                    rect: {
                        left: Math.round(x1),
                        top: Math.round(y1),
                        right: Math.round(x2),
                        bottom: Math.round(y2),
                        width: Math.round(width),
                        height: Math.round(height)
                    },
                    z_index: 0
                };

                elements.push(element);
            }

            console.log(`Created ${elements.length} mock interactive elements`);
            return elements;
        } catch (error) {
            console.error(`Error generating mock CV elements: ${error}`);
            return [];
        }
    }

    /**
     * Generate mock sheet elements (grid-like)
     * @private
     */
    private _generateSheetElements(): InteractiveElement[] {
        try {
            // Generate grid-like elements for sheets
            console.log("Generating mock sheet elements");

            const elements: InteractiveElement[] = [];
            const imageWidth = 800;
            const imageHeight = 600;

            // Create a grid of cells (5x8)
            const rows = 5;
            const cols = 8;
            const cellWidth = imageWidth / cols;
            const cellHeight = imageHeight / rows;

            let index = 0;
            for (let row = 0; row < rows; row++) {
                for (let col = 0; col < cols; col++) {
                    const x1 = col * cellWidth;
                    const y1 = row * cellHeight;
                    const x2 = (col + 1) * cellWidth;
                    const y2 = (row + 1) * cellHeight;
                    const width = cellWidth;
                    const height = cellHeight;

                    // Create element
                    const element: InteractiveElement = {
                        index: index,
                        browser_agent_id: `cell-${row}-${col}`,
                        tag_name: 'cell',
                        text: '',
                        attributes: {},
                        weight: 1,
                        viewport: {
                            x: Math.round(x1),
                            y: Math.round(y1),
                            width: Math.round(width),
                            height: Math.round(height)
                        },
                        page: {
                            x: Math.round(x1),
                            y: Math.round(y1),
                            width: Math.round(width),
                            height: Math.round(height)
                        },
                        center: {
                            x: Math.round(x1 + width/2),
                            y: Math.round(y1 + height/2)
                        },
                        input_type: null,
                        rect: {
                            left: Math.round(x1),
                            top: Math.round(y1),
                            right: Math.round(x2),
                            bottom: Math.round(y2),
                            width: Math.round(width),
                            height: Math.round(height)
                        },
                        z_index: 0
                    };

                    elements.push(element);
                    index++;
                }
            }

            console.log(`Created ${elements.length} mock sheet elements`);
            return elements;
        } catch (error) {
            console.error(`Error generating mock sheet elements: ${error}`);
            return [];
        }
    }
}
