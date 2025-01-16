import { OpenAPIV3 } from 'openapi-types';
import SwaggerParser from '@apidevtools/swagger-parser';
import path from 'path';
import fs from 'fs';
import { ILogger, ConsoleLogger } from '../../utils/logger';
import { GeneratorError, GeneratorErrorCode } from '../../utils/errors';

/**
 * Options for TypeScript code generation
 */
export interface TypeScriptGeneratorOptions {
  /** Path to the OpenAPI schema file */
  schemaPath: string;
  /** Output directory for generated code */
  outputDir: string;
  /** Whether to generate EventBridge integration code. Defaults to true */
  includeEventBridge?: boolean;
  /** Optional logger instance. If not provided, uses ConsoleLogger */
  logger?: ILogger;
}

/**
 * Generator for TypeScript code from OpenAPI schemas
 */
export class TypeScriptGenerator {
  private schema?: OpenAPIV3.Document;
  private outputDir: string = '';
  private includeEventBridge: boolean = true;
  private logger: ILogger;

  /**
   * Creates a new TypeScript generator instance
   * @param options - Generator options
   */
  constructor(options?: { logger?: ILogger }) {
    this.logger = options?.logger || new ConsoleLogger();
  }

  /**
   * Initializes the generator with the provided options
   * @param options - Generator options
   * @throws {GeneratorError} If schema parsing or validation fails
   */
  async initialize(options: TypeScriptGeneratorOptions) {
    try {
      this.logger.info('Initializing TypeScript generator', { 
        schemaPath: options.schemaPath,
        outputDir: options.outputDir 
      });

      this.outputDir = options.outputDir;
      this.includeEventBridge = options.includeEventBridge ?? true;

      // Ensure output directory exists
      fs.mkdirSync(this.outputDir, { recursive: true });
      this.logger.debug('Created output directory', { dir: this.outputDir });

      // Parse and validate schema
      this.schema = await SwaggerParser.parse(options.schemaPath) as OpenAPIV3.Document;
      await this.validateSchema();
      
      this.logger.info('Successfully initialized generator');
    } catch (error) {
      this.logger.error('Failed to initialize generator', error as Error);
      throw new GeneratorError(
        GeneratorErrorCode.INITIALIZATION_ERROR,
        'Failed to initialize generator',
        error as Error
      );
    }
  }

  /**
   * Validates the loaded OpenAPI schema for required components and structure
   * @throws {GeneratorError} If schema validation fails
   */
  private async validateSchema() {
    if (!this.schema) {
      throw new GeneratorError(
        GeneratorErrorCode.SCHEMA_ERROR,
        'Schema not initialized'
      );
    }

    // Validate schema has required components
    if (!this.schema.components?.schemas) {
      throw new GeneratorError(
        GeneratorErrorCode.SCHEMA_ERROR,
        'Schema must contain components.schemas section'
      );
    }

    // Validate each schema has required fields
    for (const [name, schema] of Object.entries(this.schema.components.schemas)) {
      if (!('type' in schema)) {
        throw new GeneratorError(
          GeneratorErrorCode.SCHEMA_ERROR,
          `Schema '${name}' must have a type`
        );
      }
    }
  }

  /**
   * Generates all TypeScript code files from the OpenAPI schema
   * @throws {GeneratorError} If code generation fails
   */
  async generate(): Promise<void> {
    try {
      this.logger.info('Starting code generation');
      
      if (!this.schema) {
        throw new GeneratorError(
          GeneratorErrorCode.SCHEMA_ERROR,
          'Schema not initialized'
        );
      }

      // Generate and write files
      await this.generateAndWriteFile('models.ts', this.generateInterfaces());
      await this.generateAndWriteFile('validator.ts', this.generateValidator());
      await this.generateAndWriteFile('marshaller.ts', this.generateMarshaller());
      await this.generateAndWriteFile('common.ts', this.generateCommon());

      if (this.includeEventBridge) {
        await this.generateAndWriteFile(
          'eventBridgePublisher.ts',
          this.generateEventBridgePublisher(
            this.schema.info?.title || 'DefaultEventBus',
            this.schema.info?.title || 'DefaultSource',
            'Event'
          )
        );
        await this.generateAndWriteFile(
          'eventBridgeConsumer.ts',
          this.generateEventBridgeConsumer()
        );
      }

      this.logger.info('Successfully generated all code files');
    } catch (error) {
      this.logger.error('Failed to generate code', error as Error);
      throw new GeneratorError(
        GeneratorErrorCode.GENERATION_ERROR,
        'Failed to generate code',
        error as Error
      );
    }
  }

