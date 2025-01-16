#!/usr/bin/env python3

import os
import yaml
from typing import Dict, Any, List
import json

def snake_to_camel(snake_str: str) -> str:
    components = snake_str.split('_')
    return components[0] + ''.join(x.title() for x in components[1:])

def generate_zod_schema(schema: Dict[str, Any], name: str) -> str:
    if 'type' not in schema:
        return f'z.unknown()'

    if schema['type'] == 'object':
        properties = schema.get('properties', {})
        required = schema.get('required', [])
        fields = []
        for prop_name, prop_schema in properties.items():
            is_required = prop_name in required
            if '$ref' in prop_schema:
                ref_name = prop_schema['$ref'].split('/')[-1]
                field_schema = f'{ref_name}Schema'
            else:
                field_schema = generate_zod_schema(prop_schema, f'{name}_{prop_name}')
            
            if is_required:
                fields.append(f'  {prop_name}: {field_schema}')
            else:
                fields.append(f'  {prop_name}: {field_schema}.optional()')
        
        return f'z.object({{\n{",\\n".join(fields)}\n}})'
    
    elif schema['type'] == 'array':
        items_schema = generate_zod_schema(schema['items'], f'{name}_item')
        return f'z.array({items_schema})'
    
    elif schema['type'] == 'string':
        if 'enum' in schema:
            enum_values = [f'"{v}"' for v in schema['enum']]
            return f'z.enum([{", ".join(enum_values)}])'
        elif schema.get('format') == 'date-time':
            return 'z.string().datetime()'
        elif schema.get('format') == 'date':
            return 'z.string()'  # Could add custom validation for date format
        elif schema.get('format') == 'email':
            return 'z.string().email()'
        elif schema.get('format') == 'uuid':
            return 'z.string().uuid()'
        return 'z.string()'
    
    elif schema['type'] == 'integer':
        return 'z.number().int()'
    
    elif schema['type'] == 'boolean':
        return 'z.boolean()'
    
    return 'z.unknown()'

def generate_typescript_interface(schema: Dict[str, Any], name: str) -> str:
    if 'type' not in schema or schema['type'] != 'object':
        return ''

    properties = schema.get('properties', {})
    fields = []
    
    for prop_name, prop_schema in properties.items():
        ts_type = get_typescript_type(prop_schema, f'{name}_{prop_name}')
        description = prop_schema.get('description', '')
        if description:
            fields.append(f'  /** {description} */')
        fields.append(f'  {prop_name}?: {ts_type};')
    
    return f'''/**
 * {schema.get("description", f"Represents a {name}")}
 * @interface {name}
 */
export interface {name} {{
{chr(10).join(fields)}
}}'''

def get_typescript_type(schema: Dict[str, Any], name: str) -> str:
    if '$ref' in schema:
        return schema['$ref'].split('/')[-1]
    
    if 'type' not in schema:
        return 'unknown'

    if schema['type'] == 'object':
        return name
    
    if schema['type'] == 'array':
        item_type = get_typescript_type(schema['items'], f'{name}_item')
        return f'{item_type}[]'
    
    if schema['type'] == 'string':
        if 'enum' in schema:
            return ' | '.join([f'"{v}"' for v in schema['enum']])
        return 'string'
    
    if schema['type'] == 'integer':
        return 'number'
    
    if schema['type'] == 'boolean':
        return 'boolean'
    
    return 'unknown'

def generate_type_guard(name: str) -> str:
    return f'''
// Type guard to check if an object is a valid {name}
// @param obj The object to check
// @returns True if the object is a valid {name}
export function is{name}(obj: any): obj is {name} {{
  try {{
    {name}Schema.parse(obj);
    return true;
  }} catch (error) {{
    return false;
  }}
}}'''

