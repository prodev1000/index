import { readFileSync } from "fs";
import { join } from "path";

/**
 * Load a demo image as base64
 * @param filename - The name of the image file
 * @returns Base64 encoded image string
 */
export function loadDemoImageAsB64(filename: string): string {
  try {
    // Calculate the path to the demo image
    const imagePath = join(__dirname, "demo_images", filename);

    // Read the file and convert to base64
    const imageBuffer = readFileSync(imagePath);
    return imageBuffer.toString("base64");
  } catch (error) {
    console.error(`Error loading demo image ${filename}:`, error);
    return "";
  }
}