  /**
   * Generates and writes a single TypeScript file
   * @param filename - Name of the file to write
   * @param contentPromise - Promise or string containing the file content
   * @throws {GeneratorError} If file writing fails
   */
  private async generateAndWriteFile(filename: string, contentPromise: Promise<string> | string): Promise<void> {
    try {
      const content = await contentPromise;
      const filePath = path.join(this.outputDir, filename);
      fs.writeFileSync(filePath, content);
      this.logger.debug('Generated file', { filename });
    } catch (error) {
      throw new GeneratorError(
        GeneratorErrorCode.FILE_WRITE_ERROR,
        `Failed to write file: ${filename}`,
        error as Error
      );
    }
  }

  /**
   * Converts an OpenAPI schema type to a Zod validator
   * @param schema - OpenAPI schema object
   * @returns Zod validator as a string
   * @throws {GeneratorError} If type generation fails
   */
  private getZodType(schema: OpenAPIV3.SchemaObject): string {
    if ('$ref' in schema) {
      const refPath = schema.$ref;
      if (typeof refPath !== 'string') {
        throw new GeneratorError(
          GeneratorErrorCode.SCHEMA_ERROR,
          'Invalid $ref value in schema'
        );
      }
      const refName = refPath.split('/').pop();
      return `${refName}Schema`;
    }

    let baseType = '';

    if (schema.type === 'string') {
      if (schema.format === 'date') {
        baseType = 'z.string().regex(/^\\d{4}-\\d{2}-\\d{2}$/, { message: "Must be a valid ISO 8601 date (YYYY-MM-DD)" }).transform((val) => new Date(val))';
      } else if (schema.format === 'date-time') {
        baseType = 'z.string().datetime({ message: "Must be a valid ISO 8601 UTC datetime (YYYY-MM-DDThh:mm:ss.sssZ)" }).transform((val) => new Date(val))';
      } else if (schema.enum) {
        baseType = `z.enum([${schema.enum.map(e => `'${e}'`).join(', ')}])`;
      } else {
        baseType = 'z.string()';
      }
    } else if (schema.type === 'number' || schema.type === 'integer') {
      baseType = schema.type === 'integer' ? 'z.number().int()' : 'z.number()';
    } else if (schema.type === 'boolean') {
      baseType = 'z.boolean()';
    } else if (schema.type === 'array') {
      if (!schema.items) {
        throw new GeneratorError(
          GeneratorErrorCode.SCHEMA_ERROR,
          'Array schema must have items'
        );
      }
      baseType = `z.array(${this.getZodType(schema.items as OpenAPIV3.SchemaObject)})`;
    } else if (schema.type === 'object') {
      if (!schema.properties) {
        baseType = 'z.object({})';
      } else {
        const required = schema.required || [];
        const props = Object.entries(schema.properties)
          .map(([name, prop]) => {
            const propSchema = prop as OpenAPIV3.SchemaObject;
            let type = this.getZodType(propSchema);
            
            // Handle nullable fields first
            if (propSchema.nullable) {
              type = `${type}.nullable()`;
            }
            
            // Then handle optional fields
            if (!required.includes(name)) {
              type = `${type}.optional()`;
            }
            
            return `    ${name}: ${type}`;
          })
          .join(',\n');
        baseType = `z.object({\n${props}\n  })`;
      }
    }

    if (!baseType) {
      this.logger.warn('Unknown schema type, defaulting to any', { schema });
      baseType = 'z.any()';
    }

    return baseType;
  }

  /**
   * Helper to check if a schema depends on another
   * @param schema - Schema to check
   * @param targetName - Name of schema to check dependency against
   * @returns True if schema depends on target
   */
  private hasDependency(schema: OpenAPIV3.SchemaObject | OpenAPIV3.ReferenceObject, targetName: string): boolean {
    if ('$ref' in schema) {
      return schema.$ref.endsWith(`/${targetName}`);
    }

    if ('properties' in schema) {
      return Object.values(schema.properties || {}).some(prop => this.hasDependency(prop as OpenAPIV3.SchemaObject, targetName));
    }

    if ('items' in schema) {
      return this.hasDependency(schema.items as OpenAPIV3.SchemaObject, targetName);
    }

    return false;
  }

