# Bill Event Examples

This directory contains example implementations of a bill event producer and consumer using the generated schema registry code.

## Prerequisites

Before running the examples, make sure you have:

1. AWS credentials configured with appropriate permissions
2. Node.js and npm installed
3. AWS CDK CLI installed (`npm install -g aws-cdk`)

## Setup

1. Install dependencies:
```bash
npm install dotenv @aws-sdk/client-eventbridge
```

2. Create a `.env` file to setup your AWS configuration:
```env
# AWS Configuration
AWS_REGION=us-west-2
AWS_PROFILE=dev-PowerUser

# EventBridge Configuration
EVENT_BUS_NAME=homebound-events
EVENT_SOURCE=com.homebound.bp.bills
```

3. Ensure you're logged in to AWS SSO:
```bash
aws sso login --profile homebound-dev
```

## Infrastructure Setup

The infrastructure is defined using AWS CDK in the `infrastructure` directory. To deploy:

```bash
cd infrastructure
npm install
npm run deploy
```

This will create:
- A Lambda function to process approved bill events
- An EventBridge rule that routes approved bill events to the Lambda function

## Running the Examples

### Producer
The producer demonstrates how to publish approved bill events to EventBridge:

```bash
npx ts-node billApprovedEventPublisher.ts
```

### Consumer (Lambda)
The consumer is implemented as a Lambda function that processes approved bill events. To test the consumer:

1. First, deploy the infrastructure if you haven't already:
   ```bash
   cd infrastructure
   npm run deploy
   ```

2. Send a test event using the publisher:
   ```bash
   npx ts-node billApprovedEventPublisher.ts
   ```

3. View the Lambda execution results:
   - Go to AWS Console
   - Navigate to CloudWatch Logs
   - Find the log group `/aws/lambda/BillEventStack-BillApprovedEventLambda-*`
   - Check the latest log stream for event processing details

The Lambda function will:
- Validate the incoming event schema
- Confirm it's an approved bill event
- Process the bill details
- Log the processing results to CloudWatch

## Code Structure

### Producer (`bill-event-producer.ts`)
- Uses the generated `Marshaller` to validate and serialize events
- Publishes events to AWS EventBridge using AWS SSO profile
- Loads example events from `billApprovedEvent.json`

### Consumer (`bill-event-consumer.ts`)
- Uses the generated `EventBridgeConsumer` to handle and validate incoming events
- Demonstrates event type-specific handling
- Includes error handling and logging

## Best Practices
1. Always use AWS SSO profiles for authentication
2. Store configuration in environment variables
3. Validate events using the generated schemas
4. Handle errors appropriately
5. Log important operations and errors
6. Use type-safe event handling
