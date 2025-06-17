import axios from "axios";
import notFound from "/app/404.html";

const {
  CLEARPASS_INSTANCE,
  CLEARPASS_CLIENT_ID,
  CLEARPASS_CLIENT_SECRET,

  GLPI_INSTANCE,
  GLPI_APP_TOKEN,
  GLPI_USER_TOKEN,

  JAMF_INSTANCE,
  JAMF_CLIENT_ID,
  JAMF_CLIENT_SECRET,

  SERVER_API_HOSTNAME,
  SERVER_API_PORT,
  CLIENT_HOSTNAME,
} = process.env;
const tokenUrl = `${JAMF_INSTANCE}/api/oauth/token`;

// Set default headers for axios
axios.defaults.headers.common["Accept"] = "application/json";
axios.defaults.headers.common["Content-Type"] = "application/json";

const CORS_HEADERS: ResponseInit = {
  headers: {
    "Access-Control-Allow-Origin": `https://${CLIENT_HOSTNAME}`,
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Accept, Authorization",
    "Access-Control-Allow-Credentials": "false",
    "Accept": "application/json",
    "Content-Type": "application/json",
    "Cache-Control": "no-cache",
  },
};

type ComputerMatch = { id: number; serial_number: string; };

type JAMFResponse = {
  serialNumber: string;
  currentPrestage: string;
  computerId: number;
  name: string;
  assetTag: string;
  enrollmentObjectName: string;
  prestageId: number | null;
  username: string | null;
  email: string | null;
  building: string | null;
  room: string | null;
  emailAddress: string | null;
  buildingId?: number | null;
  preloadId?: number | null;
};

// Get the access token using client credentials
async function getJAMFToken(): Promise<string> {
  const response = await axios.post(tokenUrl, {
    grant_type: "client_credentials",
    client_id: JAMF_CLIENT_ID,
    client_secret: JAMF_CLIENT_SECRET,
  }, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
  });
  return response.data.access_token;
}

// Function to get GLPI session token
async function getGLPIToken() {
  return await axios.get(`${GLPI_INSTANCE}/initSession/`, {
    headers: {
      'Content-Type': 'application/json',
      'App-Token': GLPI_APP_TOKEN,
      'Authorization': `user_token ${GLPI_USER_TOKEN}`,
    },
  });
}

// Function to cleanup GLPI session
async function cleanupGLPI(session_token: string) {
  return await axios.get(`${GLPI_INSTANCE}/killSession/`, {
    headers: {
      'Content-Type': 'application/json',
      'App-Token': GLPI_APP_TOKEN,
      'Session-Token': session_token,
    },
  });
}

// Function to get Clearpass access token
async function getClearpassToken() {
  const clearpassResp = await axios.post(`${CLEARPASS_INSTANCE}/oauth/token`, {
    grant_type: "client_credentials",
    client_id: CLEARPASS_CLIENT_ID,
    client_secret: CLEARPASS_CLIENT_SECRET,
  }, {
    headers: { 'Content-Type': 'application/json' }
  });

  if (clearpassResp.status !== 200) {
    throw new Error(`Failed to retrieve Clearpass access token: ${clearpassResp.status} ${clearpassResp.data}`);
  }

  console.log(`Successfully retrieved Clearpass access token: ${clearpassResp.data.access_token}`);
  return clearpassResp.data.access_token;
}

// Function to delete a MAC address from Clearpass
async function deleteClearpassMAC(macAddress: string): Promise<any> {
  const token = await getClearpassToken();

  const response = await axios.delete(`${CLEARPASS_INSTANCE}/api/endpoint/mac-address/${macAddress}`, {
    headers: {
      Authorization: `Bearer ${token}`,
    }
  });

  if (response.status !== 204) {
    throw new Error(`Failed to delete MAC address from Clearpass: ${response.status} ${response.data}`);
  }

  console.log(`Successfully deleted MAC address ${macAddress} from Clearpass`);
  return response.data;
}

