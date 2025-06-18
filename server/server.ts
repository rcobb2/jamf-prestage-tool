import axios from "axios";
import * as utils from "./utils.ts";
import { CORS_HEADERS, type JAMFResponse } from "./utils.ts";
import notFound from "/app/404.html";

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

    "/api/change-prestage/:prestageId/:serialNumber": {
      async POST(req) {
        const { serialNumber, prestageId } = req.params;
        console.log(`Adding device with serial number: ${serialNumber} to prestage ID: ${prestageId}`);

        try {
          const availiblePrestages = await utils.getPrestages();
          const prestage = availiblePrestages.find(p => p.id === prestageId);

          if (!prestage) {
            return new Response('Prestage not found', { ...CORS_HEADERS, status: 404 });
          }

          const token = await utils.getJAMFToken();
          const response = await axios.put(
            `${JAMF_INSTANCE}/api/v2/computer-prestages/${prestage.id}/scope`,
            { serialNumbers: [serialNumber], versionLock: prestage.versionLock },
            { headers: { Authorization: `Bearer ${token}` } }
          );

          return new Response(JSON.stringify(response.data), { ...CORS_HEADERS, status: 200 });
        } catch (error: any) {
          const status = error?.response?.status;
          if (status === 400) {
            return new Response(`Please remove from current prestage before adding: ${JSON.stringify(error.response.data)}`, { ...CORS_HEADERS, status: 400 });
          }
          return new Response(`Error adding device to prestage: ${JSON.stringify(error.response.data)}`, { ...CORS_HEADERS, status: 500 });
        }
      },

      async DELETE(req) {
        const { prestageId, serialNumber } = req.params;
        console.log(`Removing device with serial number: ${serialNumber} from prestage: ${prestageId}`);

        try {
          const availiblePrestages = await utils.getPrestages();
          const prestage = availiblePrestages.find(p => p.id === prestageId);

          if (!prestage) {
            return new Response('Prestage not found', { ...CORS_HEADERS, status: 404 });
          }

          const token = await utils.getJAMFToken();
          const response = await axios.post(
            `${JAMF_INSTANCE}/api/v2/computer-prestages/${prestage.id}/scope/delete-multiple`,
            { serialNumbers: [serialNumber], versionLock: prestage.versionLock },
            { headers: { Authorization: `Bearer ${token}` } }
          );

          return new Response(JSON.stringify(response.data), { ...CORS_HEADERS, status: 200 });
        } catch (error: any) {
          return new Response(`Error removing device from prestage: ${JSON.stringify(error.response.data)}`, { ...CORS_HEADERS, status: 500 });
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

    "/api/data/:search": {
      async GET(req) {
        const { search } = req.params;
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
                return devicesRes.data.results.filter(device => device.serialNumber === search);
              })
            );

            const flatDevices = enrollmentDevices.flat();

            results = await Promise.all(
              flatDevices.map(async (device) => {
                const preloadRes = await axios.get<{ results: any[] }>(
                  `${JAMF_INSTANCE}/api/v2/inventory-preload/records?page=0&page-size=1&filter=serialNumber%3D%3D${device.serialNumber}`,
                  { headers: { Authorization: `Bearer ${token}` } }
                );
                const preload = preloadRes.data.results[0] || {};
                // If preload is empty, return early with 404
                if (!preload || Object.keys(preload).length === 0) {
                  return new Response('No computers found', { ...CORS_HEADERS, status: 404 });
                }

                return {
                  assetTag: 'N/A',
                  serialNumber: device.serialNumber,
                  preloadId: preload.id,
                  username: preload.username,
                  email: preload.emailAddress,
                  building: preload.building,
                  room: preload.room,
                };
              })
            );
          } else {
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
        } catch {
          return new Response('Error fetching data', { ...CORS_HEADERS, status: 500 });
        }
      }
    },

    "/api/wipedevice/:computerId": {
      async DELETE(req) {
        const { computerId } = req.params;
        console.log(`Wiping device with ID: ${computerId}`);

        return await utils.wipeDevice(computerId)
      }
    },

    "/api/retiredevice/:computerId/:serialNumber/:macAddress/:altMacAddress": {
      async DELETE(req) {
        const { computerId, serialNumber, macAddress, altMacAddress } = req.params;
        console.log(`Retiring device with ID: ${computerId}`);

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

          console.log(`GPLI not in use yet, skipping GLPI retirement steps.`);
          // Search for the computer in GLPI by serial number
          // const params = new URLSearchParams({
          //   'criteria[0][field]': '5', // Field 5 is usually serial number in GLPI
          //   'criteria[0][searchtype]': 'contains',
          //   'criteria[0][value]': `^${serialNumber}$`,
          // });

          // const searchResp = await axios.get(`${GLPI_INSTANCE}/search/Computer`, {
          //   headers: {
          //     'Content-Type': 'application/json',
          //     'App-Token': GLPI_APP_TOKEN,
          //     'Session-Token': sessionToken,
          //   },
          //   params,
          // });

          // // Ensure exactly one computer is found in GLPI
          // if (searchResp.data.totalcount !== 1) {
          //   return new Response('Computer not found or multiple found in GLPI', { ...CORS_HEADERS, status: 500 });
          // }

          // // Update the computer state in GLPI to "Out of Service > Salvaged" (state ID 18)
          // const computerIdGLPI = searchResp.data.data[0][2];
          // await axios.put(`${GLPI_INSTANCE}/Computer/${computerIdGLPI}`, {
          //   input: { states_id: 18 } // 18 is the ID for "Out of Service > Salvaged"
          // }, {
          //   headers: {
          //     "Content-Type": "application/json",
          //     "App-Token": GLPI_APP_TOKEN,
          //     "Session-Token": sessionToken,
          //   },
          // });

          // // Cleanup GLPI session
          // console.log('Cleaning up GLPI session...');
          // const cleanup = await cleanupGLPI(sessionToken);
          // console.log('Cleanup response:', cleanup.data);

          // Remove MAC address from Clearpass
          if (macAddress && altMacAddress) {
            console.log(`Deleting MAC address ${macAddress} from Clearpass...`);
            await utils.deleteClearpassMAC(macAddress);

            console.log(`Deleting MAC address ${altMacAddress} from Clearpass...`);
            await utils.deleteClearpassMAC(altMacAddress);
          }

          return new Response('Device retired successfully', { ...CORS_HEADERS, status: 200 });
        } catch (error: any) {
          const status = error?.response?.status || 500;
          const message = error?.response?.data || error?.message || 'Error retiring device';
          return new Response(message, { ...CORS_HEADERS, status });
        }
      }
    },

    "/api/update-preload/:preloadId/:computerId": {
      async PUT(req) {
        const body = await req.json() as JAMFResponse;
        const { preloadId, computerId } = req.params;
        const { serialNumber, username, emailAddress, building, room, assetTag, buildingId } = body;
        const preloadData = {
          deviceType: 'Computer',
          serialNumber,
          username,
          emailAddress,
          building,
          room,
          assetTag
        };
        const computerData = {
          general: { assetTag },
          userAndLocation: { username, email: emailAddress, buildingId, room }
        };
        console.log(`Updating preload with ID: ${preloadId} for computer ID: ${computerId}`);

        try {
          const token = await utils.getJAMFToken();
          const preloadApiUrl =
            preloadId && preloadId !== 'null'
              ? `${JAMF_INSTANCE}/api/v2/inventory-preload/records/${preloadId}`
              : `${JAMF_INSTANCE}/api/v2/inventory-preload/records`;
          const preloadMethod = preloadId && preloadId !== 'null' ? 'put' : 'post';
          const preloadResponse = await (axios as any)[preloadMethod](preloadApiUrl, preloadData, {
            headers: { Authorization: `Bearer ${token}` }
          });
          try {
            const computerApiUrl = `${JAMF_INSTANCE}/api/v1/computers-inventory-detail/${computerId}`;
            const computerResponse = await axios.patch(computerApiUrl, computerData, {
              headers: { Authorization: `Bearer ${token}` }
            });
            return new Response(JSON.stringify({ preload: preloadResponse.data, computer: computerResponse.data }), { ...CORS_HEADERS, status: 200 });
          } catch {
            return new Response(JSON.stringify({ preload: preloadResponse.data, computer: null, error: 'Failed to update computer information' }), { ...CORS_HEADERS, status: 200 });
          }
        } catch (error: any) {
          return new Response(`Error updating preload/computer information: ${JSON.stringify(error.response?.data)}`, { ...CORS_HEADERS, status: 500 });
        }
      }
    },

    "/api/*": {
      async OPTIONS() {
        return new Response('CORS preflight', CORS_HEADERS);
      }
    },

    "/*": notFound,
  },

  error() {
    return new Response("Error: Internal Server Error", { ...CORS_HEADERS, status: 500 });
  },
});

console.log(`Server listening on ${server.url}`);