  /**
   * Generates the validator code for the OpenAPI schema
   * @returns Validator code as a string
   */
  private generateValidator(): string {
    if (!this.schema?.components?.schemas) {
      throw new GeneratorError(
        GeneratorErrorCode.SCHEMA_ERROR,
        'Schema must contain components.schemas section'
      );
    }

    let output = `import { z } from 'zod';
import * as models from './models';
import { SchemaRegistryError, SchemaRegistryErrorCode, ILogger } from './common';

`;

    // Helper to check if a schema depends on another
    const hasDependency = (schema: OpenAPIV3.SchemaObject | OpenAPIV3.ReferenceObject, targetName: string): boolean => {
      if ('$ref' in schema) {
        const refName = schema.$ref.split('/').pop();
        return refName === targetName;
      }
      if ('properties' in schema) {
        return Object.values(schema.properties || {}).some(prop => hasDependency(prop as OpenAPIV3.SchemaObject, targetName));
      }
      if ('items' in schema) {
        return hasDependency(schema.items as OpenAPIV3.SchemaObject, targetName);
      }
      return false;
    };

    // Sort schemas by dependency
    const schemas = Object.entries(this.schema.components.schemas);
    const sortedSchemas = schemas.sort(([nameA, schemaA], [nameB, schemaB]) => {
      if (hasDependency(schemaA, nameB)) return 1;
      if (hasDependency(schemaB, nameA)) return -1;
      return 0;
    });

    // Generate schemas in dependency order
    for (const [name, schema] of sortedSchemas) {
      output += `export const ${name}Schema = z.object({\n`;
      if ('properties' in schema) {
        for (const [propName, propSchema] of Object.entries(schema.properties || {})) {
          const isRequired = schema.required?.includes(propName) || false;
          const isNullable = (propSchema as OpenAPIV3.SchemaObject).nullable || false;
          let zodType = this.getZodType(propSchema as OpenAPIV3.SchemaObject);
          
          // Handle nullable fields first
          if (isNullable) {
            zodType = `${zodType}.nullable()`;
          }
          
          // Then handle optional fields
          if (!isRequired) {
            zodType = `${zodType}.optional()`;
          }
          
          output += `  ${propName}: ${zodType},\n`;
        }
      }
      output += `});\n\n`;
    }

    return output;
  }

  /**
   * Generates the marshaller code for the OpenAPI schema
   * @returns Marshaller code as a string
   */
  private generateMarshaller(): string {
    if (!this.schema?.components?.schemas) {
      throw new GeneratorError(
        GeneratorErrorCode.SCHEMA_ERROR,
        'Schema must contain components.schemas section'
      );
    }

    let output = `import { z } from 'zod';
import * as models from './models';
import * as validator from './validator';
import { SchemaRegistryError, SchemaRegistryErrorCode, ILogger } from './common';

export class Marshaller {
  private logger: ILogger;

  constructor(logger: ILogger) {
    this.logger = logger;
  }

`;

    // Generate marshal methods for each model
    for (const [name, schema] of Object.entries(this.schema.components.schemas)) {
      // Generate marshal method
      output += `  /**
   * Marshal a ${name} to JSON string
   * @param event - The event to marshal
   * @returns JSON string representation of the event
   * @throws {SchemaRegistryError} If validation fails
   */
  marshal${name}(event: models.${name}): string {
    try {
      this.logger.debug('Marshalling ${name}', { event });

      // Validate the event
      validator.${name}Schema.parse(event);

      // Convert to JSON string
      const json = JSON.stringify(event);

      this.logger.debug('Successfully marshalled ${name}');
      return json;
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw new SchemaRegistryError(
          SchemaRegistryErrorCode.VALIDATION_ERROR,
          \`Invalid ${name} structure: \${error.errors}\`,
          error
        );
      }
      throw new SchemaRegistryError(
        SchemaRegistryErrorCode.MARSHALLING_ERROR,
        \`Failed to marshal ${name}: \${error instanceof Error ? error.message : 'Unknown error'}\`,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Unmarshal a JSON string to a ${name}
   * @param json - The JSON string to unmarshal
   * @returns The unmarshalled event
   * @throws {SchemaRegistryError} If validation fails
   */
  unmarshal${name}(json: string): models.${name} {
    try {
      this.logger.debug('Unmarshalling ${name}', { json });

      // Parse JSON string
      const event = JSON.parse(json) as models.${name};

      // Validate the event
      validator.${name}Schema.parse(event);

      this.logger.debug('Successfully unmarshalled ${name}');
      return event;
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw new SchemaRegistryError(
          SchemaRegistryErrorCode.VALIDATION_ERROR,
          \`Invalid ${name} structure: \${error.errors}\`,
          error
        );
      }
      if (error instanceof SyntaxError) {
        throw new SchemaRegistryError(
          SchemaRegistryErrorCode.UNMARSHALLING_ERROR,
          \`Invalid JSON string: \${error.message}\`,
          error
        );
      }
      throw new SchemaRegistryError(
        SchemaRegistryErrorCode.UNMARSHALLING_ERROR,
        \`Failed to unmarshal ${name}: \${error instanceof Error ? error.message : 'Unknown error'}\`,
        error instanceof Error ? error : undefined
      );
    }
  }\n\n`;
    }

    output += '}\n';
    return output;
  }

