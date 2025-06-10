await Bun.build({
  entrypoints: ['./main.ts'],
  outdir: './client/',
  env: 'inline',
  target: 'browser',
  format: 'esm',
  minify: true,
});

console.log('Client build completed successfully.');

await import('./serve.ts');