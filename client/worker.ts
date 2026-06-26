import { resolve } from 'path';

await Bun.build({
  entrypoints: ['./main.ts'],
  outdir: './client/',
  // Explicit allowlist — never use 'inline' which would bundle every env var (including secrets)
  env: {
    SKIP_ENTRA_AUTH: process.env.SKIP_ENTRA_AUTH ?? '',
    AZURE_CLIENT_ID: process.env.AZURE_CLIENT_ID ?? '',
    AZURE_AUTHORITY: process.env.AZURE_AUTHORITY ?? '',
    CLIENT_HOSTNAME: process.env.CLIENT_HOSTNAME ?? '',
    CLIENT_PORT: process.env.CLIENT_PORT ?? '',
    THEME: process.env.THEME ?? '',
  },
  target: 'browser',
  format: 'esm',
  sourcemap: 'none',
  splitting: false,
  minify: true,
});

console.log('Client build completed successfully.');

const server = Bun.serve({
  development: false,
  hostname: process.env.CLIENT_HOSTNAME || "localhost",
  port: process.env.CLIENT_PORT || 3000,
  tls: {
    key: Bun.file("server.key"),
    cert: Bun.file("server.cert"),
  },
  async fetch(req) {
    const url = new URL(req.url);
    const path = url.pathname;

    // Serve the homepage
    if (path === "/" || path === "/index.html") {
      const file = Bun.file("/app/client/index.html");
      return new Response(file, {
        headers: { "Content-Type": "text/html" },
      });
    }

    // Serve static files from the client directory — resolve to prevent path traversal
    const filePath = resolve('/app/client', '.' + path);
    if (!filePath.startsWith('/app/client/')) {
      return new Response('Forbidden', { status: 403 });
    }
    const file = Bun.file(filePath);

    if (await file.exists()) {
      return new Response(file, {
        headers: { "Cache-Control": "no-store" },
      });
    }

    // Return 404 for everything else
    const notFoundFile = Bun.file("/app/404.html");
    return new Response(notFoundFile, {
      status: 404,
      headers: { "Content-Type": "text/html" },
    });
  },
});

console.log(`Bun version: ${Bun.version_with_sha}`);
console.log(`Client listening on ${server.url}`);