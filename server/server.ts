import axios from "axios";
import logger from "./logger.ts";
import { writeAudit, getAuditLog, createApproval, getPendingApprovals, resolveApproval } from "./db.ts";
// dotenv import removed – environment variables are loaded via Docker env_file

// dotenv config call removed – Docker injects env vars
import * as utils from "./utils.ts";
import { CORS_HEADERS, type JAMFResponse } from "./utils.ts";

// Parse local admin accounts from ADMIN_ACCOUNTS env var: "alice:1234,bob:5678"
const ADMIN_ACCOUNTS: Record<string, string> = {};
(process.env.ADMIN_ACCOUNTS ?? '').split(',').forEach(entry => {
  const [user, pin] = entry.trim().split(':');
  if (user && pin) ADMIN_ACCOUNTS[user.toLowerCase()] = pin;
});

function validateAccount(username: string, pin: string): boolean {
  return !!ADMIN_ACCOUNTS[username.toLowerCase()] && ADMIN_ACCOUNTS[username.toLowerCase()] === pin;
}

function getActor(req: Request): string {
  return req.headers.get('X-User-Name') ?? 'unknown';
}

function getIP(req: Request): string {
  return req.headers.get('X-Forwarded-For') ?? 'unknown';
}

const notFound = Bun.file("404.html");

const {
  GLPI_INSTANCE,
  GLPI_APP_TOKEN,

  JAMF_INSTANCE,

  SERVER_API_HOSTNAME,
  SERVER_API_PORT,
} = process.env;

// Set default headers for axios
axios.defaults.headers.common["Accept"] = "application/json";
axios.defaults.headers.common["Content-Type"] = "application/json";

