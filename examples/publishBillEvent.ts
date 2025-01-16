import { EventBridgeClient } from '@aws-sdk/client-eventbridge';
import { ConsoleLogger } from '../generated/typescript/common';
import { EventBridgePublisher } from '../generated/typescript/eventBridgePublisher';
import billEvent from './billApprovedEvent.json';

// Initialize AWS SDK and logger
const eventBridgeClient = new EventBridgeClient({
  region: process.env.AWS_REGION || 'us-west-2'
});
const logger = new ConsoleLogger();

// Initialize the publisher
const publisher = new EventBridgePublisher(
  eventBridgeClient,
  logger,
  process.env.EVENT_BUS_NAME || 'default',
  'com.homebound.bills',
  'BillApprovedEvent'
);

async function publishEvent() {
  try {
    logger.info('Publishing bill event', { billId: billEvent.bill.billId });
    await publisher.publish(billEvent);
    logger.info('Successfully published bill event');
  } catch (error) {
    logger.error('Failed to publish bill event', error as Error);
    throw error;
  }
}

// Run the publisher
publishEvent().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});
