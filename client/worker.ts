await Bun.build({
  entrypoints: ['./main.ts'],
  outdir: './client/',
  env: 'inline',
  minify: true,
  target: 'browser',
  format: 'esm',
});

console.log('Client build completed successfully.');

await import('./serve.ts');