// Function to match computers by serial number or name or id, etc.
async function matchComputer(search: string): Promise<ComputerMatch[]> {
  const token = await getJAMFToken();
  const apiUrl = `${JAMF_INSTANCE}/JSSResource/computers/match/${search}`;
  const response = await axios.get(apiUrl, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (response.data && response.data.computers && Array.isArray(response.data.computers)) {
    return response.data.computers.map((item: any) => ({
      id: item.id,
      serial_number: item.serial_number
    })) as ComputerMatch[];
  }
  throw new Error('Unexpected response format');
}

// Function to get all prestages & their IDs
async function getPrestages(): Promise<{ id: number; displayName: string; versionLock: string }[]> {
  const token = await getJAMFToken();
  const apiUrl = `${JAMF_INSTANCE}/api/v3/computer-prestages?page=0&page-size=100&sort=id%3Adesc`;
  const response = await axios.get<{ results: { id: number; displayName: string; versionLock?: string }[] }>(apiUrl, {
    headers: { Authorization: `Bearer ${token}` }
  });
  return response.data.results.map((prestage) => ({
    id: prestage.id,
    displayName: prestage.displayName,
    versionLock: prestage.versionLock || 'N/A'
  }));
}

// Function to get prestage assignments for a given serial number
async function getPrestageAssignments(serialNumber: string): Promise<{ serialNumber: string; displayName: string }> {
  const token = await getJAMFToken();
  const apiUrl = `${JAMF_INSTANCE}/api/v2/computer-prestages/scope`;
  const response = await axios.get<{ serialsByPrestageId: Record<string, number> }>(apiUrl, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const assignments = response.data.serialsByPrestageId;
  const prestages = await getPrestages();
  const prestageId = assignments[serialNumber];
  if (prestageId) {
    const prestage = prestages.find((p: { id: number }) => p.id === prestageId);
    if (prestage) {
      return { serialNumber, displayName: prestage.displayName };
    }
  }
  return { serialNumber, displayName: 'Unassigned' };
}

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
          const prestages = await getPrestages();
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
          const prestages = await getPrestages();
          const prestage = prestages.find(p => p.id === Number(prestageId));
          if (!prestage) {
            return new Response('Prestage not found', { ...CORS_HEADERS, status: 404 });
          }

          const token = await getJAMFToken();
          const response = await axios.post(
            `${JAMF_INSTANCE}/api/v2/computer-prestages/${prestage.id}/scope`,
            { serialNumbers: [serialNumber], versionLock: prestage.versionLock },
            { headers: { Authorization: `Bearer ${token}` } }
          );
          return new Response(JSON.stringify(response.data), { ...CORS_HEADERS, status: 200 });
        } catch (error: any) {
          const status = error?.response?.status;
          if (status === 400) {
            return new Response('Please remove from current prestage before adding', { ...CORS_HEADERS, status: 400 });
          }
          return new Response('Error adding device to prestage', { ...CORS_HEADERS, status: 500 });
        }
      },

      async DELETE(req) {
        const { prestageId, serialNumber } = req.params;
        console.log(`Removing device with serial number: ${serialNumber} from prestage: ${prestageId}`);

        try {
          const prestages = await getPrestages();
          const prestage = prestages.find(p => p.displayName === prestageId);
          if (!prestage) {
            return new Response('Prestage not found', { ...CORS_HEADERS, status: 404 });
          }
          const token = await getJAMFToken();
          const response = await axios.post(
            `${JAMF_INSTANCE}/api/v2/computer-prestages/${prestage.id}/scope/delete-multiple`,
            { serialNumbers: [serialNumber], versionLock: prestage.versionLock },
            { headers: { Authorization: `Bearer ${token}` } }
          );
          return new Response(JSON.stringify(response.data), { ...CORS_HEADERS, status: 200 });
        } catch {
          return new Response('Error removing device from prestage', { ...CORS_HEADERS, status: 500 });
        }
      }
    },

    "/api/buildings": {
      async GET() {
        try {
          const token = await getJAMFToken();
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
          const computers = await matchComputer(search);
          const token = await getJAMFToken();
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
                  `${JAMF_INSTANCE}/api/v1/computers-inventory/${id}?section=GENERAL`,
                  { headers: { Authorization: `Bearer ${token}` } }
                );

                const prestage = await getPrestageAssignments(serial_number);
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
                  macAddress: compRes.data?.hardware.macAddress || 'N/A',
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

        try {
          const token = await getJAMFToken();
          const apiUrl = `${JAMF_INSTANCE}/api/v1/computer-inventory/${computerId}/erase`;
          const response = await axios.post(apiUrl,
            { pin: "123456" },
            { headers: { Authorization: `Bearer ${token}` } });

          return new Response(JSON.stringify(response.data), { ...CORS_HEADERS, status: 200 });
        } catch (error: any) {
          const status = error?.response?.status;
          const message = error?.message || 'Error wiping device';
          return new Response(message, { status: status });
        }
      }
    },

    "/api/retiredevice/:computerId/:serialNumber/:macAddress": {
      async DELETE(req) {
        const { computerId, serialNumber, macAddress } = req.params;
        console.log(`Retiring device with ID: ${computerId}`);

        return new Response('Not yet implemented.', { ...CORS_HEADERS, status: 501 });

        try {
          // Get JAMF API token and retire (delete) the device from JAMF
          const token = await getJAMFToken();
          const jamfResp = await axios.delete(`${JAMF_INSTANCE}/api/v1/computer-inventory/${computerId}`, {
            headers: { Authorization: `Bearer ${token}` }
          });

          if (jamfResp.status !== 204) {
            return new Response('Failed to retire device on JAMF', { ...CORS_HEADERS, status: 500 });
          }

          // Start a GLPI session to update the device state
          const glpiTokenResp = await getGLPIToken();
          const sessionToken = glpiTokenResp.data.session_token;
          if (!sessionToken) {
            return new Response('Failed to get GLPI session token', { ...CORS_HEADERS, status: 500 });
          }

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
          if (searchResp.data.totalcount !== 1) {
            return new Response('Computer not found or multiple found in GLPI', { ...CORS_HEADERS, status: 500 });
          }

          // Update the computer state in GLPI to "Out of Service > Salvaged" (state ID 18)
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

          // Cleanup GLPI session
          console.log('Cleaning up GLPI session...');
          const cleanup = await cleanupGLPI(sessionToken);
          console.log('Cleanup response:', cleanup.data);

          // Remove MAC address from Clearpass
          if (macAddress) {
            console.log(`Deleting MAC address ${macAddress} from Clearpass...`);
            await deleteClearpassMAC(macAddress);
            console.log(`MAC address ${macAddress} deleted from Clearpass`);
          }

          return new Response('Device retired successfully', { ...CORS_HEADERS, status: 200 });
        } catch (error: any) {
          const status = error?.response?.status || 500;
          const message = error?.message || 'Error retiring device';
          return new Response(message, { ...CORS_HEADERS, status });
        }
      }
    },

    "/api/update-preload/:preloadId/:computerId": {
      async PUT(req) {
        const body = await req.json() as JAMFResponse;
        const { preloadId, computerId } = req.params;

        console.log(`Updating preload with ID: ${preloadId} for computer ID: ${computerId}`);
        console.log(`Request body: ${JSON.stringify(body)}`);


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
        try {
          const token = await getJAMFToken();
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
        } catch (err: any) {
          const { response } = err;
          if (response) {
            return new Response(response.data, { status: response.status });
          } else {
            return new Response('Error updating preload/computer information', { ...CORS_HEADERS, status: 500 });
          }
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