#!/usr/bin/env node

/**
 * Command Line Interface for the Schema Registry Code Generator
 * 
 * This CLI tool generates TypeScript and Python code from OpenAPI schemas,
 * including models, validators, and AWS EventBridge integration.
 * 
 * Usage:
 * ```bash
 * ts-node src/cli/index.ts generate \
 *   --schema ./schemas/api.yaml \
 *   --output ./generated \
 *   --language typescript \
 *   --log-level DEBUG
 * ```
 * 
 * Environment Variables:
 * - LOG_LEVEL: Set logging verbosity (DEBUG, INFO, WARN, ERROR)
 * 
 * @module cli
 */

import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { TypeScriptGenerator } from '../generators/typescript/generator';
import { ConsoleLogger, LogLevel } from '../utils/logger';
import { GeneratorError } from '../utils/errors';
import { spawnSync } from 'child_process';
import path from 'path';
import fs from 'fs';

/**
 * Main entry point for the CLI application
 * Handles command line parsing, validation, and code generation
 */
async function main() {
  // Initialize logger with level from environment or default to INFO
  const logger = new ConsoleLogger(
    process.env.LOG_LEVEL ? 
      LogLevel[process.env.LOG_LEVEL as keyof typeof LogLevel] : 
      LogLevel.INFO
  );

  try {
    // Parse command line arguments
    const argv = await yargs(hideBin(process.argv))
      .command('generate', 'Generate code from OpenAPI schema', {
        schema: {
          type: 'string',
          demandOption: true,
          describe: 'Path to OpenAPI schema file'
        },
        output: {
          type: 'string',
          demandOption: true,
          describe: 'Output directory for generated code'
        },
        language: {
          type: 'string',
          choices: ['typescript', 'python', 'both'],
          default: 'both',
          describe: 'Target language(s) for code generation'
        },
        'include-eventbridge': {
          type: 'boolean',
          default: true,
          describe: 'Include EventBridge integration'
        },
        'log-level': {
          type: 'string',
          choices: Object.keys(LogLevel).filter(k => isNaN(Number(k))),
          default: 'INFO',
          describe: 'Log level for output'
        }
      })
      .strict()
      .help()
      .argv;

    logger.info('Starting code generation', {
      schema: argv.schema,
      output: argv.output,
      language: argv.language
    });

    // Resolve paths relative to the project root
    const projectRoot = process.cwd();
    const schemaPath = path.resolve(projectRoot, argv.schema as string);
    const outputDir = path.resolve(projectRoot, argv.output as string);
    const language = argv.language as string;
    const includeEventBridge = argv['include-eventbridge'] as boolean;

    // Validate schema file exists
    if (!fs.existsSync(schemaPath)) {
      logger.error(`Error: Schema file not found at ${schemaPath}`);
      process.exit(1);
    }

    // Create output directory if it doesn't exist
    fs.mkdirSync(outputDir, { recursive: true });

    // Generate TypeScript code if requested
    if (language === 'typescript' || language === 'both') {
      const tsOutputDir = path.join(outputDir);
      fs.mkdirSync(tsOutputDir, { recursive: true });
      
      logger.info(`Generating TypeScript code from ${schemaPath}`);
      logger.info(`Output directory: ${tsOutputDir}`);
      
      const tsGenerator = new TypeScriptGenerator({ logger });
      await tsGenerator.initialize({
        schemaPath: schemaPath,
        outputDir: tsOutputDir,
        includeEventBridge,
        logger
      });

      await tsGenerator.generate();
      
      logger.info('✅ Generated TypeScript code');
    }

    // Generate Python code if requested
    if (language === 'python' || language === 'both') {
      const pyOutputDir = path.join(outputDir, 'python');
      fs.mkdirSync(pyOutputDir, { recursive: true });
      
      logger.info(`Generating Python code from ${schemaPath}`);
      logger.info(`Output directory: ${pyOutputDir}`);

      // Run Python generator
      const pythonScript = path.resolve(__dirname, '../generators/python/generator.py');
      const result = spawnSync('python3', [
        pythonScript,
        '--schema', schemaPath,
        '--output', pyOutputDir,
        '--event-bridge', includeEventBridge.toString(),
      ]);

      if (result.error) {
        logger.error('Failed to generate Python code:', result.error);
        process.exit(1);
      }

      if (result.status !== 0) {
        logger.error('Python generator failed:', new Error(result.stderr.toString()));
        process.exit(1);
      }

      logger.info('✅ Generated Python code');
    }

    logger.info(`\n🎉 Code generation complete! Output directory: ${outputDir}`);
    
    process.exit(0);
  } catch (error) {
    if (error instanceof GeneratorError) {
      logger.error(error.getDetailedMessage());
    } else {
      logger.error('Unexpected error during code generation', error as Error);
    }
    process.exit(1);
  }
}

// Start the CLI application
main();
