import axios from 'axios';

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

  CLIENT_HOSTNAME,
} = process.env;
const tokenUrl = `${JAMF_INSTANCE}/api/oauth/token`;

export const CORS_HEADERS: ResponseInit = {
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

export type ComputerMatch = { id: number; serial_number: string; };

export type JAMFResponse = {
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
export async function getJAMFToken(): Promise<string> {
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
export async function getGLPIToken() {
  return await axios.get(`${GLPI_INSTANCE}/initSession/`, {
    headers: {
      'Content-Type': 'application/json',
      'App-Token': GLPI_APP_TOKEN,
      'Authorization': `user_token ${GLPI_USER_TOKEN}`,
    },
  });
}

// Function to cleanup GLPI session
export async function cleanupGLPI(session_token: string) {
  return await axios.get(`${GLPI_INSTANCE}/killSession/`, {
    headers: {
      'Content-Type': 'application/json',
      'App-Token': GLPI_APP_TOKEN,
      'Session-Token': session_token,
    },
  });
}

// Function to get Clearpass access token
export async function getClearpassToken() {
  const clearpassResp = await axios.post(`${CLEARPASS_INSTANCE}/oauth`, {
    grant_type: "client_credentials",
    client_id: CLEARPASS_CLIENT_ID,
    client_secret: CLEARPASS_CLIENT_SECRET,
  });

  if (clearpassResp.status !== 200) {
    throw new Error(`Failed to retrieve Clearpass access token: ${clearpassResp.status} ${clearpassResp.data}`);
  }

  console.log(`Successfully retrieved Clearpass access token: ${clearpassResp.data.access_token}`);
  return clearpassResp.data.access_token;
}

// Function to delete a MAC address from Clearpass
export async function deleteClearpassMAC(macAddress: string): Promise<any> {
  const token = await getClearpassToken();

  const response = await axios.delete(`${CLEARPASS_INSTANCE}/endpoint/mac-address/${macAddress}`, {
    headers: {
      Authorization: `Bearer ${token}`,
    }
  });


  console.log(`Successfully deleted MAC address ${macAddress} from Clearpass`);
  return response.data;
}

// Function to match computers by serial number or name or id, etc.
export async function matchComputer(search: string): Promise<ComputerMatch[]> {
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
export async function getPrestages(): Promise<{ id: string; displayName: string; versionLock: string }[]> {
  const token = await getJAMFToken();
  const apiUrl = `${JAMF_INSTANCE}/api/v3/computer-prestages?page=0&page-size=100&sort=id%3Adesc`;
  const response = await axios.get<{ results: { id: string; displayName: string; versionLock?: string }[] }>(apiUrl, {
    headers: { Authorization: `Bearer ${token}` }
  });
  return response.data.results.map((prestage) => ({
    id: prestage.id,
    displayName: prestage.displayName,
    versionLock: prestage.versionLock || 'N/A'
  }));
}

// Function to get prestage assignments for a given serial number
export async function getPrestageAssignments(serialNumber: string): Promise<{ serialNumber: string; displayName: string }> {
  const token = await getJAMFToken();
  const apiUrl = `${JAMF_INSTANCE}/api/v2/computer-prestages/scope`;
  const response = await axios.get<{ serialsByPrestageId: Record<string, number> }>(apiUrl, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const assignments = response.data.serialsByPrestageId;
  const prestages = await getPrestages();
  const prestageId = assignments[serialNumber];
  if (prestageId) {
    const prestage = prestages.find(p => p.id === String(prestageId));
    if (prestage) {
      return { serialNumber, displayName: prestage.displayName };
    }
  }
  return { serialNumber, displayName: 'Unassigned' };
}

// Function to get computer inventory by ID
export async function wipeDevice(computerId: string): Promise<Response> {
  try {
    const token = await getJAMFToken();
    const response = await axios.post(`${JAMF_INSTANCE}/api/v1/computer-inventory/${computerId}/erase`,
      { pin: "123456" },
      { headers: { Authorization: `Bearer ${token}` } }
    );

    return new Response(JSON.stringify(response.data), { ...CORS_HEADERS, status: 200 });
  } catch (error: any) {
    const status = error?.response?.status;
    const message = error?.response?.data || 'Error wiping device';

    return new Response(JSON.stringify(message), { status: status });
  }
}