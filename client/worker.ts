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

    // Serve static files from the client directory
    const filePath = `/app/client${path}`;
    const file = Bun.file(filePath);
    
    if (await file.exists()) {
      return new Response(file);
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