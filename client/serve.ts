import homepage from "/app/client/index.html"

const server: Bun.Server = Bun.serve({
  development: {
    console: true,
    hmr: false,
  },
  hostname: process.env.CLIENT_API_HOSTNAME || "localhost",
  port: process.env.CLIENT_API_PORT || 3000,
  tls: {
    key: Bun.file("server.key"),
    cert: Bun.file("server.cert"),
  },
  routes: {
    "/": homepage,
  },
});

console.log(`Client listening on ${server.url}`);