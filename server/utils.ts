import axios from 'axios';
import logger from './logger.ts';
import axiosRetry from 'axios-retry';

// Configure global retry for all axios requests (3 retries, exponential backoff)
axiosRetry(axios, {
  retries: 3,
  retryDelay: axiosRetry.exponentialDelay,
  // Retry on network errors or 5xx responses
  retryCondition: (error) => {
    return axiosRetry.isNetworkOrIdempotentRequestError(error) || (error.response && error.response.status >= 500);
  },
});

// Trace every outbound API call with method, URL, status, and duration
axios.interceptors.request.use((config) => {
  (config as any)._startTime = Date.now();
  logger.debug({ method: config.method?.toUpperCase(), url: config.url }, 'Outbound API request');
  return config;
});
axios.interceptors.response.use(
  (response) => {
    const ms = Date.now() - ((response.config as any)._startTime ?? 0);
    logger.info({ method: response.config.method?.toUpperCase(), url: response.config.url, status: response.status, ms }, 'API response');
    return response;
  },
  (error) => {
    const ms = Date.now() - ((error.config as any)?._startTime ?? 0);
    logger.error({ method: error.config?.method?.toUpperCase(), url: error.config?.url, status: error.response?.status, ms }, 'API error');
    return Promise.reject(error);
  }
);

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
    "Access-Control-Allow-Headers": "Content-Type, Accept, Authorization, X-User-Name",
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

// Token cache — reuse the token until 60 seconds before it expires
let _cachedToken: string | null = null;
let _tokenExpiresAt = 0;

export async function getJAMFToken(): Promise<string> {
  const now = Date.now();
  if (_cachedToken && now < _tokenExpiresAt) {
    return _cachedToken;
  }

  const response = await axios.post(tokenUrl, {
    grant_type: "client_credentials",
    client_id: JAMF_CLIENT_ID,
    client_secret: JAMF_CLIENT_SECRET,
  }, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
  });

  _cachedToken = response.data.access_token;
  // expires_in is in seconds; refresh 60s before actual expiry
  const expiresIn: number = response.data.expires_in ?? 7200;
  _tokenExpiresAt = now + (expiresIn - 60) * 1000;
  logger.info({ expiresIn, refreshAt: new Date(_tokenExpiresAt).toISOString() }, 'JAMF token refreshed');
  return _cachedToken!;
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

  logger.info('Successfully retrieved Clearpass access token');
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


  logger.info({ macAddress }, 'Successfully deleted MAC address from Clearpass');
  return response.data;
}

// Function to match computers by serial number or name or id, etc.
export async function matchComputer(search: string): Promise<ComputerMatch[]> {
  const token = await getJAMFToken();
  const wildcard = search.includes('*') ? search : `${search}*`;
  const apiUrl = `${JAMF_INSTANCE}/JSSResource/computers/match/${wildcard}`;
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

// Function to wipe a device via Jamf MDM command
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
    return new Response(JSON.stringify(message), { ...CORS_HEADERS, status: status });
  }
}

// ============================================================================
// Mobile Device Functions
// ============================================================================

export type MobileDeviceMatch = { id: number; serial_number: string; };

// Function to match mobile devices based on search query
export async function matchMobileDevice(search: string): Promise<MobileDeviceMatch[]> {
  const token = await getJAMFToken();
  const wildcard = search.includes('*') ? search : `${search}*`;
  const apiUrl = `${JAMF_INSTANCE}/JSSResource/mobiledevices/match/${wildcard}`;
  const response = await axios.get(apiUrl, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (response.data && response.data.mobile_devices && Array.isArray(response.data.mobile_devices)) {
    return response.data.mobile_devices.map((item: any) => ({
      id: item.id,
      serial_number: item.serial_number
    })) as MobileDeviceMatch[];
  }
  throw new Error('Unexpected response format');
}

// Function to get mobile device prestages
export async function getMobilePrestages(): Promise<{ id: string; displayName: string; versionLock: string }[]> {
  const token = await getJAMFToken();
  const apiUrl = `${JAMF_INSTANCE}/api/v3/mobile-device-prestages?page=0&page-size=100&sort=id%3Adesc`;
  const response = await axios.get<{ results: { id: string; displayName: string; versionLock?: string }[] }>(apiUrl, {
    headers: { Authorization: `Bearer ${token}` }
  });
  return response.data.results.map((prestage) => ({
    id: prestage.id,
    displayName: prestage.displayName,
    versionLock: prestage.versionLock || 'N/A'
  }));
}

// Function to get mobile device prestage assignments for a given serial number
export async function getMobilePrestageAssignments(serialNumber: string): Promise<{ serialNumber: string; displayName: string }> {
  const token = await getJAMFToken();
  
  try {
    // Get all mobile device prestages
    const prestages = await getMobilePrestages();
    
    // Check each prestage's scope for this serial number
    for (const prestage of prestages) {
      const scopeUrl = `${JAMF_INSTANCE}/api/v2/mobile-device-prestages/${prestage.id}/scope`;
      const scopeResponse = await axios.get<{ assignments: any[] }>(scopeUrl, {
        headers: { Authorization: `Bearer ${token}` }
      });
      
      const assignment = scopeResponse.data.assignments?.find((a: any) => a.serialNumber === serialNumber);
      if (assignment) {
        return {
          serialNumber: assignment.serialNumber,
          displayName: prestage.displayName
        };
      }
    }
  } catch (error) {
    console.error('Error getting mobile prestage assignments:', error);
  }
  
  return { serialNumber, displayName: 'N/A' };
}

// New helper: add a device to a prestage (POST) with optional dry‑run
export async function addDeviceToPrestage(prestageId: string, serialNumber: string, isMobile: boolean, token: string, versionLock?: string, dryRun?: boolean) {
  const endpoint = isMobile
    ? `${JAMF_INSTANCE}/api/v2/mobile-device-prestages/${prestageId}/scope`
    : `${JAMF_INSTANCE}/api/v2/computer-prestages/${prestageId}/scope`;

  const body: any = { serialNumbers: [serialNumber] };
  if (versionLock && versionLock !== 'N/A') {
    body.versionLock = versionLock;
  }

  if (dryRun) {
    return { dryRun: true, endpoint, method: 'POST', body };
  }

  const response = await axios.post(endpoint, body, { headers: { Authorization: `Bearer ${token}` } });
  return response.data;
}
