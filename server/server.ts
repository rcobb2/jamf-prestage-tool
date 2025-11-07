import axios from "axios";
import * as utils from "./utils.ts";
import { CORS_HEADERS, type JAMFResponse } from "./utils.ts";

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
        console.log(`Adding ${deviceType} device with serial number: ${serialNumber} to prestage ID: ${prestageId}`);

        try {
          const isMobileDevice = deviceType === 'mobiledevices';
          const token = await utils.getJAMFToken();
          
          // First, find current prestage assignment
          const currentPrestage = isMobileDevice
            ? await utils.getMobilePrestageAssignments(serialNumber)
            : await utils.getPrestageAssignments(serialNumber);
          
          console.log(`Current prestage for ${serialNumber}:`, currentPrestage.displayName);

          // If device is already in a prestage and it's not the target, remove it first
          if (currentPrestage.displayName !== 'Unassigned' && currentPrestage.displayName !== 'N/A') {
            const allPrestages = isMobileDevice
              ? await utils.getMobilePrestages()
              : await utils.getPrestages();
            
            const currentPrestageObj = allPrestages.find(p => p.displayName === currentPrestage.displayName);
            
            if (currentPrestageObj && currentPrestageObj.id !== prestageId) {
              console.log(`Removing from current prestage ${currentPrestageObj.id} before adding to ${prestageId}`);
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
                console.error('Warning: Failed to remove from current prestage:', err.response?.data);
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

          const endpoint = isMobileDevice
            ? `${JAMF_INSTANCE}/api/v2/mobile-device-prestages/${prestage.id}/scope`
            : `${JAMF_INSTANCE}/api/v2/computer-prestages/${prestage.id}/scope`;

          const body: any = { serialNumbers: [serialNumber] };
          if (prestage.versionLock && prestage.versionLock !== 'N/A') {
            body.versionLock = prestage.versionLock;
          }

          const response = await axios.put(endpoint, body, { headers: { Authorization: `Bearer ${token}` } });

          return new Response(JSON.stringify(response.data), { ...CORS_HEADERS, status: 200 });
        } catch (error: any) {
          const status = error?.response?.status;
          if (status === 400) {
            console.error('Add prestage 400 error details:', error.response?.data);
            return new Response(`Error: ${JSON.stringify(error.response.data)}`, { ...CORS_HEADERS, status: 400 });
          }
          console.error('Add prestage error:', status, error.response?.data);
          return new Response(`Error adding device to prestage: ${JSON.stringify(error.response?.data)}`, { ...CORS_HEADERS, status: 500 });
        }
      },      async DELETE(req) {
        const { prestageId, serialNumber, deviceType } = req.params;
        console.log(`Removing ${deviceType} device with serial number: ${serialNumber} from prestage: ${prestageId}`);

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
          console.error('Remove prestage error:', error.response?.status, error.response?.data);
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
        console.log(`[Computer Search] Incoming search for: ${search}`);
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
                const preload = preloadRes.data.results[0] || null;

                return {
                  assetTag: preload?.assetTag || 'N/A',
                  serialNumber: device.serialNumber,
                  preloadId: preload?.id || 'N/A',
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
        console.log(`[Mobile Device Search] Incoming search for: ${search}`);
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
          console.error('Mobile device search error:', error);
          console.error('Error stack:', error.stack);
          return new Response(`${error.message || 'Unknown error'}`, { ...CORS_HEADERS, status: 500 });
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

    // If you want to retire a device, you need to implement your own logic. Otherwise, uncomment the 'Not Implemented' response.
    "/api/retiredevice/:computerId/:serialNumber/:macAddress/:altMacAddress": {
      async DELETE(req) {
        const { computerId, serialNumber, macAddress, altMacAddress } = req.params;
        console.log(`Retiring device with ID: ${computerId}`);

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

          console.log(`GPLI not in use yet, skipping GLPI retirement steps.`);
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
          console.log('Cleaning up GLPI session...');
          const cleanup = await utils.cleanupGLPI(sessionToken);
          console.log('Cleanup response:', cleanup.data);

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

        console.log(`Updating preload with ID: ${preloadId} for ${isMobileDevice ? 'mobile device' : 'computer'} ID: ${computerId}`);
        console.log('Preload data being sent:', JSON.stringify(preloadData, null, 2));

        try {
          const token = await utils.getJAMFToken();
          const preloadApiUrl =
            preloadId === 'undefined' || preloadId === 'N/A'
              ? `${JAMF_INSTANCE}/api/v2/inventory-preload/records` // Create new preload record
              : `${JAMF_INSTANCE}/api/v2/inventory-preload/records/${preloadId}`; // Update existing preload record
          const preloadMethod =
            preloadId === 'undefined' || preloadId === 'N/A'
              ? 'post' // If preloadId is not defined, create a new preload record
              : 'put'; // If preloadId is defined, update the existing record

          const preloadResponse = await axios[preloadMethod](preloadApiUrl, preloadData, {
            headers: { Authorization: `Bearer ${token}` }
          });

          // Update device inventory (mobile or computer)
          if (computerId === 'undefined' || computerId === 'N/A') {
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
              
              console.log('Mobile device data being sent:', JSON.stringify(mobileDeviceData, null, 2));
              const mobileResponse = await axios.patch(
                `${JAMF_INSTANCE}/api/v2/mobile-devices/${computerId}`,
                mobileDeviceData,
                { headers: { Authorization: `Bearer ${token}` } }
              );
              console.log('Mobile device update response:', mobileResponse.status);
              return new Response(JSON.stringify({ preload: preloadResponse.data, device: mobileResponse.data }), { ...CORS_HEADERS, status: 200 });
            } catch (err: any) {
              console.error('Failed to update mobile device information:', err.response?.data || err.message);
              return new Response(JSON.stringify({ preload: preloadResponse.data, device: null, error: 'Failed to update mobile device information' }), { ...CORS_HEADERS, status: 500 });
            }
          }

          // Update computer inventory
          try {
            const computerData = {
              general: { assetTag },
              userAndLocation: { username, email: emailAddress || email, buildingId, room }
            };
            console.log('Computer data being sent:', JSON.stringify(computerData, null, 2));
            const computerResponse = await axios.patch(`${JAMF_INSTANCE}/api/v1/computers-inventory-detail/${computerId}`, computerData, {
              headers: { Authorization: `Bearer ${token}` }
            });
            console.log('Computer update response:', computerResponse.status);
            return new Response(JSON.stringify({ preload: preloadResponse.data, computer: computerResponse.data }), { ...CORS_HEADERS, status: 200 });
          } catch (err: any) {
            console.error('Failed to update computer information:', err.response?.data || err.message);
            return new Response(JSON.stringify({ preload: preloadResponse.data, computer: null, error: 'Failed to update computer information' }), { ...CORS_HEADERS, status: 500 });
          }
        } catch (error: any) {
          console.error('Error updating preload/computer information:', error.response?.data || error.message);
          return new Response(`Error updating preload/computer information: ${JSON.stringify(error.response?.data || error.message)}`, { ...CORS_HEADERS, status: 500 });
        }
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