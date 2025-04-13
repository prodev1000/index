// src/agent/utils.ts
import * as fs from 'fs';
import * as path from 'path';
import { scaleB64Image } from '@/browser/utils';

/**
 * Load an image from the demo_images directory and return it as a base64 string.
 * Works reliably whether the package is used directly or as a library.
 * 
 * @param imageName - Name of the image file (including extension)
 * @returns Base64 encoded string of the image
 */
export async function loadDemoImageAsB64(imageName: string): Promise<string> {
    try {
        // Using path.join to reliably find package data
        const imgPath = path.join(__dirname, 'demo_images', imageName);
        const imgBuffer = fs.readFileSync(imgPath);
        const b64 = imgBuffer.toString('base64');
        return await scaleB64Image(b64, 0.85);
    } catch (error) {
        console.error(`Failed to load demo image ${imageName}: ${error}`);
        return '';
    }
}
