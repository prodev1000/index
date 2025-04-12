import fs from "fs";
import path from "path";
import {
  SageMakerRuntime,
  InvokeEndpointCommand,
  InvokeEndpointCommandInput,
} from "@aws-sdk/client-sagemaker-runtime";
import pino from "pino";
import { InteractiveElement, InteractiveElementSchema } from "./models.js";

const logger = pino({ name: "detector" });

/**
 * CV Detection result from AWS SageMaker
 */
interface CVDetection {
  box: [number, number, number, number]; // [x1, y1, x2, y2]
  className: string;
  confidence: number;
}

/**
 * Response format from the SageMaker endpoint
 */
interface DetectionResponse {
  detections: {
    box: [number, number, number, number];
    class_name: string;
    confidence: number;
  }[];
}

/**
 * AWS SageMaker-based detector for computer vision element detection
 */
export class Detector {
  private cvEndpointName: string;
  private sheetsEndpointName: string;
  private region: string;
  private client: SageMakerRuntime;

  /**
   * Initialize the detector with a SageMaker endpoint.
   *
   * @param cvEndpointName - Name of the CV SageMaker endpoint
   * @param sheetsEndpointName - Name of the sheets SageMaker endpoint
   * @param region - AWS region for the endpoint
   */
  constructor(
    cvEndpointName: string,
    sheetsEndpointName: string,
    region: string = "us-east-1"
  ) {
    this.cvEndpointName = cvEndpointName;
    this.sheetsEndpointName = sheetsEndpointName;
    this.region = region;
    this.client = new SageMakerRuntime({ region: this.region });
  }

  /**
   * Send a base64 encoded image to SageMaker for detection and return parsed InteractiveElement objects.
   *
   * @param imageB64 - Base64 encoded image
   * @param detectSheets - Whether to detect sheets elements
   * @returns List of InteractiveElement objects created from CV detections
   */
  async detectFromImage(
    imageB64: string,
    detectSheets: boolean = false
  ): Promise<InteractiveElement[]> {
    try {
      if (detectSheets) {
        return await this.callSheetsEndpoint(imageB64);
      } else {
        return await this.callCVEndpoint(imageB64);
      }
    } catch (error) {
      logger.error({ error }, "Error detecting from image");
      return this.retryDetection(imageB64, detectSheets, 1, 3);
    }
  }

  /**
   * Retry detection with exponential backoff
   */
  private async retryDetection(
    imageB64: string,
    detectSheets: boolean,
    attempt: number,
    maxAttempts: number
  ): Promise<InteractiveElement[]> {
    if (attempt >= maxAttempts) {
      logger.error(`Failed detection after ${maxAttempts} attempts`);
      return [];
    }

    const delayMs = 500 * Math.pow(2, attempt - 1); // Exponential backoff
    logger.info(
      `Retrying detection (attempt ${
        attempt + 1
      }/${maxAttempts}) after ${delayMs}ms`
    );

    await new Promise((resolve) => setTimeout(resolve, delayMs));

    try {
      if (detectSheets) {
        return await this.callSheetsEndpoint(imageB64);
      } else {
        return await this.callCVEndpoint(imageB64);
      }
    } catch (error) {
      logger.error({ error, attempt }, "Error in retry attempt");
      return this.retryDetection(
        imageB64,
        detectSheets,
        attempt + 1,
        maxAttempts
      );
    }
  }

