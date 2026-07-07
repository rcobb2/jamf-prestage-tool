import axios from 'axios';
import logger from './logger.ts';
import axiosRetry from 'axios-retry';

// Configure global retry for all axios requests (3 retries, exponential backoff).
// Only retry safe/idempotent methods on 5xx — never retry POST/DELETE (wipe, erase, scope-delete).
axiosRetry(axios, {
  retries: 3,
  retryDelay: axiosRetry.exponentialDelay,
  retryCondition: (error) => {
    const method = (error.config?.method ?? '').toUpperCase();
    const safeMethods = ['GET', 'HEAD', 'OPTIONS', 'PUT'];
    const isSafe = safeMethods.includes(method);
    return axiosRetry.isNetworkOrIdempotentRequestError(error) ||
      (isSafe && !!error.response && error.response.status >= 500);
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
  const normalized = search.toUpperCase();
  const wildcard = normalized.includes('*') ? normalized : `*${normalized}*`;
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

// Function to fetch all ADE-assigned devices for a device enrollment instance
// (paginates until all records are fetched — the endpoint defaults to ~100/page)
export async function getADEEnrolledDevices(instanceId: string): Promise<any[]> {
  const token = await getJAMFToken();
  const pageSize = 100;
  let page = 0;
  const all: any[] = [];

  while (true) {
    const apiUrl = `${JAMF_INSTANCE}/api/v1/device-enrollments/${instanceId}/devices?page=${page}&page-size=${pageSize}`;
    const response = await axios.get<{ totalCount: number; results: any[] }>(apiUrl, {
      headers: { Authorization: `Bearer ${token}` }
    });
    all.push(...response.data.results);
    if (all.length >= response.data.totalCount || response.data.results.length < pageSize) break;
    page++;
  }

  return all;
}

// Function to get all prestages & their IDs (paginates until all records are fetched)
export async function getPrestages(): Promise<{ id: string; displayName: string; versionLock: string }[]> {
  const token = await getJAMFToken();
  const pageSize = 100;
  let page = 0;
  const all: { id: string; displayName: string; versionLock?: string }[] = [];

  while (true) {
    const apiUrl = `${JAMF_INSTANCE}/api/v3/computer-prestages?page=${page}&page-size=${pageSize}&sort=id%3Adesc`;
    const response = await axios.get<{ totalCount: number; results: { id: string; displayName: string; versionLock?: string }[] }>(apiUrl, {
      headers: { Authorization: `Bearer ${token}` }
    });
    all.push(...response.data.results);
    if (all.length >= response.data.totalCount || response.data.results.length < pageSize) break;
    page++;
  }

  return all.map((prestage) => ({
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
  const pin = process.env.DEVICE_ERASE_PIN;
  if (!pin) {
    return new Response(JSON.stringify('DEVICE_ERASE_PIN env var is not set'), { ...CORS_HEADERS, status: 500 });
  }
  try {
    const token = await getJAMFToken();
    const response = await axios.post(
      `${JAMF_INSTANCE}/api/v1/computers-inventory/${computerId}/erase`,
      { pin },
      { headers: { Authorization: `Bearer ${token}` } }
    );
    return new Response(JSON.stringify(response.data), { ...CORS_HEADERS, status: 200 });
  } catch (error: any) {
    const status = error?.response?.status ?? 500;
    const message = error?.response?.data || 'Error wiping device';
    return new Response(JSON.stringify(message), { ...CORS_HEADERS, status });
  }
}

// ============================================================================
// Mobile Device Functions
// ============================================================================

export type MobileDeviceMatch = { id: number; serial_number: string; };

// Function to match mobile devices based on search query
export async function matchMobileDevice(search: string): Promise<MobileDeviceMatch[]> {
  const token = await getJAMFToken();
  const normalized = search.toUpperCase();
  const wildcard = normalized.includes('*') ? normalized : `*${normalized}*`;
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

// Function to get mobile device prestages (paginates until all records are fetched)
export async function getMobilePrestages(): Promise<{ id: string; displayName: string; versionLock: string }[]> {
  const token = await getJAMFToken();
  const pageSize = 100;
  let page = 0;
  const all: { id: string; displayName: string; versionLock?: string }[] = [];

  while (true) {
    const apiUrl = `${JAMF_INSTANCE}/api/v3/mobile-device-prestages?page=${page}&page-size=${pageSize}&sort=id%3Adesc`;
    const response = await axios.get<{ totalCount: number; results: { id: string; displayName: string; versionLock?: string }[] }>(apiUrl, {
      headers: { Authorization: `Bearer ${token}` }
    });
    all.push(...response.data.results);
    if (all.length >= response.data.totalCount || response.data.results.length < pageSize) break;
    page++;
  }

  return all.map((prestage) => ({
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

// Fetches all mobile prestage scopes in parallel and returns a serial→prestageName map.
// Use this once per search request instead of calling getMobilePrestageAssignments per device.
export async function buildMobilePrestageScopeMap(): Promise<Map<string, string>> {
  const token = await getJAMFToken();
  const prestages = await getMobilePrestages();

  const scopeResults = await Promise.all(
    prestages.map(async (prestage) => {
      const scopeUrl = `${JAMF_INSTANCE}/api/v2/mobile-device-prestages/${prestage.id}/scope`;
      try {
        const res = await axios.get<{ assignments: { serialNumber: string }[] }>(scopeUrl, {
          headers: { Authorization: `Bearer ${token}` }
        });
        return { name: prestage.displayName, assignments: res.data.assignments ?? [] };
      } catch {
        return { name: prestage.displayName, assignments: [] };
      }
    })
  );

  const map = new Map<string, string>();
  for (const { name, assignments } of scopeResults) {
    for (const a of assignments) {
      map.set(a.serialNumber, name);
    }
  }
  return map;
}

// Performs the full device retirement sequence: wipe → Jamf delete → GLPI update → Clearpass MAC removal.
// GLPI and Clearpass steps are non-fatal: failures are logged as warnings so that an already-committed
// Jamf deletion never surfaces as an error to the caller.
export async function retireDevice(
  computerId: string,
  serialNumber: string,
  macAddress?: string,
  altMacAddress?: string,
): Promise<{ ok: boolean; wipeStatus: number; message?: string }> {
  // 1. Wipe
  const wipeResult = await wipeDevice(computerId);
  if (wipeResult.status !== 200) {
    const text = await wipeResult.text();
    return { ok: false, wipeStatus: wipeResult.status, message: `Wipe failed: ${text}` };
  }

  // 2. Delete from Jamf inventory
  const token = await getJAMFToken();
  const jamfDeleteResp = await axios.delete(`${JAMF_INSTANCE}/api/v1/computers-inventory/${computerId}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (jamfDeleteResp.status !== 204) {
    return { ok: false, wipeStatus: wipeResult.status, message: `Jamf delete returned ${jamfDeleteResp.status}` };
  }

  // 3. GLPI state update (non-fatal after Jamf has already committed)
  if (GLPI_INSTANCE && GLPI_APP_TOKEN) {
    try {
      const glpiTokenResp = await getGLPIToken();
      const sessionToken = glpiTokenResp.data.session_token;
      if (sessionToken) {
        const params = new URLSearchParams({
          'criteria[0][field]': '5',
          'criteria[0][searchtype]': 'contains',
          'criteria[0][value]': `^${serialNumber}$`,
        });
        const searchResp = await axios.get(`${GLPI_INSTANCE}/search/Computer`, {
          headers: { 'Content-Type': 'application/json', 'App-Token': GLPI_APP_TOKEN, 'Session-Token': sessionToken },
          params,
        });
        if (searchResp.data.totalcount === 1) {
          const computerIdGLPI = searchResp.data.data[0][2];
          await axios.put(`${GLPI_INSTANCE}/Computer/${computerIdGLPI}`, { input: { states_id: 18 } }, {
            headers: { 'Content-Type': 'application/json', 'App-Token': GLPI_APP_TOKEN, 'Session-Token': sessionToken },
          });
        } else {
          logger.warn({ serialNumber }, 'GLPI: device not found or multiple matches — skipping state update');
        }
        await cleanupGLPI(sessionToken).catch((err: any) => logger.warn({ err: err.message }, 'GLPI session cleanup failed'));
      }
    } catch (err: any) {
      logger.warn({ err: err.message }, 'GLPI retirement step failed — continuing');
    }
  }

  // 4. Clearpass MAC removal (non-fatal)
  const removeMac = async (mac: string) => {
    try { await deleteClearpassMAC(mac); }
    catch (err: any) { logger.warn({ mac, err: err.message }, 'Clearpass MAC deletion failed'); }
  };
  if (macAddress) await removeMac(macAddress);
  if (altMacAddress) await removeMac(altMacAddress);

  return { ok: true, wipeStatus: 200 };
}

// Add a device to a prestage scope without disturbing existing assignments.
// Jamf's scope endpoint replaces the entire scope on write, so we must GET
// the current scope first, merge in the new serial, then PUT the full list.
export async function addDeviceToPrestage(prestageId: string, serialNumber: string, isMobile: boolean, token: string, _versionLock?: string, dryRun?: boolean) {
  const endpoint = isMobile
    ? `${JAMF_INSTANCE}/api/v2/mobile-device-prestages/${prestageId}/scope`
    : `${JAMF_INSTANCE}/api/v2/computer-prestages/${prestageId}/scope`;

  const headers = { Authorization: `Bearer ${token}` };

  const scopeResponse = await axios.get<{ assignments: { serialNumber: string }[]; versionLock: number }>(endpoint, { headers });
  const existing = scopeResponse.data.assignments?.map((a) => a.serialNumber) ?? [];
  const scopeVersionLock = scopeResponse.data.versionLock;

  const serialNumbers = existing.includes(serialNumber) ? existing : [...existing, serialNumber];
  const body = { serialNumbers, versionLock: scopeVersionLock };

  if (dryRun) {
    return { dryRun: true, endpoint, method: 'PUT', body };
  }

  const response = await axios.put(endpoint, body, { headers });
  return response.data;
}
