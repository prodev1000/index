// src/browser/models.ts
import { z } from 'zod';

// Schema for basic coordinates
export const CoordinatesSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number().optional(),
  height: z.number().optional(),
});
export type Coordinates = z.infer<typeof CoordinatesSchema>;

// Schema for rectangle (used in elements)
export const RectSchema = z.object({
    left: z.number(),
    top: z.number(),
    right: z.number(),
    bottom: z.number(),
    width: z.number(),
    height: z.number(),
});
export type Rect = z.infer<typeof RectSchema>;

// Schema for an interactive element found on the page
export const InteractiveElementSchema = z.object({
  index: z.number(),
  browser_agent_id: z.string(), // Unique ID assigned by the JS script
  tag_name: z.string(),
  text: z.string(),
  attributes: z.record(z.string()), // Dictionary of attributes
  viewport: CoordinatesSchema, // Position relative to the viewport
  page: CoordinatesSchema, // Position relative to the full page
  center: CoordinatesSchema, // Center coordinates
  weight: z.number(), // Weight for filtering overlaps (currently static)
  input_type: z.string().optional().nullable(), // Input type if applicable
  rect: RectSchema, // Bounding rectangle
  z_index: z.number(),
});
export type InteractiveElement = z.infer<typeof InteractiveElementSchema>;

// Schema for browser tab information
export const TabInfoSchema = z.object({
  page_id: z.number(),
  url: z.string(),
  title: z.string(),
});
export type TabInfo = z.infer<typeof TabInfoSchema>;

// Schema for the browser viewport information
export const ViewportSchema = z.object({
  width: z.number().default(1024),
  height: z.number().default(768),
  scroll_x: z.number().default(0),
  scroll_y: z.number().default(0),
  device_pixel_ratio: z.number().default(1),
  scroll_distance_above_viewport: z.number().default(0),
  scroll_distance_below_viewport: z.number().default(0),
});
export type Viewport = z.infer<typeof ViewportSchema>;

// Schema for the data returned by the element finding script
export const InteractiveElementsDataSchema = z.object({
  viewport: ViewportSchema,
  elements: z.array(InteractiveElementSchema),
});
export type InteractiveElementsData = z.infer<typeof InteractiveElementsDataSchema>;

// Schema for the overall browser state
export const BrowserStateSchema = z.object({
  url: z.string(),
  tabs: z.array(TabInfoSchema),
  viewport: ViewportSchema.default({}),
  screenshot_with_highlights: z.string().optional().nullable(),
  screenshot: z.string().optional().nullable(), // Base64 encoded PNG
  interactive_elements: z.record(z.number(), InteractiveElementSchema).default({}), // Map from index to element
});
export type BrowserState = z.infer<typeof BrowserStateSchema>;

// Custom Error class for Browser specific errors
export class BrowserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BrowserError';
  }
}

export class URLNotAllowedError extends BrowserError {
  constructor(message: string) {
    super(message);
    this.name = 'URLNotAllowedError';
  }
}