  /**
   * Call the CV endpoint and return the detections
   */
  private async callCVEndpoint(
    imageB64: string
  ): Promise<InteractiveElement[]> {
    try {
      // Prepare the request
      const command = new InvokeEndpointCommand({
        EndpointName: this.cvEndpointName,
        ContentType: "application/json",
        Body: JSON.stringify({
          image: imageB64,
          conf: 0.5,
        }),
      });

      // Call the endpoint
      const response = await this.client.send(command);

      // Parse the response
      const responseBody = Buffer.from(response.Body as Uint8Array).toString(
        "utf-8"
      );
      const detectionResult = JSON.parse(responseBody) as DetectionResponse;

      logger.info(
        `Received detection results with ${
          detectionResult.detections?.length || 0
        } detections`
      );

      // Parse detections into InteractiveElement objects
      const elements: InteractiveElement[] = [];
      const predictions = detectionResult.detections || [];

      for (let i = 0; i < predictions.length; i++) {
        const pred = predictions[i];
        const box = pred.box || [0, 0, 0, 0];

        const [x1, y1, x2, y2] = box;
        const width = x2 - x1;
        const height = y2 - y1;

        // Create unique ID for the CV detection
        const indexId = `cv-${i}`;

        // Create element
        const element = InteractiveElementSchema.parse({
          index: i,
          browserAgentId: indexId,
          tagName: "element",
          text: "",
          attributes: {},
          weight: 1,
          viewport: {
            x: Math.round(x1),
            y: Math.round(y1),
            width: Math.round(width),
            height: Math.round(height),
          },
          page: {
            x: Math.round(x1),
            y: Math.round(y1),
            width: Math.round(width),
            height: Math.round(height),
          },
          center: {
            x: Math.round(x1 + width / 2),
            y: Math.round(y1 + height / 2),
          },
          inputType: null,
          rect: {
            x: Math.round(x1),
            y: Math.round(y1),
            width: Math.round(width),
            height: Math.round(height),
          },
          zIndex: 0,
        });

        elements.push(element);
      }

      logger.info(
        `Created ${elements.length} interactive elements from CV detections`
      );
      return elements;
    } catch (error) {
      logger.error({ error }, "Error detecting from image in CV endpoint");
      throw error;
    }
  }

  /**
   * Call the sheets endpoint and return the detections
   */
  private async callSheetsEndpoint(
    imageB64: string
  ): Promise<InteractiveElement[]> {
    logger.info("Calling sheets endpoint with image_b64");

    try {
      // Prepare the request
      const command = new InvokeEndpointCommand({
        EndpointName: this.sheetsEndpointName,
        ContentType: "application/json",
        Body: JSON.stringify({
          image: imageB64,
        }),
      });

      // Call the endpoint
      const response = await this.client.send(command);

      // Parse the response
      const responseBody = Buffer.from(response.Body as Uint8Array).toString(
        "utf-8"
      );
      const detectionResult = JSON.parse(responseBody) as DetectionResponse;

      logger.info(
        `Received detection result from SageMaker with ${
          detectionResult.detections?.length || 0
        } detections`
      );

      // Parse detections into InteractiveElement objects
      const elements: InteractiveElement[] = [];
      const predictions = detectionResult.detections || [];

      for (let i = 0; i < predictions.length; i++) {
        const pred = predictions[i];
        const box = pred.box || [0, 0, 0, 0];

        const [x1, y1, x2, y2] = box;
        const width = x2 - x1;
        const height = y2 - y1;

        // Create element
        const element = InteractiveElementSchema.parse({
          index: i,
          browserAgentId: pred.class_name,
          tagName: pred.class_name,
          text: "",
          attributes: {},
          weight: 1,
          viewport: {
            x: Math.round(x1),
            y: Math.round(y1),
            width: Math.round(width),
            height: Math.round(height),
          },
          page: {
            x: Math.round(x1),
            y: Math.round(y1),
            width: Math.round(width),
            height: Math.round(height),
          },
          center: {
            x: Math.round(x1 + width / 2),
            y: Math.round(y1 + height / 2),
          },
          inputType: null,
          rect: {
            x: Math.round(x1),
            y: Math.round(y1),
            width: Math.round(width),
            height: Math.round(height),
          },
          zIndex: 0,
        });

        elements.push(element);
      }

      logger.info(
        `Created ${elements.length} interactive elements from sheets detections`
      );
      return elements;
    } catch (error) {
      logger.error({ error }, "Error detecting from image in sheets endpoint");
      throw error;
    }
  }
}
