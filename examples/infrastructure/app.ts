import * as cdk from 'aws-cdk-lib';
import { BillEventStack } from './bill-event-stack';
import { config } from 'dotenv';
import * as path from 'path';

// Load environment variables
config({ path: path.join(__dirname, '..', '.env') });

const app = new cdk.App();
new BillEventStack(app, 'BillEventStack', {
  env: {
    account: '721427272662', // Your AWS account ID
    region: process.env.AWS_REGION || 'us-west-2'
  },
  description: 'Stack for processing bill events from EventBridge'
});
