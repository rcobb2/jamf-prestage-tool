const BASE_FS_ROOT = "/app/client/";

const server: Bun.Server = Bun.serve({
  development: true,
  hostname: process.env.CLIENT_API_HOSTNAME || "localhost",
  port: process.env.CLIENT_API_PORT || 3000,
  tls: {
    key: Bun.file("server.key"),
    cert: Bun.file("server.cert"),
  },
  fetch(req) {
    const url: URL = new URL(req.url);
    const path: string = url.pathname === "/" ? "/index.html" : url.pathname;
    const file: Bun.BunFile = Bun.file(BASE_FS_ROOT + path);
    return new Response(file);
  },
  error() {
    return new Response("404 Not Found", { status: 404 });
  },
});

console.log(`Client listening on ${server.url}`);