// Main handler
// @ts-ignore
const server: Bun.Server = Bun.serve({
  development: false,
  hostname: SERVER_API_HOSTNAME || "localhost",
  port: SERVER_API_PORT || 3001,
  tls: {
    key: Bun.file("server.key"),
    cert: Bun.file("server.cert"),
  },
  routes: {
    "/api/prestages": {
      async GET() {
        try {
          const prestages = await utils.getPrestages();
          return new Response(JSON.stringify(prestages), { ...CORS_HEADERS, status: 200 });
        } catch {
          return new Response('Error fetching prestages', { ...CORS_HEADERS, status: 500 });
        }
      }
    },

    "/api/mobile-prestages": {
      async GET() {
        try {
          const prestages = await utils.getMobilePrestages();
          return new Response(JSON.stringify(prestages), { ...CORS_HEADERS, status: 200 });
        } catch {
          return new Response('Error fetching mobile prestages', { ...CORS_HEADERS, status: 500 });
        }
      }
    },

    "/api/change-prestage/:deviceType/:prestageId/:serialNumber": {
      async POST(req) {
        const { serialNumber, prestageId, deviceType } = req.params;
        logger.info(`Adding ${deviceType} device with serial number: ${serialNumber} to prestage ID: ${prestageId}`);

        try {
          const isMobileDevice = deviceType === 'mobiledevices';
          const token = await utils.getJAMFToken();
          
          // First, find current prestage assignment
          const currentPrestage = isMobileDevice
            ? await utils.getMobilePrestageAssignments(serialNumber)
            : await utils.getPrestageAssignments(serialNumber);
          
          logger.info(`Current prestage for ${serialNumber}:`, currentPrestage.displayName);

          // If device is already in a prestage and it's not the target, remove it first
          if (currentPrestage.displayName !== 'Unassigned' && currentPrestage.displayName !== 'N/A') {
            const allPrestages = isMobileDevice
              ? await utils.getMobilePrestages()
              : await utils.getPrestages();
            
            const currentPrestageObj = allPrestages.find(p => p.displayName === currentPrestage.displayName);
            
            if (currentPrestageObj && currentPrestageObj.id !== prestageId) {
              logger.info(`Removing from current prestage ${currentPrestageObj.id} before adding to ${prestageId}`);
              const removeEndpoint = isMobileDevice
                ? `${JAMF_INSTANCE}/api/v2/mobile-device-prestages/${currentPrestageObj.id}/scope/delete-multiple`
                : `${JAMF_INSTANCE}/api/v2/computer-prestages/${currentPrestageObj.id}/scope/delete-multiple`;
              
              const removeBody: any = { serialNumbers: [serialNumber] };
              if (currentPrestageObj.versionLock && currentPrestageObj.versionLock !== 'N/A') {
                removeBody.versionLock = currentPrestageObj.versionLock;
              }

              await axios.post(removeEndpoint, removeBody, { 
                headers: { Authorization: `Bearer ${token}` } 
              }).catch((err) => {
                logger.warn('Warning: Failed to remove from current prestage:', err.response?.data);
                // Continue anyway - device might not actually be in that prestage
              });
            }
          }

          // Now add to target prestage
          const availiblePrestages = isMobileDevice 
            ? await utils.getMobilePrestages() 
            : await utils.getPrestages();
          const prestage = availiblePrestages.find(p => p.id === prestageId);

          if (!prestage) {
            return new Response('Prestage not found', { ...CORS_HEADERS, status: 404 });
          }

          // Determine if a dry-run was requested via query param
          const url = new URL(req.url, `http://${req.headers.get('host') || 'localhost'}`);
          const dryRun = url.searchParams.get('dryRun') === 'true';

          // Validate serial number format (Apple serials are alphanumeric, 8-12 chars)
          const serialRegex = /^[A-Z0-9]{6,}$/i;
          if (!serialRegex.test(serialNumber)) {
            return new Response('Invalid serial number format', { ...CORS_HEADERS, status: 400 });
          }

           // Use helper to add device (handles dry-run and POST)
           const addResult = await utils.addDeviceToPrestage(prestage.id, serialNumber, isMobileDevice, token, prestage.versionLock, dryRun);
           writeAudit({ action: 'prestage_change', actor: getActor(req), ip: getIP(req), device_serial: serialNumber, details: { prestageId, prestage: prestage.displayName, dryRun }, result: 'success' });
           return new Response(JSON.stringify(addResult), { ...CORS_HEADERS, status: 200 });
        } catch (error: any) {
          const status = error?.response?.status;
          writeAudit({ action: 'prestage_change', actor: getActor(req), ip: getIP(req), device_serial: serialNumber, details: { prestageId }, result: 'error', error_detail: String(error.response?.data ?? error.message) });
          if (status === 400) {
            logger.error('Add prestage 400 error details:', error.response?.data);
            return new Response(`Error: ${JSON.stringify(error.response.data)}`, { ...CORS_HEADERS, status: 400 });
          }
          logger.error('Add prestage error:', {status, data: error.response?.data});
          return new Response(`Error adding device to prestage: ${JSON.stringify(error.response?.data)}`, { ...CORS_HEADERS, status: 500 });
        }
      },      async DELETE(req) {
        const { prestageId, serialNumber, deviceType } = req.params;
        logger.info(`Removing ${deviceType} device with serial number: ${serialNumber} from prestage: ${prestageId}`);

        try {
          const isMobileDevice = deviceType === 'mobiledevices';
          const availiblePrestages = isMobileDevice
            ? await utils.getMobilePrestages()
            : await utils.getPrestages();
          const prestage = availiblePrestages.find(p => p.id === prestageId);

          if (!prestage) {
            return new Response('Prestage not found', { ...CORS_HEADERS, status: 404 });
          }

          const token = await utils.getJAMFToken();
          const endpoint = isMobileDevice
            ? `${JAMF_INSTANCE}/api/v2/mobile-device-prestages/${prestage.id}/scope/delete-multiple`
            : `${JAMF_INSTANCE}/api/v2/computer-prestages/${prestage.id}/scope/delete-multiple`;

          // Build request body as with add
          const body: any = { serialNumbers: [serialNumber] };
          if (prestage.versionLock && prestage.versionLock !== 'N/A') {
            body.versionLock = prestage.versionLock;
          }

          const response = await axios.post(endpoint, body, { headers: { Authorization: `Bearer ${token}` } });

          return new Response(JSON.stringify(response.data), { ...CORS_HEADERS, status: 200 });
        } catch (error: any) {
          logger.error('Remove prestage error:', {status: error.response?.status, data: error.response?.data});
          return new Response(`Error removing device from prestage: ${JSON.stringify(error.response?.data)}`, { ...CORS_HEADERS, status: 500 });
        }
      }
    },

    "/api/buildings": {
      async GET() {
        try {
          const token = await utils.getJAMFToken();
          const apiUrl = `${JAMF_INSTANCE}/api/v1/buildings?page=0&page-size=100&sort=id%3Aasc`;
          const response = await axios.get<{ results: any[] }>(apiUrl, {
            headers: { Authorization: `Bearer ${token}` }
          });
          return new Response(JSON.stringify(response.data.results), { ...CORS_HEADERS, status: 200 });
        } catch {
          return new Response('Failed to fetch buildings', { ...CORS_HEADERS, status: 500 });
        }
      }
    },

    "/api/computers/:search": {
      async GET(req) {
        const { search } = req.params;
        logger.info(`[Computer Search] Incoming search for: ${search}`);
        try {
          const computers = await utils.matchComputer(search);
          const token = await utils.getJAMFToken();
          let results: any[] = [];

          if (computers.length === 0) {
            // Search device enrollments if no computers found
            const enrollmentsRes = await axios.get<{ results: any[] }>(
              `${JAMF_INSTANCE}/api/v1/device-enrollments?page=0&page-size=100`,
              { headers: { Authorization: `Bearer ${token}` } }
            );

            const enrollmentDevices = await Promise.all(
              enrollmentsRes.data.results.map(async (instance) => {
                const devicesRes = await axios.get<{ results: any[] }>(
                  `${JAMF_INSTANCE}/api/v1/device-enrollments/${instance.id}/devices`,
                  { headers: { Authorization: `Bearer ${token}` } }
                );
                const normalizedSearch = search.toUpperCase();
                return devicesRes.data.results.filter(device =>
                  device.serialNumber?.toUpperCase().includes(normalizedSearch)
                );
              })
            );

            const flatDevices = enrollmentDevices.flat();

            results = await Promise.all(
              flatDevices.map(async (device) => {
                const preloadRes = await axios.get<{ results: any[] }>(
                  `${JAMF_INSTANCE}/api/v2/inventory-preload/records?page=0&page-size=1&filter=serialNumber%3D%3D${device.serialNumber}`,
                  { headers: { Authorization: `Bearer ${token}` } }
                );
                const preload = preloadRes.data.results[0] || null;

                return {
                  computerId: 'none',
                  assetTag: preload?.assetTag || 'N/A',
                  serialNumber: device.serialNumber,
                  preloadId: preload?.id || 'none',
                  username: preload?.username || null,
                  building: preload?.building || 'N/A',
                  room: preload?.room || null,
                };
              })
            );
          } else {
            // If computers found, fetch their details
            results = await Promise.all(
              computers.map(async ({ id, serial_number }) => {
                const compRes = await axios.get<{
                  hardware: any; id: number; general: any
                }>(
                  `${JAMF_INSTANCE}/api/v1/computers-inventory/${id}?section=GENERAL&section=HARDWARE`,
                  { headers: { Authorization: `Bearer ${token}` } }
                );

                const prestage = await utils.getPrestageAssignments(serial_number);
                const preloadRes = await axios.get<{ results: any[] }>(
                  `${JAMF_INSTANCE}/api/v2/inventory-preload/records?page=0&page-size=1&filter=serialNumber%3D%3D${serial_number}`,
                  { headers: { Authorization: `Bearer ${token}` } }
                );

                const general = compRes.data.general || {};
                const preload = preloadRes.data.results[0] || {};

                return {
                  computerId: compRes.data.id,
                  name: general.name || 'N/A',
                  assetTag: general.assetTag || 'N/A',
                  macAddress: compRes.data.hardware?.macAddress || 'N/A',
                  altMacAddress: compRes.data.hardware?.altMacAddress || 'N/A',
                  enrollmentMethod: general.enrollmentMethod?.objectName || 'No enrollment method found',
                  serialNumber: serial_number,
                  currentPrestage: prestage.displayName,
                  preloadId: preload.id,
                  username: preload.username,
                  email: preload.emailAddress,
                  building: preload.building,
                  room: preload.room
                };
              })
            );
          }
          if (results.length === 0) {
            return new Response('No computer found', { ...CORS_HEADERS, status: 404 });
          } else {
            return new Response(JSON.stringify(results), { ...CORS_HEADERS, status: 200 });
          }
        } catch (error: any) {
          return new Response(`${error.message || 'Unknown error'}`, { ...CORS_HEADERS, status: 500 });
        }
      }
    },

    "/api/mobiledevices/:search": {
      async GET(req) {
        const { search } = req.params;
        logger.info(`[Mobile Device Search] Incoming search for: ${search}`);
        try {
          const mobileDevices = await utils.matchMobileDevice(search);
          const token = await utils.getJAMFToken();
          let results: any[] = [];

          if (mobileDevices.length === 0) {
            return new Response('No mobile device found', { ...CORS_HEADERS, status: 404 });
          }

          // Fetch mobile device details
          results = await Promise.all(
            mobileDevices.map(async ({ id, serial_number }) => {
              const deviceRes = await axios.get<{
                id: number;
                name: string;
                assetTag: string;
                wifiMacAddress: string;
                bluetoothMacAddress: string;
                enrollmentMethod: string;
                serialNumber: string;
                location: {
                  username: string;
                  emailAddress: string;
                  buildingId: string;
                  room: string;
                };
              }>(
                `${JAMF_INSTANCE}/api/v2/mobile-devices/${id}/detail`,
                { headers: { Authorization: `Bearer ${token}` } }
              );

              const prestage = await utils.getMobilePrestageAssignments(serial_number);
              const preloadRes = await axios.get<{ results: any[] }>(
                `${JAMF_INSTANCE}/api/v2/inventory-preload/records?page=0&page-size=1&filter=serialNumber%3D%3D${serial_number}`,
                { headers: { Authorization: `Bearer ${token}` } }
              );

              const device = deviceRes.data;
              const preload = preloadRes.data.results[0] || {};
              const location = device.location || {};

              return {
                computerId: device.id, // Using computerId for consistency with UI
                name: device.name || 'N/A',
                assetTag: device.assetTag || 'N/A',
                macAddress: device.wifiMacAddress || 'N/A',
                altMacAddress: device.bluetoothMacAddress || 'N/A',
                enrollmentMethod: device.enrollmentMethod || 'No enrollment method found',
                serialNumber: device.serialNumber,
                currentPrestage: prestage.displayName,
                preloadId: preload.id,
                username: preload.username || location.username || 'N/A',
                email: preload.emailAddress || location.emailAddress || 'N/A',
                building: preload.building || location.buildingId || 'N/A',
                room: preload.room || location.room || 'N/A'
              };
            })
          );

          return new Response(JSON.stringify(results), { ...CORS_HEADERS, status: 200 });
        } catch (error: any) {
          logger.error({ err: error.message, stack: error.stack }, 'Mobile device search error');
          return new Response(`${error.message || 'Unknown error'}`, { ...CORS_HEADERS, status: 500 });
        }
      }
    },

    "/api/wipedevice/:computerId": {
      async DELETE(req) {
        const { computerId } = req.params;
        logger.info({ computerId }, 'Wiping device');
        const result = await utils.wipeDevice(computerId);
        writeAudit({ action: 'wipe', actor: getActor(req), ip: getIP(req), device_id: computerId, result: result.status === 200 ? 'success' : 'error' });
        return result;
      }
    },

    // If you want to retire a device, you need to implement your own logic. Otherwise, uncomment the 'Not Implemented' response.
    "/api/retiredevice/:computerId/:serialNumber/:macAddress/:altMacAddress": {
      async DELETE(req) {
        const { computerId, serialNumber, macAddress, altMacAddress } = req.params;
        logger.info({ computerId, serialNumber }, 'Retiring device');

        // return new Response('Retiring device is not implemented.', { ...CORS_HEADERS, status: 501 });

        try {
          // First, wipe the device using JAMF API
          const jamfWipeResp = await utils.wipeDevice(computerId);
          if (jamfWipeResp.status !== 200) {
            return new Response(`Failed to wipe device on JAMF: ${jamfWipeResp.status} ${await jamfWipeResp.text()}`, { ...CORS_HEADERS, status: 500 });
          }

          // Get JAMF API token and retire (delete) the device from JAMF
          const token = await utils.getJAMFToken();
          const jamfResp = await axios.delete(`${JAMF_INSTANCE}/api/v1/computers-inventory/${computerId}`, {
            headers: { Authorization: `Bearer ${token}` }
          });

          if (jamfResp.status !== 204) {
            return new Response(`Failed to retire device on JAMF: ${jamfResp.status} ${jamfResp.data}`, { ...CORS_HEADERS, status: 500 });
          }

          // Start a GLPI session to update the device state
          const glpiTokenResp = await utils.getGLPIToken();
          const sessionToken = glpiTokenResp.data.session_token;
          if (!sessionToken) {
            return new Response('Failed to get GLPI session token', { ...CORS_HEADERS, status: 500 });
          }

          logger.info('GLPI not in use yet, skipping GLPI retirement steps.');
          // Search for the computer in GLPI by serial number
          const params = new URLSearchParams({
            'criteria[0][field]': '5', // Field 5 is usually serial number in GLPI
            'criteria[0][searchtype]': 'contains',
            'criteria[0][value]': `^${serialNumber}$`,
          });

          const searchResp = await axios.get(`${GLPI_INSTANCE}/search/Computer`, {
            headers: {
              'Content-Type': 'application/json',
              'App-Token': GLPI_APP_TOKEN,
              'Session-Token': sessionToken,
            },
            params,
          });

          // Ensure exactly one computer is found in GLPI
          // Update the computer state in GLPI to "Out of Service > Salvaged" (state ID 18)
          if (searchResp.data.totalcount === 1) {
            const computerIdGLPI = searchResp.data.data[0][2];
            await axios.put(`${GLPI_INSTANCE}/Computer/${computerIdGLPI}`, {
              input: { states_id: 18 } // 18 is the ID for "Out of Service > Salvaged"
            }, {
              headers: {
                "Content-Type": "application/json",
                "App-Token": GLPI_APP_TOKEN,
                "Session-Token": sessionToken,
              },
            });
          } else {
            return new Response('Computer not found or multiple found in GLPI', { ...CORS_HEADERS, status: 500 });
          }

          // Cleanup GLPI session
          logger.info('Cleaning up GLPI session...');
          const cleanup = await utils.cleanupGLPI(sessionToken);
          logger.info({ status: cleanup.status }, 'GLPI session cleanup response');

          // Remove MAC address from Clearpass
          if (macAddress && altMacAddress) {
            logger.info({ macAddress }, 'Deleting primary MAC from Clearpass');
            await utils.deleteClearpassMAC(macAddress);
            logger.info({ altMacAddress }, 'Deleting secondary MAC from Clearpass');
            await utils.deleteClearpassMAC(altMacAddress);
          }

          writeAudit({ action: 'retire', actor: getActor(req), ip: getIP(req), device_serial: serialNumber, device_id: computerId, result: 'success' });
          return new Response('Device retired successfully', { ...CORS_HEADERS, status: 200 });
        } catch (error: any) {
          const status = error?.response?.status || 500;
          const message = error?.response?.data || error?.message || 'Error retiring device';
          writeAudit({ action: 'retire', actor: getActor(req), ip: getIP(req), device_serial: serialNumber, device_id: computerId, result: 'error', error_detail: String(message) });
          return new Response(message, { ...CORS_HEADERS, status });
        }
      }
    },

    "/api/update-info/:deviceType/:preloadId/:computerId": {
      async PUT(req) {
        const body = await req.json() as JAMFResponse;
        const deviceType = req.params.deviceType;
        const preloadId = decodeURIComponent(req.params.preloadId);
        const computerId = decodeURIComponent(req.params.computerId);
        const isMobileDevice = deviceType === 'mobiledevices';

        const { serialNumber, username, emailAddress, building, room, assetTag, buildingId, email } = body;
        const preloadData = {
          deviceType: isMobileDevice ? 'Mobile Device' : 'Computer',
          serialNumber,
          username,
          emailAddress: emailAddress || email || '', // Try both field names
          building,
          room,
          assetTag
        };

        logger.info({ preloadId, computerId, deviceType }, 'Updating preload record');
        logger.debug({ preloadData }, 'Preload data being sent');

        try {
          const token = await utils.getJAMFToken();
          const noPreload = preloadId === 'undefined' || preloadId === 'N/A' || preloadId === 'none';
          const preloadApiUrl = noPreload
              ? `${JAMF_INSTANCE}/api/v2/inventory-preload/records`
              : `${JAMF_INSTANCE}/api/v2/inventory-preload/records/${preloadId}`;
          const preloadMethod = noPreload ? 'post' : 'put';

          const preloadResponse = await axios[preloadMethod](preloadApiUrl, preloadData, {
            headers: { Authorization: `Bearer ${token}` }
          });

          // Update device inventory (mobile or computer)
          if (computerId === 'undefined' || computerId === 'N/A' || computerId === 'none') {
            writeAudit({ action: 'update_info', actor: getActor(req), ip: getIP(req), device_serial: serialNumber, details: { username, email: emailAddress || email, building, room, assetTag }, result: 'success' });
            return new Response(JSON.stringify({ preload: preloadResponse.data, device: null }), { ...CORS_HEADERS, status: 200 });
          }

          if (isMobileDevice) {
            // Update mobile device inventory
            try {
              const mobileDeviceData: any = {
                location: {
                  username: username || '',
                  emailAddress: emailAddress || email || '',
                  room: room || ''
                },
                assetTag: assetTag || ''
              };
              
              // Only include buildingId if it's provided and not empty
              if (buildingId) {
                mobileDeviceData.location.buildingId = buildingId;
              }
              
              logger.debug({ mobileDeviceData }, 'Mobile device data being sent');
              const mobileResponse = await axios.patch(
                `${JAMF_INSTANCE}/api/v2/mobile-devices/${computerId}`,
                mobileDeviceData,
                { headers: { Authorization: `Bearer ${token}` } }
              );
              logger.info({ status: mobileResponse.status }, 'Mobile device update response');
              writeAudit({ action: 'update_info', actor: getActor(req), ip: getIP(req), device_serial: serialNumber, device_id: computerId, details: { username, email: emailAddress || email, building, room, assetTag }, result: 'success' });
              return new Response(JSON.stringify({ preload: preloadResponse.data, device: mobileResponse.data }), { ...CORS_HEADERS, status: 200 });
            } catch (err: any) {
              logger.error({ err: err.response?.data || err.message }, 'Failed to update mobile device information');
              writeAudit({ action: 'update_info', actor: getActor(req), ip: getIP(req), device_serial: serialNumber, device_id: computerId, details: { username, email: emailAddress || email, building, room, assetTag }, result: 'error', error_detail: String(err.response?.data || err.message) });
              return new Response(JSON.stringify({ preload: preloadResponse.data, device: null, error: 'Failed to update mobile device information' }), { ...CORS_HEADERS, status: 500 });
            }
          }

          // Update computer inventory
          try {
            const computerData = {
              general: { assetTag },
              userAndLocation: { username, email: emailAddress || email, buildingId, room }
            };
            logger.debug('Computer data being sent:', JSON.stringify(computerData, null, 2));
            const computerResponse = await axios.patch(`${JAMF_INSTANCE}/api/v1/computers-inventory-detail/${computerId}`, computerData, {
              headers: { Authorization: `Bearer ${token}` }
            });
            logger.info('Computer update response:', computerResponse.status);
            writeAudit({ action: 'update_info', actor: getActor(req), ip: getIP(req), device_serial: serialNumber, device_id: computerId, details: { username, email: emailAddress || email, building, room, assetTag }, result: 'success' });
            return new Response(JSON.stringify({ preload: preloadResponse.data, computer: computerResponse.data }), { ...CORS_HEADERS, status: 200 });
          } catch (err: any) {
            logger.error('Failed to update computer information:', err.response?.data || err.message);
            writeAudit({ action: 'update_info', actor: getActor(req), ip: getIP(req), device_serial: serialNumber, device_id: computerId, details: { username, email: emailAddress || email, building, room, assetTag }, result: 'error', error_detail: String(err.response?.data || err.message) });
            return new Response(JSON.stringify({ preload: preloadResponse.data, computer: null, error: 'Failed to update computer information' }), { ...CORS_HEADERS, status: 500 });
          }
        } catch (error: any) {
          logger.error({ err: error.response?.data || error.message }, 'Error updating preload/computer information');
          writeAudit({ action: 'update_info', actor: getActor(req), ip: getIP(req), device_serial: serialNumber, device_id: computerId, result: 'error', error_detail: String(error.response?.data || error.message) });
          return new Response(`Error updating preload/computer information: ${JSON.stringify(error.response?.data || error.message)}`, { ...CORS_HEADERS, status: 500 });
        }
      }
    },

    "/api/audit-log": {
      async GET(req) {
        const url = new URL(req.url, `http://${req.headers.get('host') || 'localhost'}`);
        const limit = parseInt(url.searchParams.get('limit') ?? '100', 10);
        const entries = getAuditLog(limit);
        return new Response(JSON.stringify(entries), { ...CORS_HEADERS, status: 200 });
      }
    },

    "/api/approvals": {
      async POST(req) {
        try {
          const body = await req.json() as { action: string; justification?: string; deviceSerial: string; deviceId?: string; deviceAssetTag?: string; payload: object };
          const { action, justification, deviceSerial, deviceId, deviceAssetTag, payload } = body;
          const requester = getActor(req);

          const id = createApproval({ action, requester, justification, device_serial: deviceSerial, device_id: deviceId, device_asset_tag: deviceAssetTag, payload });
          logger.info({ action, requester, deviceSerial, justification }, 'Approval request created');
          return new Response(JSON.stringify({ id }), { ...CORS_HEADERS, status: 201 });
        } catch (error: any) {
          return new Response(JSON.stringify({ error: error.message }), { ...CORS_HEADERS, status: 500 });
        }
      }
    },

    "/api/approvals/pending": {
      async GET() {
        const pending = getPendingApprovals();
        return new Response(JSON.stringify({ count: pending.length, items: pending }), { ...CORS_HEADERS, status: 200 });
      }
    },

    "/api/approvals/:id/approve": {
      async POST(req) {
        try {
          const id = parseInt(req.params.id, 10);
          const approver = getActor(req);

          const pending = getPendingApprovals();
          const approval = (pending as any[]).find((a: any) => a.id === id);
          if (!approval) {
            return new Response(JSON.stringify({ error: 'Approval not found or already resolved' }), { ...CORS_HEADERS, status: 404 });
          }

          if (approval.requester.toLowerCase() === approver.toLowerCase()) {
            return new Response(JSON.stringify({ error: 'A second admin must approve — you cannot approve your own request' }), { ...CORS_HEADERS, status: 400 });
          }

          resolveApproval(id, approver, 'approved');

          // Execute the actual action
          const payload = JSON.parse(approval.payload);
          let actionResult: Response;
          if (approval.action === 'wipe') {
            actionResult = await utils.wipeDevice(payload.computerId);
          } else if (approval.action === 'retire') {
            const { computerId, serialNumber, macAddress, altMacAddress } = payload;
            const token = await utils.getJAMFToken();
            actionResult = await utils.wipeDevice(computerId);
            if (actionResult.status === 200) {
              await axios.delete(`${JAMF_INSTANCE}/api/v1/computers-inventory/${computerId}`, { headers: { Authorization: `Bearer ${token}` } });
            }
          } else {
            actionResult = new Response('Unknown action', { ...CORS_HEADERS, status: 400 });
          }

          writeAudit({ action: approval.action, actor: `${approval.requester} (req) / ${approver} (appr)`, ip: getIP(req), device_serial: approval.device_serial, device_id: approval.device_id, result: actionResult.status < 300 ? 'success' : 'error' });
          logger.info({ action: approval.action, requester: approval.requester, approver, deviceSerial: approval.device_serial }, 'Approval executed');

          return new Response(JSON.stringify({ status: 'approved', actionStatus: actionResult.status }), { ...CORS_HEADERS, status: 200 });
        } catch (error: any) {
          return new Response(JSON.stringify({ error: error.message }), { ...CORS_HEADERS, status: 500 });
        }
      }
    },

    "/api/approvals/:id/reject": {
      async POST(req) {
        try {
          const id = parseInt(req.params.id, 10);
          const approver = getActor(req);

          const pending = getPendingApprovals();
          const approval = (pending as any[]).find((a: any) => a.id === id);
          if (!approval) {
            return new Response(JSON.stringify({ error: 'Approval not found or already resolved' }), { ...CORS_HEADERS, status: 404 });
          }

          resolveApproval(id, approver, 'rejected');
          writeAudit({ action: `${approval.action}_rejected`, actor: approver, ip: getIP(req), device_serial: approval.device_serial, device_id: approval.device_id, result: 'success' });
          logger.info({ action: approval.action, requester: approval.requester, approver, deviceSerial: approval.device_serial }, 'Approval rejected');

          return new Response(JSON.stringify({ status: 'rejected' }), { ...CORS_HEADERS, status: 200 });
        } catch (error: any) {
          return new Response(JSON.stringify({ error: error.message }), { ...CORS_HEADERS, status: 500 });
        }
      }
    },

    "/api/config": {
          async GET() {
            const skip = process.env.SKIP_ENTRA_AUTH === 'true';
            return new Response(JSON.stringify({ skipEntraAuth: skip }), { ...CORS_HEADERS, status: 200 });
          }
        },
        "/api/*": {
      async OPTIONS() {
        return new Response('CORS preflight', CORS_HEADERS);
      }
    },

    "/*": () => new Response(notFound, { headers: { "Content-Type": "text/html" }, status: 404 }),
  },

  error() {
    return new Response("Error: Internal Server Error", { ...CORS_HEADERS, status: 500 });
  },
});

console.log(`Bun version: ${Bun.version_with_sha}`);
console.log(`Server listening on ${server.url}`);