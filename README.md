# Schema Registry with AWS EventBridge Integration

A powerful schema registry application that generates code bindings from OpenAPI 3.0 schemas with AWS EventBridge integration support.

> ⚠️ **Important Note**: The Python code generation is currently under development and not functional. Please use only the TypeScript implementation for now. The Python support will be added in future releases.

## Features

- OpenAPI 3.0 schema validation and parsing
- Code generation for TypeScript _(Python support coming soon)_
- AWS EventBridge integration
- Zod validation with detailed error messages
- ISO 8601 date/time validation
- Generated code includes:
  - Interfaces/Models
  - Strong type definitions
  - Runtime validators with Zod
  - AWS EventBridge Publishers
  - AWS EventBridge Consumers
  - Error handling utilities
  - Logging infrastructure

## Project Structure

```
schema-registry/
├── src/                      # Source code
│   ├── cli/                  # Command line interface
│   ├── generators/           # Code generators
│   │   ├── typescript/       # TypeScript code generation
│   │   └── python/          # Python code generation
│   └── utils/               # Shared utilities
├── schemas/                  # OpenAPI schema files
├── generated/                # Generated code output
├── examples/                 # Example schemas and usage
└── tests/                   # Test files
```

## Prerequisites

- Node.js >= 18
- AWS CLI configured (if using EventBridge)

## Installation

```bash
# Install dependencies
npm install
```

> Note: The `requirements.txt` and Python-related setup will be needed once Python support is implemented.

## Usage

### Basic Usage

```bash
# Generate TypeScript code
ts-node src/cli/index.ts generate \
  --schema ./schemas/api.yaml \
  --output ./generated \
  --language typescript

# Generate both TypeScript and Python
ts-node src/cli/index.ts generate \
  --schema ./schemas/api.yaml \
  --output ./generated \
  --language both
```

### Advanced Options

```bash
# With custom log level
LOG_LEVEL=DEBUG ts-node src/cli/index.ts generate \
  --schema ./schemas/api.yaml \
  --output ./generated \
  --language typescript \
  --log-level DEBUG

# Without EventBridge integration
ts-node src/cli/index.ts generate \
  --schema ./schemas/api.yaml \
  --output ./generated \
  --language typescript \
  --include-eventbridge false
```

## Generated Code

### TypeScript

The generator creates the following TypeScript files:

- `models.ts`: Type definitions and interfaces
- `validator.ts`: Zod schemas and validation functions
- `marshaller.ts`: JSON serialization/deserialization
- `eventBridgePublisher.ts`: AWS EventBridge integration
- `eventBridgeConsumer.ts`: Lambda function handlers
- `common.ts`: Shared utilities and types

### Python (Coming Soon)

The Python code generation is under development. Once implemented, it will generate:

- `models.py`: Pydantic models
- `validator.py`: Data validation
- `marshaller.py`: JSON handling
- `event_bridge.py`: AWS EventBridge integration

> Note: Python support is not yet functional. Please use TypeScript for now.

## Runtime Validation with Zod

This project uses [Zod](https://github.com/colinhacks/zod) for runtime type validation. Zod is a TypeScript-first schema declaration and validation library that ensures your data matches its expected shape at runtime.

### Why Zod?

1. **Type Safety**: Zod provides both compile-time and runtime type checking. The TypeScript compiler ensures type safety during development, while Zod validates data at runtime.

2. **Schema Definition**: Zod allows you to define schemas that exactly match your TypeScript types, eliminating the need to maintain separate type definitions and validation logic.

3. **Detailed Error Messages**: When validation fails, Zod provides detailed error messages that help pinpoint exactly what went wrong.

4. **Automatic Type Inference**: TypeScript can automatically infer types from Zod schemas, reducing code duplication.

### Example Usage

Here's how Zod validation works in our generated code:

```typescript
// Generated Zod schema
export const BillEventSchema = z.object({
  bill: z.object({
    billId: z.string(),
    billNumber: z.string(),
    billStatus: z.string(),
    totalAmountInCents: z.number(),
    billDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format')
  }),
  project: z.object({
    projectId: z.string(),
    projectName: z.string()
  }),
  eventMetadata: z.object({
    idempotencyKey: z.string(),
    eventTimeStamp: z.string().datetime()
  })
});

// Using the validator
try {
  // This will throw if the data doesn't match the schema
  const validatedEvent = BillEventSchema.parse(incomingData);
  
  // TypeScript knows the exact shape of validatedEvent
  console.log(validatedEvent.bill.totalAmountInCents); // Type-safe access
} catch (error) {
  if (error instanceof z.ZodError) {
    // Detailed error messages
    console.error('Validation failed:', error.errors);
    // Example output:
    // [
    //   {
    //     path: ['bill', 'totalAmountInCents'],
    //     message: 'Expected number, received string',
    //     code: 'invalid_type'
    //   }
    // ]
  }
}
```

### Benefits in Our Event System

1. **Data Integrity**: Ensures that events conform to their schema before being published to EventBridge.
2. **Early Error Detection**: Catches data issues before they reach AWS services.
3. **Self-Documenting**: The schema serves as both documentation and runtime validation.
4. **Type Safety**: Provides TypeScript types that are guaranteed to match the runtime validation.

### Integration with EventBridge

The generated EventBridge publishers automatically validate events using Zod before publishing:

```typescript
class BillEventPublisher {
  async publishEvent(event: BillEvent): Promise<void> {
    // Validates the event structure
    BillEventSchema.parse(event);
    
    // If validation passes, proceed with publishing
    await this.eventBridgeClient.send(new PutEventsCommand({
      Entries: [{
        EventBusName: this.eventBusName,
        Source: this.eventSource,
        DetailType: 'BillEvent',
        Detail: JSON.stringify(event)
      }]
    }));
  }
}
```

This ensures that only valid events matching your OpenAPI schema make it to your event bus.

## Date/Time Handling

The generator enforces strict ISO 8601 format validation:

- **Date-only fields**: `YYYY-MM-DD`
  ```typescript
  billDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, {
    message: "Must be a valid ISO 8601 date (YYYY-MM-DD)"
  })
  ```

- **DateTime fields**: `YYYY-MM-DDThh:mm:ss.sssZ` (UTC)
  ```typescript
  eventTimeStamp: z.string().datetime({
    message: "Must be a valid ISO 8601 UTC datetime (YYYY-MM-DDThh:mm:ss.sssZ)"
  })
  ```

## Error Handling

The generated code includes comprehensive error handling:

```typescript
try {
  const validated = BillSchema.parse(rawData);
} catch (error) {
  if (error instanceof z.ZodError) {
    console.error('Validation failed:', error.errors);
    // Detailed error messages per field
  }
}
```

## Logging

Built-in structured logging with multiple levels:

```typescript
const logger = new ConsoleLogger(LogLevel.DEBUG);
logger.info('Processing event', { eventId: '123' });
logger.error('Failed to process', error, { eventId: '123' });
```

## Development

```bash
# Install dependencies
npm install

# Run tests
npm test

# Run linting
npm run lint

# Build TypeScript
npm run build
```

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

MIT

## Support

For support, please open an issue in the GitHub repository.
