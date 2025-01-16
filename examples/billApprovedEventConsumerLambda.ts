import { Context, EventBridgeEvent } from 'aws-lambda';
import { BillEvent } from '../generated/typescript/models';
import { BillEventSchema } from '../generated/typescript/validator';
import { Marshaller } from '../generated/typescript/marshaller';
import { ConsoleLogger } from '../generated/typescript/common';

const logger = new ConsoleLogger();
const marshaller = new Marshaller(logger);

/**
 * Lambda function to handle approved bill events from EventBridge
 */
export const handler = async (
  event: EventBridgeEvent<'BillApprovedEvent', any>,
  context: Context
): Promise<void> => {
  try {
    logger.info('Received bill approved event', { eventId: event.id });

    // Unmarshal and validate the event
    const billEvent = await marshaller.unmarshalBillEvent(JSON.stringify(event.detail));
    BillEventSchema.parse(billEvent);

    if (billEvent.bill.billStatus !== 'APPROVED') {
      logger.warn('Received non-approved bill event, ignoring', {
        billId: billEvent.bill.billId,
        status: billEvent.bill.billStatus
      });
      return;
    }

    // Process the approved bill
    logger.info('Processing approved bill', { 
      billId: billEvent.bill.billId,
      amount: billEvent.bill.totalAmountInCents,
      approvalDate: billEvent.approval?.approvalDate
    });

    // Add your business logic here for approved bills
    // For example:
    // - Send notification
    // - Update database
    // - Trigger payment processing
    // - etc.

  } catch (error) {
    logger.error('Failed to process approved bill event', error as Error);
    throw error;
  }
};
