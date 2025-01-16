import { config } from 'dotenv';
import { BillEvent } from '../generated/typescript/models';
import { BillEventSchema } from '../generated/typescript/validator';
import { Marshaller } from '../generated/typescript/marshaller';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { ConsoleLogger } from '../generated/typescript/common';
import * as fs from 'fs';
import * as path from 'path';

// Load environment variables from root .env file
const envPath = path.join(__dirname, '..', '.env');
console.log('Loading .env file from:', envPath);

// Force override of any existing environment variables
const result = config({ 
  path: envPath,
  override: true 
});

if (result.error) {
  throw new Error(`Error loading .env file from ${envPath}: ${result.error}`);
}

// Double check the file contents
const envFileContents = fs.readFileSync(envPath, 'utf8');
console.log('Actual .env file contents:', envFileContents);

console.log('Environment variables after loading:', {
  EVENT_BUS_NAME: process.env.EVENT_BUS_NAME,
  EVENT_SOURCE: process.env.EVENT_SOURCE,
  ENV_PATH: envPath
});

// Verify that required environment variables are loaded
const requiredEnvVars = ['AWS_REGION', 'EVENT_BUS_NAME', 'EVENT_SOURCE'];
for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    throw new Error(`Required environment variable ${envVar} is not set in ${envPath}`);
  }
}

// Initialize logger and marshaller
const logger = new ConsoleLogger();
const marshaller = new Marshaller(logger);

/**
 * Handles publishing bill approved events to EventBridge
 */
class BillApprovedEventPublisher {
  private eventBridgeClient: EventBridgeClient;
  private readonly eventBusName: string;
  private readonly eventSource: string;
  private logger: ConsoleLogger;

  constructor() {
    // Validate required environment variables are still available at runtime
    if (!process.env.AWS_REGION) throw new Error('AWS_REGION is required');
    if (!process.env.EVENT_BUS_NAME) throw new Error('EVENT_BUS_NAME is required');
    if (!process.env.EVENT_SOURCE) throw new Error('EVENT_SOURCE is required');

    console.log('Constructor environment variables:', {
      EVENT_BUS_NAME: process.env.EVENT_BUS_NAME,
      EVENT_SOURCE: process.env.EVENT_SOURCE
    });

    this.logger = new ConsoleLogger();
    this.eventBridgeClient = new EventBridgeClient({
      region: process.env.AWS_REGION,
      profile: process.env.AWS_PROFILE
    });
    
    // Store the environment variables
    this.eventBusName = process.env.EVENT_BUS_NAME;
    this.eventSource = process.env.EVENT_SOURCE;

    console.log('Initialized with values:', {
      eventBusName: this.eventBusName,
      eventSource: this.eventSource
    });
    
    this.logger.info('Initialized BillApprovedEventPublisher', {
      region: process.env.AWS_REGION,
      eventBusName: this.eventBusName,
      eventSource: this.eventSource
    });
  }

  /**
   * Validates the event before publishing
   * @param event The event to validate
   * @throws Error if the event is invalid
   */
  private validateEvent(event: BillEvent): void {
    try {
      BillEventSchema.parse(event);
      if (event.bill.billStatus !== 'APPROVED') {
        throw new Error('Bill status must be APPROVED');
      }
    } catch (error) {
      throw new Error(`Invalid event structure: ${error}`);
    }
  }

  /**
   * Generates an idempotency key for the event
   * @param bill - The bill object
   * @returns The idempotency key
   */
  private generateIdempotencyKey(bill: any): string {
    return bill.billId;
  }

  /**
   * Publishes a bill approved event to EventBridge
   * @param event - The event to publish
   * @throws Error if publishing fails
   */
  async publishEvent(event: BillEvent): Promise<void> {
    try {
      this.logger.info('Publishing bill approved event', { 
        billId: event.bill.billId,
        idempotencyKey: this.generateIdempotencyKey(event.bill)
      });

      // Validate the event
      this.validateEvent(event);

      // Add metadata
      event.eventMetadata = {
        idempotencyKey: this.generateIdempotencyKey(event.bill),
        correlationId: '',  
        eventTimeStamp: new Date().toISOString(),
        schemaVersion: '1.0'
      };

      // Marshal the event
      const marshalledEvent = await marshaller.marshalBillEvent(event);

      // Create the EventBridge event
      const eventEntry = {
        EventBusName: this.eventBusName,
        Source: this.eventSource,
        DetailType: 'BillApprovedEvent',
        Detail: marshalledEvent, 
        Time: new Date()
      };

      this.logger.info('Sending event to EventBridge', { 
        eventBusName: this.eventBusName,
        source: this.eventSource,
        detailType: 'BillApprovedEvent',
        billId: event.bill.billId
      });

      console.log('Sending event to EventBridge:', JSON.stringify(eventEntry, null, 2));

      // Send the event to EventBridge
      const command = new PutEventsCommand({
        Entries: [eventEntry]
      });

      const response = await this.eventBridgeClient.send(command);
      console.log('EventBridge response:', JSON.stringify(response, null, 2));

      // Check for errors in the response
      if (response.FailedEntryCount && response.FailedEntryCount > 0) {
        const error = response.Entries?.[0];
        throw new Error(`Failed to publish event: ${error?.ErrorCode} - ${error?.ErrorMessage}`);
      }

      if (!response.Entries?.[0]?.EventId) {
        throw new Error('Failed to get event ID from EventBridge response');
      }

      this.logger.info('Successfully published bill approved event', {
        billId: event.bill.billId,
        eventId: response.Entries[0].EventId
      });
    } catch (error) {
      this.logger.error('Failed to publish bill approved event', error as Error);
      throw error;
    }
  }
}

// Example usage
async function main() {
  const publisher = new BillApprovedEventPublisher();

  try {
    // Read the event from JSON file
    const eventData = fs.readFileSync(
      path.join(__dirname, 'billApprovedEvent.json'),
      'utf-8'
    );
    const event: BillEvent = JSON.parse(eventData);

    // Add current timestamp to event metadata
    event.eventMetadata.eventTimeStamp = new Date().toISOString();
    if (event.approval) {
      event.approval.approvalDate = new Date().toISOString();
    }

    await publisher.publishEvent(event);
    console.log('Successfully published bill approved event:', { 
      billId: event.bill.billId 
    });
  } catch (error) {
    console.error('Failed to publish bill approved event:', error);
  }
}

// Run the publisher if this file is run directly
if (require.main === module) {
  main();
}
