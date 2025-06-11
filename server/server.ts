import axios from "axios";

const baseUrl = process.env.JAMF_INSTANCE as string;
const clientId = process.env.JAMF_CLIENT_ID as string;
const clientSecret = process.env.JAMF_CLIENT_SECRET as string;
const server_API_URL = process.env.SERVER_API_HOSTNAME as string;
const tokenUrl = `${baseUrl}/api/oauth/token`;

// CORS helper
function setCORSHeaders(res: ResponseInit): ResponseInit {
  const headers = new Headers();
  headers.set("Access-Control-Allow-Origin", `https://${server_API_URL}`);
  headers.set("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE");
  headers.set("Access-Control-Allow-Headers", "Content-Type, Accept, Authorization");
  return { ...res, headers };
}

// Get the access token using client credentials
async function getToken(): Promise<string> {
  const response = await axios.post(tokenUrl, {
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret
  }, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
  });
  return response.data.access_token;
}

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

async function matchComputer(search: string): Promise<ComputerMatch[]> {
  const token = await getToken();
  const apiUrl = `${baseUrl}/JSSResource/computers/match/${search}`;
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

async function getPrestages(): Promise<{ id: number; displayName: string; versionLock: string }[]> {
  const token = await getToken();
  const apiUrl = `${baseUrl}/api/v3/computer-prestages?page=0&page-size=100&sort=id%3Adesc`;
  const response = await axios.get<{ results: { id: number; displayName: string; versionLock?: string }[] }>(apiUrl, {
    headers: { Authorization: `Bearer ${token}` }
  });
  return response.data.results.map((prestage) => ({
    id: prestage.id,
    displayName: prestage.displayName,
    versionLock: prestage.versionLock || 'N/A'
  }));
}

async function getPrestageAssignments(serialNumber: string): Promise<{ serialNumber: string; displayName: string }> {
  const token = await getToken();
  const apiUrl = `${baseUrl}/api/v2/computer-prestages/scope`;
  const response = await axios.get<{ serialsByPrestageId: Record<string, number> }>(apiUrl, {
    headers: { Authorization: `Bearer ${token}`, accept: 'application/json' }
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
  development: true,
  hostname: process.env.SERVER_API_HOSTNAME,
  port: process.env.SERVER_API_PORT,
  tls: {
    key: Bun.file("server.key"),
    cert: Bun.file("server.cert"),
  },
  routes: {
    "/api/prestages": {
      async GET() {
        try {
          const prestages = await getPrestages();
          return new Response(JSON.stringify(prestages), setCORSHeaders({ status: 200, headers: { "Content-Type": "application/json" } }));
        } catch {
          return new Response('Error fetching prestages', setCORSHeaders({ status: 500 }));
        }
      }
    },

    "/api/buildings": {
      async GET() {
        try {
          const token = await getToken();
          const apiUrl = `${baseUrl}/api/v1/buildings?page=0&page-size=100&sort=id%3Aasc`;
          const response = await axios.get<{ results: any[] }>(apiUrl, {
            headers: { accept: 'application/json', Authorization: `Bearer ${token}` }
          });
          return new Response(JSON.stringify(response.data.results), setCORSHeaders({ status: 200, headers: { "Content-Type": "application/json" } }));
        } catch {
          return new Response('Failed to fetch buildings', setCORSHeaders({ status: 500 }));
        }
      }
    },

    "/api/wipedevice/:computerId": {
      async DELETE(req) {
        const { computerId } = req.params;
        console.log(`Wiping device with ID: ${computerId}`);

        try {
          const token = await getToken();
          const apiUrl = `${baseUrl}/api/v1/computer-inventory/${computerId}/erase`;
          const response = await axios.post(apiUrl, {
            pin: "123456"
          }, {
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          });

          return new Response(JSON.stringify(response.data), setCORSHeaders({ status: 200, headers: { "Content-Type": "application/json" } }));
        } catch (error: any) {
          const status = error?.response?.status;
          const message = error?.message || 'Error wiping device';
          return new Response(message, setCORSHeaders({ status: status }));
        }
      }
    },

    "/api/data/:search": {
      async GET(req) {
        const { search } = req.params;
        try {
          const computers = await matchComputer(search);
          const token = await getToken();
          let results: any[] = [];

          if (computers.length === 0) {
            // Search device enrollments if no computers found
            const enrollmentsRes = await axios.get<{ results: any[] }>(
              `${baseUrl}/api/v1/device-enrollments?page=0&page-size=100`,
              { headers: { accept: 'application/json', Authorization: `Bearer ${token}` } }
            );

            const enrollmentDevices = await Promise.all(
              enrollmentsRes.data.results.map(async (instance) => {
                const devicesRes = await axios.get<{ results: any[] }>(
                  `${baseUrl}/api/v1/device-enrollments/${instance.id}/devices`,
                  { headers: { accept: 'application/json', Authorization: `Bearer ${token}` } }
                );
                return devicesRes.data.results.filter(device => device.serialNumber === search);
              })
            );

            const flatDevices = enrollmentDevices.flat();

            results = await Promise.all(
              flatDevices.map(async (device) => {
                const preloadRes = await axios.get<{ results: any[] }>(
                  `${baseUrl}/api/v2/inventory-preload/records?page=0&page-size=1&filter=serialNumber%3D%3D${device.serialNumber}`,
                  { headers: { Authorization: `Bearer ${token}` } }
                );
                const preload = preloadRes.data.results[0] || {};
                return {
                  assetTag: 'No asset tag yet',
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
                const [compRes, prestage, preloadRes] = await Promise.all([
                  axios.get<{ id: number; general: any }>(
                    `${baseUrl}/api/v1/computers-inventory/${id}?section=GENERAL`,
                    { headers: { Authorization: `Bearer ${token}` } }
                  ),
                  getPrestageAssignments(serial_number),
                  axios.get<{ results: any[] }>(
                    `${baseUrl}/api/v2/inventory-preload/records?page=0&page-size=1&filter=serialNumber%3D%3D${serial_number}`,
                    { headers: { Authorization: `Bearer ${token}` } }
                  )
                ]);
                const general = compRes.data.general || {};
                const preload = preloadRes.data.results[0] || {};
                return {
                  computerId: compRes.data.id,
                  name: general.name || 'N/A',
                  assetTag: general.assetTag || 'N/A',
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
            return new Response('No computers found', setCORSHeaders({ status: 404 }));
          } else {
            return new Response(JSON.stringify(results), setCORSHeaders({ status: 200, headers: { "Content-Type": "application/json" } }));
          }
        } catch {
          return new Response('Error fetching data', setCORSHeaders({ status: 500 }));
        }
      }
    }
  },


  async fetch(req) {
    const url = new URL(req.url);
    const { method } = req;

    // CORS preflight
    if (method === "OPTIONS") {
      return new Response(null, setCORSHeaders({ status: 204 }));
    }

    // /api/remove-from-prestage
    if (url.pathname === "/api/remove-from-prestage" && method === "POST") {
      const body = await req.json() as JAMFResponse;
      console.log(`Removing device with serial number: ${body.serialNumber} from prestage: ${body.currentPrestage}`);

      const { serialNumber, currentPrestage } = body;
      try {
        const prestages = await getPrestages();
        const prestage = prestages.find(p => p.displayName === currentPrestage);
        if (!prestage) {
          return new Response('Prestage not found', setCORSHeaders({ status: 404 }));
        }
        const token = await getToken();
        const response = await axios.post(
          `${baseUrl}/api/v2/computer-prestages/${prestage.id}/scope/delete-multiple`,
          { serialNumbers: [serialNumber], versionLock: prestage.versionLock },
          { headers: { accept: 'application/json', 'content-type': 'application/json', Authorization: `Bearer ${token}` } }
        );
        return new Response(JSON.stringify(response.data), setCORSHeaders({ status: 200, headers: { "Content-Type": "application/json" } }));
      } catch {
        return new Response('Error removing device from prestage', setCORSHeaders({ status: 500 }));
      }
    }

    // /api/add-to-prestage
    if (url.pathname === "/api/add-to-prestage" && method === "POST") {
      const body = await req.json() as JAMFResponse;
      const { serialNumber, prestageId } = body;
      console.log(`Adding device with serial number: ${serialNumber} to prestage ID: ${prestageId}`);

      try {
        const prestages = await getPrestages();
        const prestage = prestages.find(p => p.id === prestageId);
        if (!prestage) {
          return new Response('Prestage not found', setCORSHeaders({ status: 404 }));
        }

        const token = await getToken();
        const response = await axios.post(
          `${baseUrl}/api/v2/computer-prestages/${prestage.id}/scope`,
          { serialNumbers: [serialNumber], versionLock: prestage.versionLock },
          { headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: `Bearer ${token}` } }
        );
        return new Response(JSON.stringify(response.data), setCORSHeaders({ status: 200, headers: { "Content-Type": "application/json" } }));
      } catch (error: any) {
        const status = error?.response?.status;
        if (status === 400) {
          return new Response('Please remove from current prestage before adding', setCORSHeaders({ status: 400 }));
        }
        return new Response('Error adding device to prestage', setCORSHeaders({ status: 500 }));
      }
    }

    // /api/update-preload/:preloadId/:computerId
    if (url.pathname.startsWith("/api/update-preload/") && method === "PUT") {
      const [, , , preloadId, computerId] = url.pathname.split("/");
      const body = await req.json() as JAMFResponse;
      console.log(`Updating preload with ID: ${preloadId} for computer ID: ${computerId}`);

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
        const token = await getToken();
        const preloadApiUrl =
          preloadId && preloadId !== 'null'
            ? `${baseUrl}/api/v2/inventory-preload/records/${preloadId}`
            : `${baseUrl}/api/v2/inventory-preload/records`;
        const preloadMethod = preloadId && preloadId !== 'null' ? 'put' : 'post';
        const preloadResponse = await (axios as any)[preloadMethod](preloadApiUrl, preloadData, {
          headers: { accept: 'application/json', 'content-type': 'application/json', Authorization: `Bearer ${token}` }
        });
        try {
          const computerApiUrl = `${baseUrl}/api/v1/computers-inventory-detail/${computerId}`;
          const computerResponse = await axios.patch(computerApiUrl, computerData, {
            headers: { accept: 'application/json', 'content-type': 'application/json', Authorization: `Bearer ${token}` }
          });
          return new Response(JSON.stringify({ preload: preloadResponse.data, computer: computerResponse.data }),
            setCORSHeaders({ status: 200, headers: { "Content-Type": "application/json" } }));
        } catch {
          return new Response(JSON.stringify({ preload: preloadResponse.data, computer: null, error: 'Failed to update computer information' }),
            setCORSHeaders({ status: 200, headers: { "Content-Type": "application/json" } }));
        }
      } catch (err: any) {
        const { response } = err;
        if (response) {
          return new Response(response.data, setCORSHeaders({ status: response.status }));
        } else {
          return new Response('Error updating preload/computer information', setCORSHeaders({ status: 500 }));
        }
      }
    }

    // Not found
    return new Response("Not found", { status: 404 });
  },
  error() {
    return new Response("404 Not Found", { status: 404 });
  },
});

console.log(`Server listening on ${server.url}`);