  /**
   * Generates the EventBridge publisher code for the OpenAPI schema
   * @param eventBusName - Name of the event bus
   * @param eventSource - Source of the events
   * @param detailType - Type of the event details
   * @returns EventBridge publisher code as a string
   */
  private generateEventBridgePublisher(
    eventBusName: string,
    eventSource: string,
    detailType: string
  ): string {
    // Get the root model name from the schema
    const rootSchema = this.getRootSchema();
    const modelName = rootSchema.name;
    const apiTitle = this.schema?.info?.title || 'Event API';

    let output = `import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import * as models from './models';
import { Marshaller } from './marshaller';
import * as validator from './validator';
import { SchemaRegistryError, SchemaRegistryErrorCode, ILogger } from './common';

/**
 * Publisher class for sending events to EventBridge
 */
export class EventBridgePublisher {
  private eventBridgeClient: EventBridgeClient;
  private logger: ILogger;
  private readonly eventBusName: string;
  private readonly eventSource: string;
  private readonly detailType: string;

  constructor(
    eventBridgeClient: EventBridgeClient,
    logger: ILogger,
    eventBusName: string = '${apiTitle}',
    eventSource: string = '${apiTitle}',
    detailType: string = '${modelName}'
  ) {
    this.eventBridgeClient = eventBridgeClient;
    this.logger = logger;
    this.eventBusName = eventBusName;
    this.eventSource = eventSource;
    this.detailType = detailType;
  }

  /**
   * Publish a ${modelName} to EventBridge
   * @param detail - The ${modelName} to publish
   * @returns Promise that resolves when the event is published
   * @throws {SchemaRegistryError} If validation, marshalling, or publishing fails
   */
  async publish(detail: models.${modelName}): Promise<void> {
    try {
      this.logger.debug('Publishing event to EventBridge', { 
        type: '${modelName}',
        detail 
      });
      
      // Validate the event detail
      validator.${modelName}Schema.parse(detail);

      // Marshal the event detail
      const detailJson = new Marshaller(this.logger).marshal${modelName}(detail);

      const command = new PutEventsCommand({
        Entries: [
          {
            EventBusName: this.eventBusName,
            Source: this.eventSource,
            DetailType: this.detailType,
            Detail: detailJson,
          },
        ],
      });

      await this.eventBridgeClient.send(command);
      this.logger.debug('Successfully published event to EventBridge', {
        type: '${modelName}'
      });
    } catch (error) {
      if (error instanceof SchemaRegistryError) {
        throw error;
      }
      throw new SchemaRegistryError(
        SchemaRegistryErrorCode.MARSHALLING_ERROR,
        \`Failed to publish ${modelName} to EventBridge: \${error instanceof Error ? error.message : 'Unknown error'}\`,
        error instanceof Error ? error : undefined
      );
    }
  }
}\n`;

    return output;
  }

