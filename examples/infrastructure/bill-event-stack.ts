import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as path from 'path';

export class BillEventStack extends cdk.Stack {
  constructor(scope: cdk.App, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Create Lambda function for handling approved bills
    const billApprovedEventLambda = new lambda.Function(this, 'BillApprovedEventLambda', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'billApprovedEventConsumerLambda.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, 'dist')), // Use the bundled code
      timeout: cdk.Duration.seconds(30),
      environment: {
        NODE_ENV: 'production'
      },
      description: 'Handles approved bill events from EventBridge'
    });

    // Create EventBridge rule
    const eventBus = events.EventBus.fromEventBusName(
      this, 
      'ExistingEventBus',
      process.env.EVENT_BUS_NAME || 'homebound-events'
    );

    const rule = new events.Rule(this, 'BillApprovedEventRule', {
      eventBus,
      ruleName: 'bill-approved-event-rule',
      description: 'Rule for handling approved bill events',
      eventPattern: {
        source: [process.env.EVENT_SOURCE || 'homebound.bills'],
        detailType: ['BillApprovedEvent']
      },
      targets: [new targets.LambdaFunction(billApprovedEventLambda)]
    });

    // Grant EventBridge permission to invoke Lambda
    billApprovedEventLambda.addPermission('AllowEventBridge', {
      principal: new iam.ServicePrincipal('events.amazonaws.com'),
      sourceArn: rule.ruleArn
    });
  }
}
