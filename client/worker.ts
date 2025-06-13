import notFound from "/app/404.html";
import homepage from "/app/client/index.html";

await Bun.build({
  entrypoints: ['./main.ts'],
  outdir: './client/',
  env: 'inline',
  target: 'browser',
  format: 'esm',
  sourcemap: 'none',
  splitting: false,
  minify: true,
});

console.log('Client build completed successfully.');

const server: Bun.Server = Bun.serve({
  development: false,
  hostname: process.env.CLIENT_HOSTNAME || "localhost",
  port: process.env.CLIENT_PORT || 3000,
  tls: {
    key: Bun.file("server.key"),
    cert: Bun.file("server.cert"),
  },
  routes: {
    "/": homepage,
    "/*": notFound,
  },
});

console.log(`Client listening on ${server.url}`);