  /**
   * Generates the EventBridge consumer code for the OpenAPI schema
   * @returns EventBridge consumer code as a string
   */
  private generateEventBridgeConsumer(): string {
    const rootSchema = this.getRootSchema();
    const modelName = rootSchema.name;
    const apiTitle = this.schema?.info?.title || 'Event API';

    let output = `import { Context, EventBridgeEvent } from 'aws-lambda';
import * as models from './models';
import { Marshaller } from './marshaller';
import { SchemaRegistryError, SchemaRegistryErrorCode, ILogger } from './common';

/**
 * Consumer class for handling events from EventBridge
 */
export class EventBridgeConsumer {
  private logger: ILogger;
  private marshaller: Marshaller;

  constructor(logger: ILogger) {
    this.logger = logger;
    this.marshaller = new Marshaller(logger);
  }

  /**
   * Handle an EventBridge event
   * @param event - The event from EventBridge
   * @param context - Lambda context
   * @returns Promise that resolves when event is handled
   * @throws {SchemaRegistryError} If validation or unmarshalling fails
   */
  async handleEvent(
    event: EventBridgeEvent<string, any>,
    context: Context
  ): Promise<void> {
    try {
      this.logger.debug('Handling EventBridge event', { 
        eventId: event.id,
        detailType: event['detail-type']
      });

      // Unmarshal and validate the event
      const detail = await this.marshaller.unmarshal${modelName}(
        JSON.stringify(event.detail)
      );

      // Handle the event based on detail-type
      switch (event['detail-type']) {
        default:
          this.logger.warn('Unknown event type', { 
            detailType: event['detail-type']
          });
      }
    } catch (error) {
      if (error instanceof SchemaRegistryError) {
        throw error;
      }
      throw new SchemaRegistryError(
        SchemaRegistryErrorCode.UNMARSHALLING_ERROR,
        \`Failed to handle EventBridge event: \${error instanceof Error ? error.message : 'Unknown error'}\`,
        error instanceof Error ? error : undefined
      );
    }
  }
}\n`;

    return output;
  }

  /**
   * Get the root schema from the OpenAPI document
   * @returns The root schema and its name
   */
  private getRootSchema(): { schema: OpenAPIV3.SchemaObject; name: string } {
    if (!this.schema?.components?.schemas) {
      throw new GeneratorError(
        GeneratorErrorCode.SCHEMA_ERROR,
        'Schema must contain components.schemas section'
      );
    }

    // Find the root schema - it should be referenced in a path
    const paths = this.schema.paths || {};
    for (const [_, pathItem] of Object.entries(paths)) {
      const post = (pathItem as OpenAPIV3.PathItemObject).post;
      if (post?.requestBody) {
        const content = (post.requestBody as OpenAPIV3.RequestBodyObject).content;
        const schema = content['application/json']?.schema;
        if (schema && '$ref' in schema) {
          const refParts = schema.$ref.split('/');
          const name = refParts[refParts.length - 1];
          const rootSchema = this.schema.components.schemas[name];
          if (rootSchema && !('$ref' in rootSchema)) {
            return { schema: rootSchema, name };
          }
        }
      }
    }

    // If no root schema found in paths, use the first schema as root
    const [name, schema] = Object.entries(this.schema.components.schemas)[0];
    if (!('$ref' in schema)) {
      return { schema, name };
    }

    throw new GeneratorError(
      GeneratorErrorCode.SCHEMA_ERROR,
      'Could not determine root schema'
    );
  }

  /**
   * Generates the interfaces code for the OpenAPI schema
   * @returns Promise that resolves to the generated interfaces
   */
  private async generateInterfaces(): Promise<string> {
    if (!this.schema) {
      throw new GeneratorError(
        GeneratorErrorCode.SCHEMA_ERROR,
        'Schema is not initialized'
      );
    }

    let output = `/**
 * This file is auto-generated. Do not edit manually.
 */

`;

    // Generate interfaces for each schema
    for (const [name, schema] of Object.entries(this.schema.components?.schemas || {})) {
      if ('properties' in schema) {
        output += this.generateInterface(name, schema);
      }
    }

    return output;
  }

