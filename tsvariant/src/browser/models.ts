import { z } from "zod";

// Define Zod schemas for validation (equivalent to Pydantic models)
export const TabInfoSchema = z.object({
  pageId: z.number(),
  url: z.string(),
  title: z.string(),
});

export const CoordinatesSchema = z.object({
  x: z.number().int(),
  y: z.number().int(),
  width: z.number().int().optional(),
  height: z.number().int().optional(),
});

export const InteractiveElementSchema = z.object({
  index: z.number().int(),
  tagName: z.string(),
  text: z.string(),
  attributes: z.record(z.string()),
  viewport: CoordinatesSchema,
  page: CoordinatesSchema,
  center: CoordinatesSchema,
  weight: z.number(),
  browserAgentId: z.string(),
  inputType: z.string().optional(),
  rect: z.record(z.number().int()),
  zIndex: z.number().int(),
});

export const ViewportSchema = z.object({
  width: z.number().int().default(1024),
  height: z.number().int().default(768),
  scrollX: z.number().int().default(0),
  scrollY: z.number().int().default(0),
  devicePixelRatio: z.number().default(1),
  scrollDistanceAboveViewport: z.number().int().default(0),
  scrollDistanceBelowViewport: z.number().int().default(0),
});

export const InteractiveElementsDataSchema = z.object({
  viewport: ViewportSchema,
  elements: z.array(InteractiveElementSchema),
});

// TypeScript types derived from Zod schemas
export type TabInfo = z.infer<typeof TabInfoSchema>;
export type Coordinates = z.infer<typeof CoordinatesSchema>;
export type InteractiveElement = z.infer<typeof InteractiveElementSchema>;
export type Viewport = z.infer<typeof ViewportSchema>;
export type InteractiveElementsData = z.infer<
  typeof InteractiveElementsDataSchema
>;

// Custom error classes
export class BrowserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BrowserError";
    // This ensures the prototype chain is maintained properly
    Object.setPrototypeOf(this, BrowserError.prototype);
  }
}

export class URLNotAllowedError extends BrowserError {
  constructor(message: string) {
    super(message);
    this.name = "URLNotAllowedError";
    Object.setPrototypeOf(this, URLNotAllowedError.prototype);
  }
}

// Browser state class
export class BrowserState {
  url: string;
  tabs: TabInfo[];
  viewport: Viewport;
  screenshotWithHighlights: string | null;
  screenshot: string | null;
  interactiveElements: Record<number, InteractiveElement>;

  constructor(
    url: string,
    tabs: TabInfo[],
    viewport: Viewport = ViewportSchema.parse({}),
    screenshotWithHighlights: string | null = null,
    screenshot: string | null = null,
    interactiveElements: Record<number, InteractiveElement> = {}
  ) {
    this.url = url;
    this.tabs = tabs;
    this.viewport = viewport;
    this.screenshotWithHighlights = screenshotWithHighlights;
    this.screenshot = screenshot;
    this.interactiveElements = interactiveElements;
  }
}
