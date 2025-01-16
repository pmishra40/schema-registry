import * as esbuild from 'esbuild';
import * as path from 'path';

async function build() {
  try {
    // Build the Lambda function
    await esbuild.build({
      entryPoints: [path.join(__dirname, '..', 'billApprovedEventConsumerLambda.ts')],
      bundle: true,
      minify: true,
      sourcemap: true,
      platform: 'node',
      target: 'node18',
      outfile: path.join(__dirname, 'dist', 'billApprovedEventConsumerLambda.js'),
      external: [], // No external dependencies as we want to bundle everything
    });

    console.log('Build completed successfully');
  } catch (error) {
    console.error('Build failed:', error);
    process.exit(1);
  }
}

build();