  /**
   * Generates a TypeScript interface for a schema
   * @param name - Name of the interface
   * @param schema - Schema to generate interface from
   * @returns Generated interface code
   */
  private generateInterface(name: string, schema: OpenAPIV3.SchemaObject): string {
    const properties = schema.properties || {};
    const required = schema.required || [];
    const description = schema.description ? `/** ${schema.description} */\n` : '';

    let interfaceContent = `${description}export interface ${name} {\n`;

    // Generate properties
    for (const [propName, propSchema] of Object.entries(properties)) {
      const type = this.getTypeScriptType(propSchema as OpenAPIV3.SchemaObject);
      const isRequired = required.includes(propName);
      const propDescription = (propSchema as OpenAPIV3.SchemaObject).description
        ? `  /** ${(propSchema as OpenAPIV3.SchemaObject).description} */\n`
        : '';

      interfaceContent += propDescription;
      interfaceContent += `  ${propName}${isRequired ? '' : '?'}: ${type};\n`;
    }

    interfaceContent += '}\n\n';
    return interfaceContent;
  }

  /**
   * Get the TypeScript type for a schema
   * @param schema - Schema to get type for
   * @returns TypeScript type
   */
  private getTypeScriptType(schema: OpenAPIV3.SchemaObject): string {
    // Handle date formats first
    if (schema.format === 'date-time' || schema.format === 'date') {
      return 'Date';
    }

    if (schema.format === 'uuid') {
      return 'string';
    }

    switch (schema.type) {
      case 'string':
        if (schema.enum) {
          return schema.enum.map(e => `'${e}'`).join(' | ');
        }
        return 'string';
      case 'number':
      case 'integer':
        return 'number';
      case 'boolean':
        return 'boolean';
      case 'array':
        if (schema.items) {
          const itemType = this.getTypeScriptType(schema.items as OpenAPIV3.SchemaObject);
          return `${itemType}[]`;
        }
        return 'any[]';
      case 'object':
        if (schema.additionalProperties) {
          const valueType = typeof schema.additionalProperties === 'boolean'
            ? 'any'
            : this.getTypeScriptType(schema.additionalProperties as OpenAPIV3.SchemaObject);
          return `Record<string, ${valueType}>`;
        }
        if (schema.properties) {
          return this.generateInlineInterface(schema);
        }
        return 'Record<string, any>';
      default:
        return 'any';
    }
  }

  /**
   * Generate an inline TypeScript interface for a schema
   * @param schema - Schema to generate interface from
   * @returns Generated interface code
   */
  private generateInlineInterface(schema: OpenAPIV3.SchemaObject): string {
    const properties = schema.properties || {};
    const required = schema.required || [];

    let interfaceContent = '{\n';

    // Generate properties
    for (const [propName, propSchema] of Object.entries(properties)) {
      const propType = this.getTypeScriptType(propSchema as OpenAPIV3.SchemaObject);
      const isRequired = required.includes(propName);
      interfaceContent += `    ${propName}${isRequired ? '' : '?'}: ${propType};\n`;
    }

    interfaceContent += '  }';
    return interfaceContent;
  }

  /**
   * Generate common code (error types, etc.)
   * @returns Generated common code
   */
  private generateCommon(): string {
    return `/**
 * This file is auto-generated. Do not edit manually.
 */

import { z } from 'zod';

/**
 * Logger interface for schema registry operations
 */
export interface ILogger {
  debug(message: string, ...args: any[]): void;
  info(message: string, ...args: any[]): void;
  warn(message: string, ...args: any[]): void;
  error(message: string, error?: Error, ...args: any[]): void;
}

/**
 * Console implementation of the logger interface
 */
export class ConsoleLogger implements ILogger {
  debug(message: string, ...args: any[]): void {
    console.debug(message, ...args);
  }

  info(message: string, ...args: any[]): void {
    console.info(message, ...args);
  }

  warn(message: string, ...args: any[]): void {
    console.warn(message, ...args);
  }

  error(message: string, error?: Error, ...args: any[]): void {
    console.error(message, error, ...args);
  }
}

/**
 * Error codes for schema registry operations
 */
export enum SchemaRegistryErrorCode {
  SCHEMA_ERROR = 'SCHEMA_ERROR',
  PARSE_ERROR = 'PARSE_ERROR',
  MARSHALLING_ERROR = 'MARSHALLING_ERROR',
  UNMARSHALLING_ERROR = 'UNMARSHALLING_ERROR',
  VALIDATION_ERROR = 'VALIDATION_ERROR',
}

/**
 * Error class for schema registry operations
 */
export class SchemaRegistryError extends Error {
  constructor(
    public code: SchemaRegistryErrorCode,
    message: string,
    public cause?: Error
  ) {
    super(message);
    this.name = 'SchemaRegistryError';
  }
}\n`;
  }
}
