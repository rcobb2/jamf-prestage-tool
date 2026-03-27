# AGENTS.md – Repository Guidance for Jamf Prestage Tool

**Purpose** – This file provides agentic tooling with canonical commands, style conventions, and configuration flags. Agents (including Copilot) read it to understand how to build, test, lint, and maintain the codebase.

---

## 1️⃣ Build / Run Commands

- **Client bundle** – Bundles the TypeScript UI into a single browser‑ready file.
  ```bash
  bun run client   # alias for "bun build client/app.ts … --outfile client/app.bundle.js"
  ```
  *Result*: `client/app.bundle.js` (minified, syntax‑ and whitespace‑optimized).

- **Server (development)** – Starts the Bun server with hot‑reload.
  ```bash
  bun run --hot server.ts
  ```
  *Default ports*: `SERVER_API_HOSTNAME` (default `localhost`) and `SERVER_API_PORT` (default `3001`). TLS certificates are read from `server.cert` / `server.key`.

- **Docker Compose** – Spins up both client and server containers with TLS and host networking.
  ```bash
  docker compose up   # builds images defined in Dockerfile.client & Dockerfile.server
  ```
  *Expose*: client on `443`, server on `8443`.

- **Production image** – Build the server image only (client is served separately via Docker Compose):
  ```bash
  docker build -f Dockerfile.server -t jamf-prestage-server .
  ```

---

## 2️⃣ Test Commands

- **Run the full Jest suite** (currently only unit tests, if any are added):
  ```bash
  npm test
  # or equivalently
  bun test
  ```

- **Run a single test** – use Jest’s pattern filter:
  ```bash
  npm test -- -t "<test name>"
  # e.g.,
  npm test -- -t "utils.getJAMFToken"
  ```
  *Note*: `--passWithNoTests` in the script prevents a non‑zero exit when the suite is empty.

---

## 3️⃣ Lint / Formatting

The project does **not** ship a dedicated linter configuration, but agents should enforce the following conventions (mirroring typical TypeScript best‑practices):

- **Formatting** – run `bunx prettier --write "**/*.{ts,js,tsx,jsx}"` before committing.
- **Import order** – group imports as:
  1. Built‑in/standard library (`fs`, `path`, …)
  2. Third‑party packages (`@azure/*`, `axios`, …)
  3. Internal modules (`./utils`, `./logger`)
  Separate groups with a blank line.
- **Trailing commas** – enable in array/object literals and function parameters.
- **Semicolons** – always terminate statements.
- **Single quotes** – prefer `'` over `"` except when the string contains a quote.

---

## 4️⃣ Naming & Types

| Element | Convention |
|---------|------------|
| **Variables / functions** | `camelCase` (e.g., `getJAMFToken`, `skipEntraAuth`) |
| **Constants / env vars** | `UPPER_SNAKE_CASE` (e.g., `AZURE_CLIENT_ID`, `SKIP_ENTRA_AUTH`) |
| **Classes / Interfaces** | `PascalCase` (e.g., `PublicClientApplication`, `JAMFResponse`) |
| **Enums** | `PascalCase` – values `UPPER_SNAKE_CASE` |
| **TypeScript types** | Prefer explicit interfaces over inline object types; include optional `?` for nullable fields.

### Error Handling
- Wrap external‑service errors with context and preserve the original stack:
  ```ts
  try { … } catch (err: any) {
    logger.error('JAMF request failed', { status: err.response?.status, data: err.response?.data })
    throw new Error(`JAMF API error: ${err.message}`)
  }
  ```
- Use `logger.warn` for non‑critical recoverable failures (e.g., token refresh failures that fallback to unauthenticated mode).
- Never swallow errors silently; at minimum log and re‑throw or return a 500 response.

---

## 5️⃣ Environment Variables & Flags

| Variable | Description | Default |
|----------|-------------|---------|
| `AZURE_CLIENT_ID` | Entra (Azure AD) application registration client ID. | *(required for auth)* |
| `AZURE_AUTHORITY` | Azure AD authority URL (`.../common` for multi‑tenant). | `https://login.microsoftonline.com/common` |
| `SKIP_ENTRA_AUTH` | **Flag to disable Entra authentication** – useful for local testing. Set to `'true'` to bypass the MSAL flow; the client treats the session as authenticated. | `false` |
| `CLIENT_HOSTNAME` / `CLIENT_PORT` | Hostname and port for the UI server. | `localhost` / `443` |
| `SERVER_API_HOSTNAME` / `SERVER_API_PORT` | Hostname and port for the API server. | `localhost` / `8443` |
| `JAMF_INSTANCE` | Base URL of the Jamf Pro instance. | – |
| `JAMF_CLIENT_ID` / `JAMF_CLIENT_SECRET` | Credentials for Jamf Classic API. | – |
| `GLPI_INSTANCE` / `GLPI_APP_TOKEN` | Optional GLPI integration endpoints. | – |

**Enabling test mode** – add `SKIP_ENTRA_AUTH=true` to the `.env` file or export it before running the server:
```bash
export SKIP_ENTRA_AUTH=true
bun run --hot server.ts
```
The `/api/config` endpoint will then return `{ "skipEntraAuth": true }`, and the client will bypass Azure sign‑in.

---

## 6️⃣ Project Structure Overview

- `client/` – Front‑end TypeScript (Alpine.js) and static assets.
- `server/` – Bun‑based API server (`server.ts`, utility helpers, logger).
- `Dockerfile.client` / `Dockerfile.server` – multi‑stage builds for production images.
- `docker-compose.yml` – orchestrates both services with host networking.
- `jest.config.js` – Jest configuration for TypeScript tests.
- `tsconfig.json` – Compiler options (`moduleResolution: "bundler"`).

---

## 7️⃣ Cursor / Copilot Rules

*No `.cursor/` or `.github/copilot‑instructions.md` files are present in this repository.*
If such files are added later, agents should incorporate their directives into this document.

---

## 8️⃣ Suggested Next Steps for Contributors

1. **Run the test instance** with Entra auth disabled:
   ```bash
   cp .env.example .env   # adjust values as needed
   echo "SKIP_ENTRA_AUTH=true" >> .env
   docker compose up
   ```
2. Verify the UI loads at `https://localhost` and that API calls succeed without authentication.
3. When ready to enable real Azure auth, remove the flag or set it to `false`.
4. Add unit tests for any new utility functions and run `npm test`.
5. Before opening a PR, format code (`bunx prettier …`) and ensure all scripts run cleanly.

---

*This document is intentionally verbose (~150 lines) to give agents a complete, self‑contained view of the repository’s operational expectations.*