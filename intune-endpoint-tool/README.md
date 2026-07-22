# Intune Endpoint Tool

A structural scaffold for a Microsoft Intune / Autopilot equivalent of the
[Jamf Prestage Tool](../README.md) in this repository. It mirrors that tool's shape —
same runtime (Bun), same UI stack (Alpine.js + DaisyUI/Tailwind), same auth pattern
(Entra ID), same audit/approval workflow — but targets Microsoft Graph instead of the
Jamf Pro API.

**This is a scaffold, not a finished tool.** The generic pieces (auth, audit log,
approval workflow, UI shell, Docker/build setup) are fully wired up and working. The
Microsoft Graph calls themselves — search, enrollment profile assignment, wipe, retire —
are typed function stubs in `server/utils.ts` with `TODO` comments describing the exact
Graph endpoint, request shape, and platform-specific nuances to implement. See that file
before writing any UI-facing feature work.

## Why this isn't a 1:1 port

Jamf's Prestage model (a flat list of serial numbers scoped to one enrollment profile,
replaced wholesale on every write) does not map cleanly onto Intune:

- **Enrollment profile assignment is group-membership-driven, not a per-device scope
  list.** A Windows Autopilot deployment profile is assigned to an Entra ID group, and a
  device joins that group either via a dynamic group rule matching its Autopilot
  **Group Tag**, or via static group membership. There is no Graph endpoint that lets you
  PUT a list of serial numbers onto a profile the way Jamf's prestage scope endpoint
  does. `assignDeviceToProfile()` in `server/utils.ts` documents both strategies — pick
  whichever matches how your tenant's dynamic/static groups are already set up.
- **Apple devices enrolled via Intune (Apple ADE)** use yet another profile-assignment
  model, scoped per Apple Business/School Manager token (`depOnboardingSettings`) rather
  than one flat list.
- **Jamf's "Inventory Preload"** (username, email, building, room, asset tag pre-filled
  before a device ever checks in) has no Graph equivalent — Intune has no generic
  arbitrary-metadata record for a not-yet-enrolled device. This tool tracks those same
  fields locally in a `device_metadata` SQLite table (`server/db.ts`) and joins them onto
  live Graph data at search time, the same way the Jamf tool joins Jamf's own Preload
  records onto inventory data.
- **Device wipe has no PIN-based Activation Lock bypass equivalent.** Jamf's erase
  endpoint takes a caller-supplied PIN (`DEVICE_ERASE_PIN`); Graph instead exposes a
  device's `activationLockBypassCode` to *read*, which your workflow needs to surface to
  the tech *before* wiping a macOS device enrolled via Intune.

## What's implemented vs. stubbed

| Layer | Status |
|---|---|
| Entra ID user auth (`server/auth.ts`, `client/azure-auth.ts`) | Fully implemented — same pattern as the Jamf tool |
| Microsoft Graph client-credentials token acquisition (`server/utils.ts: getGraphToken`) | Fully implemented |
| Audit log & two-person approval workflow (`server/db.ts`, approval routes) | Fully implemented |
| Device search, enrollment profile list/assign/remove, wipe, retire | **Stubbed** — typed signatures with TODO comments pointing at the exact Graph endpoints |
| GLPI / ClearPass retirement cleanup steps | Fully implemented — reused as-is, these are vendor-agnostic |
| UI (`client/index.html`, `client/main.ts`) | Fully implemented against the stubbed API shape |

## Requirements
- A Microsoft Entra ID tenant with Intune licensing.
- Two Entra app registrations (see `.env.example` for exactly which Graph API
  application permissions the second one needs):
  1. One for user sign-in to this tool (`AZURE_CLIENT_ID`/`AZURE_AUTHORITY`).
  2. One for the server's client-credentials calls to Microsoft Graph
     (`GRAPH_TENANT_ID`/`GRAPH_CLIENT_ID`/`GRAPH_CLIENT_SECRET`).
- Docker (or `bun` installed locally for development without containers).

## Installation
1. From the repo root: `cd intune-endpoint-tool`
2. Copy `.env.example` to `.env` and fill in your values.
3. Copy & name your SSL certs as `certs/server.cert` & `certs/server.key`
   (or omit them and put this behind a reverse proxy that terminates TLS).
4. Implement the Graph calls in `server/utils.ts` (see TODO comments) for the
   features you need first — device search is the natural starting point.

## Usage
```bash
docker compose up
```
Client on `https://<CLIENT_HOSTNAME>` (default port 443), API on `:8443`. If you're
running this alongside the Jamf tool on the same host, change the exposed ports in
`docker-compose.yml` and the corresponding `CLIENT_PORT`/`SERVER_API_PORT` env vars —
both tools default to the same 443/8443 pair.

### Dev mode without Entra auth
Set `SKIP_ENTRA_AUTH=true` in `.env` to bypass the Microsoft login screen during local
development — same flag and behavior as the Jamf tool.

## Architecture
Two Bun processes, same as the Jamf tool:
- `client/` — Alpine.js SPA, bundled and served by `client/worker.ts`.
- `server/` — Bun-native REST API (`server/server.ts`), calling Microsoft Graph via
  `server/utils.ts` instead of the Jamf Pro API.

Route shape mirrors the Jamf tool with Intune-appropriate names:

| Jamf tool route | Intune tool route |
|---|---|
| `GET /api/prestages` / `/api/mobile-prestages` | `GET /api/enrollment-profiles/:platform` (`platform` = `windows` \| `apple`) |
| `GET /api/computers/:search` / `/api/mobiledevices/:search` | `GET /api/devices/:search` |
| `POST /api/change-prestage/:deviceType/:prestageId/:serialNumber` | `POST /api/change-enrollment-profile/:platform/:profileId/:serialNumber` |
| `PUT /api/update-info/:deviceType/:preloadId/:computerId` | `PUT /api/device-metadata/:serialNumber` |
| `DELETE /api/wipedevice/:computerId` | `DELETE /api/wipedevice/:deviceId` |
| `DELETE /api/retiredevice/:computerId/:serialNumber/:macAddress/:altMacAddress` | `DELETE /api/retiredevice/:deviceId/:serialNumber/:macAddress/:altMacAddress` |
| `/api/audit-log`, `/api/approvals*`, `/api/config` | unchanged |

## License
This project is licensed under the [GPL 3.0 license](../LICENSE), same as the rest of
this repository.