def generate_typescript_bindings(schema_file: str, output_dir: str):
    # Read the OpenAPI schema
    with open(schema_file, 'r') as f:
        openapi_schema = yaml.safe_load(f)

    # Get the schema components
    components = openapi_schema['components']['schemas']

    # Generate models.ts
    models_content = ['/** ISO8601 DateTime string (e.g. "2023-12-18T23:49:38-08:00") */',
                     'export type ISO8601DateTime = string;',
                     '',
                     '/** UUID string */',
                     'export type UUID = string;',
                     '']

    for name, schema in components.items():
        models_content.append(generate_typescript_interface(schema, name))
        models_content.append('')

    for name in components.keys():
        models_content.append(generate_type_guard(name))
        models_content.append('')

    os.makedirs(output_dir, exist_ok=True)
    with open(os.path.join(output_dir, 'models.ts'), 'w') as f:
        f.write('\n'.join(models_content))

    # Generate validator.ts
    validator_content = ['import { z } from "zod";',
                        'import * as models from "./models";',
                        '']

    # First pass to declare all schemas (to handle circular references)
    for name in components.keys():
        validator_content.append(f'export const {name}Schema = z.lazy(() => {generate_zod_schema(components[name], name)});')
        validator_content.append('')

    with open(os.path.join(output_dir, 'validator.ts'), 'w') as f:
        f.write('\n'.join(validator_content))

    # Generate common.ts
    common_content = '''export enum SchemaRegistryErrorCode {
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  PARSE_ERROR = 'PARSE_ERROR',
  MARSHAL_ERROR = 'MARSHAL_ERROR',
  UNMARSHAL_ERROR = 'UNMARSHAL_ERROR'
}

export class SchemaRegistryError extends Error {
  constructor(
    public code: SchemaRegistryErrorCode,
    message: string,
    public cause?: unknown
  ) {
    super(message);
    this.name = 'SchemaRegistryError';
  }
}

export interface ILogger {
  debug(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
}

export class ConsoleLogger implements ILogger {
  debug(message: string, context?: Record<string, unknown>): void {
    console.debug(message, context);
  }

  info(message: string, context?: Record<string, unknown>): void {
    console.info(message, context);
  }

  warn(message: string, context?: Record<string, unknown>): void {
    console.warn(message, context);
  }

  error(message: string, context?: Record<string, unknown>): void {
    console.error(message, context);
  }
}'''

    with open(os.path.join(output_dir, 'common.ts'), 'w') as f:
        f.write(common_content)

    # Generate marshaller.ts and unmarshaller.ts
    marshaller_content = '''import { z } from 'zod';
import * as models from './models';
import * as validator from './validator';
import { SchemaRegistryError, SchemaRegistryErrorCode, ILogger, ConsoleLogger } from './common';

/**
 * Marshaller class for converting TypeScript objects to JSON strings
 */
export class Marshaller {
  private static logger: ILogger = new ConsoleLogger();

  /**
   * Set a custom logger for the Marshaller
   * @param logger - Custom logger implementation
   */
  static setLogger(logger: ILogger) {
    this.logger = logger;
  }
'''

    unmarshaller_content = '''import { z } from 'zod';
import * as models from './models';
import * as validator from './validator';
import { SchemaRegistryError, SchemaRegistryErrorCode, ILogger, ConsoleLogger } from './common';

/**
 * Unmarshaller class for converting JSON strings to TypeScript objects
 */
export class Unmarshaller {
  private static logger: ILogger = new ConsoleLogger();

  /**
   * Set a custom logger for the Unmarshaller
   * @param logger - Custom logger implementation
   */
  static setLogger(logger: ILogger) {
    this.logger = logger;
  }
'''

    for name in components.keys():
        # Add marshal method
        marshaller_content += f'''
  /**
   * Marshal a {name} object to JSON string
   * @param data - The {name} object to marshal
   * @returns JSON string representation of the object
   * @throws {{SchemaRegistryError}} If validation or marshalling fails
   */
  static marshal{name}(data: models.{name}): string {{
    try {{
      this.logger.debug('Marshalling {name}', {{ data }});
      validator.{name}Schema.parse(data);
      const json = JSON.stringify(data);
      this.logger.debug('Successfully marshalled {name}');
      return json;
    }} catch (error) {{
      if (error instanceof z.ZodError) {{
        throw new SchemaRegistryError(
          SchemaRegistryErrorCode.VALIDATION_ERROR,
          `Invalid {name} data: ${{error.message}}`,
          error
        );
      }}
      throw new SchemaRegistryError(
        SchemaRegistryErrorCode.MARSHAL_ERROR,
        `Failed to marshal {name}: ${{error instanceof Error ? error.message : 'Unknown error'}}`,
        error
      );
    }}
  }}
'''

        # Add unmarshal method
        unmarshaller_content += f'''
  /**
   * Unmarshal a JSON string to a {name} object
   * @param json - JSON string to unmarshal
   * @returns Unmarshalled {name} object
   * @throws {{SchemaRegistryError}} If parsing or validation fails
   */
  static unmarshal{name}(json: unknown): models.{name} {{
    try {{
      this.logger.debug('Unmarshalling {name}', {{ json }});
      const data = typeof json === 'string' ? JSON.parse(json) : json;
      const validated = validator.{name}Schema.parse(data);
      this.logger.debug('Successfully unmarshalled {name}');
      return validated;
    }} catch (error) {{
      if (error instanceof SyntaxError) {{
        throw new SchemaRegistryError(
          SchemaRegistryErrorCode.PARSE_ERROR,
          `Invalid JSON for {name}: ${{error.message}}`,
          error
        );
      }}
      if (error instanceof z.ZodError) {{
        throw new SchemaRegistryError(
          SchemaRegistryErrorCode.VALIDATION_ERROR,
          `Invalid {name} data: ${{error.message}}`,
          error
        );
      }}
      throw new SchemaRegistryError(
        SchemaRegistryErrorCode.UNMARSHAL_ERROR,
        `Failed to unmarshal {name}: ${{error instanceof Error ? error.message : 'Unknown error'}}`,
        error
      );
    }}
  }}
'''

    marshaller_content += '}\n'
    unmarshaller_content += '}\n'

    with open(os.path.join(output_dir, 'marshaller.ts'), 'w') as f:
        f.write(marshaller_content)

    with open(os.path.join(output_dir, 'unmarshaller.ts'), 'w') as f:
        f.write(unmarshaller_content)

if __name__ == '__main__':
    script_dir = os.path.dirname(os.path.abspath(__file__))
    root_dir = os.path.dirname(script_dir)
    schema_file = os.path.join(root_dir, 'schemas', 'bill-event.yaml')
    output_dir = os.path.join(root_dir, 'generated', 'typescript')
    
    generate_typescript_bindings(schema_file, output_dir)
