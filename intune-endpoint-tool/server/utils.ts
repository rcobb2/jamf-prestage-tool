import axios from 'axios';
import logger from './logger.ts';
import axiosRetry from 'axios-retry';

// Configure global retry for all axios requests (3 retries, exponential backoff).
// Only retry safe/idempotent methods on 5xx — never retry POST/DELETE (wipe, retire, delete).
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

  GRAPH_TENANT_ID,
  GRAPH_CLIENT_ID,
  GRAPH_CLIENT_SECRET,

  CLIENT_HOSTNAME,
} = process.env;

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';
// Autopilot deployment profile assignment/read operations are still beta-only in Graph.
const GRAPH_BETA = 'https://graph.microsoft.com/beta';

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

export type Platform = 'windows' | 'apple';

// The closest Graph/Intune analog to a Jamf PrestageEnrollment: a Windows Autopilot
// deployment profile, or an Apple Automated Device Enrollment (ADE) profile. Both are
// applied to a device before/at Setup Assistant/OOBE time, same as a Jamf prestage.
export type EnrollmentProfile = {
  id: string;
  displayName: string;
  platform: Platform;
};

// Vendor-neutral device record returned to the client — the Graph/Intune equivalent of
// the Jamf tool's JAMFResponse type. `building`/`room`/`username`/`email`/`assetTag` come
// from the local device_metadata table (see db.ts) since Graph has no native equivalent
// of Jamf's Inventory Preload; everything else comes live from Graph.
export type DeviceRecord = {
  serialNumber: string;
  intuneDeviceId: string | null;
  azureAdDeviceId: string | null;
  autopilotId: string | null;
  name: string | null;
  model: string | null;
  platform: Platform | 'unknown';
  currentEnrollmentProfile: string;
  groupTag: string | null;
  assignedUserPrincipalName: string | null;
  macAddress: string | null;
  altMacAddress: string | null;
  username: string | null;
  email: string | null;
  building: string | null;
  room: string | null;
  assetTag: string | null;
};

// ============================================================================
// Microsoft Graph auth (server-to-Graph client credentials — separate app
// registration/permissions from the user-facing MSAL login in auth.ts/azure-auth.ts)
// ============================================================================

let _cachedToken: string | null = null;
let _tokenExpiresAt = 0;

export async function getGraphToken(): Promise<string> {
  const now = Date.now();
  if (_cachedToken && now < _tokenExpiresAt) {
    return _cachedToken;
  }

  const tokenUrl = `https://login.microsoftonline.com/${GRAPH_TENANT_ID}/oauth2/v2.0/token`;
  const response = await axios.post(tokenUrl, new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: GRAPH_CLIENT_ID ?? '',
    client_secret: GRAPH_CLIENT_SECRET ?? '',
    scope: 'https://graph.microsoft.com/.default',
  }), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
  });

  _cachedToken = response.data.access_token;
  const expiresIn: number = response.data.expires_in ?? 3600;
  _tokenExpiresAt = now + (expiresIn - 60) * 1000;
  logger.info({ expiresIn, refreshAt: new Date(_tokenExpiresAt).toISOString() }, 'Graph token refreshed');
  return _cachedToken!;
}

// ============================================================================
// GLPI / Clearpass — vendor-agnostic, reused as-is from the Jamf tool.
// ============================================================================

export async function getGLPIToken() {
  return await axios.get(`${GLPI_INSTANCE}/initSession/`, {
    headers: {
      'Content-Type': 'application/json',
      'App-Token': GLPI_APP_TOKEN,
      'Authorization': `user_token ${GLPI_USER_TOKEN}`,
    },
  });
}

export async function cleanupGLPI(session_token: string) {
  return await axios.get(`${GLPI_INSTANCE}/killSession/`, {
    headers: {
      'Content-Type': 'application/json',
      'App-Token': GLPI_APP_TOKEN,
      'Session-Token': session_token,
    },
  });
}

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

export async function deleteClearpassMAC(macAddress: string): Promise<any> {
  const token = await getClearpassToken();

  const response = await axios.delete(`${CLEARPASS_INSTANCE}/endpoint/mac-address/${macAddress}`, {
    headers: { Authorization: `Bearer ${token}` }
  });

  logger.info({ macAddress }, 'Successfully deleted MAC address from Clearpass');
  return response.data;
}

// ============================================================================
// Device search
//
// TODO: implement. Graph has no single "search by anything" endpoint like Jamf's
// Classic API wildcard match — this needs to fan out and merge:
//
//   1. Enrolled devices:
//      GET {GRAPH_BASE}/deviceManagement/managedDevices
//        ?$filter=deviceName eq '{q}' or serialNumber eq '{q}'
//      For substring/contains search (closest to Jamf's `*term*`), use the
//      advanced query form instead, which requires the ConsistencyLevel header:
//        GET {GRAPH_BASE}/deviceManagement/managedDevices?$search="serialNumber:{q}"
//        Headers: { ConsistencyLevel: 'eventual' }
//      Search by user: GET {GRAPH_BASE}/users/{upn}/managedDevices
//
//   2. Pre-enrollment (Windows Autopilot) — analog of Jamf's ADE device-enrollments
//      fallback:
//      GET {GRAPH_BETA}/deviceManagement/windowsAutopilotDeviceIdentities
//        ?$filter=contains(serialNumber,'{q}')
//
//   3. Pre-enrollment (Apple ADE via Intune) — devices imported through an Apple
//      Business/School Manager token but not yet enrolled:
//      GET {GRAPH_BETA}/deviceManagement/importedAppleDeviceIdentities
//        ?$filter=contains(serialNumber,'{q}')
//
// Merge all three, dedupe by serial number, then join each result with local
// device_metadata (db.ts: getDeviceMetadata) and the device's current enrollment
// profile assignment (see getEnrollmentProfileAssignment below) to build DeviceRecord[].
// ============================================================================
export async function searchDevices(_query: string): Promise<DeviceRecord[]> {
  throw new Error('searchDevices is not implemented — see TODO comment above for the Graph calls to fan out and merge.');
}

// ============================================================================
// Enrollment profiles (Jamf prestage list equivalent)
//
// TODO: implement, branching on platform:
//   windows: GET {GRAPH_BETA}/deviceManagement/windowsAutopilotDeploymentProfiles
//   apple:   GET {GRAPH_BETA}/deviceManagement/depOnboardingSettings/{tokenId}/enrollmentProfiles
//            (Apple ADE profiles are scoped per Apple Business/School Manager token,
//            so this likely needs to paginate depOnboardingSettings first, then each
//            token's enrollmentProfiles — unlike Jamf, which has one flat prestage list.)
// Paginate via @odata.nextLink the same way the Jamf tool paginates page/page-size.
// ============================================================================
export async function getEnrollmentProfiles(_platform: Platform): Promise<EnrollmentProfile[]> {
  throw new Error('getEnrollmentProfiles is not implemented — see TODO comment above.');
}

// ============================================================================
// Current profile assignment for a device (Jamf getPrestageAssignments equivalent)
//
// TODO: implement.
//   windows: GET the device's windowsAutopilotDeviceIdentity (by serial), read its
//     `deploymentProfileAssignmentStatus` and `deploymentProfileAssignmentDetailedStatus`
//     fields, and resolve the assigned profile's displayName via its `deploymentProfile`
//     navigation property (may need $expand=deploymentProfile or a follow-up GET).
//   apple: read the device's enrollment profile assignment off the matching
//     importedAppleDeviceIdentity / the Apple enrollment profile's assignedDevices.
// Return { serialNumber, displayName: 'Unassigned' } if nothing is assigned, mirroring
// the Jamf tool's sentinel value.
// ============================================================================
export async function getEnrollmentProfileAssignment(serialNumber: string, _platform: Platform): Promise<{ serialNumber: string; displayName: string }> {
  return { serialNumber, displayName: 'Unassigned' };
}

// ============================================================================
// Assign / reassign a device to an enrollment profile (Jamf addDeviceToPrestage
// equivalent — but the assignment MODEL is fundamentally different from Jamf's flat
// serial-number scope list, so this is not a drop-in port):
//
//   Windows Autopilot profile assignment is group-membership-driven, not a per-device
//   scope list. Two supported strategies — pick the one matching your tenant's setup:
//
//     (a) Group Tag strategy (closest to Jamf's "one serial -> one purpose" model):
//         POST {GRAPH_BETA}/deviceManagement/windowsAutopilotDeviceIdentities/{id}/updateDeviceProperties
//         Body: { groupTag: '<tag matching a dynamic group targeted by the profile>' }
//         Requires a pre-existing dynamic Entra ID group per profile/purpose whose
//         membership rule matches on autopilot group tag, and the profile already
//         assigned to that group.
//
//     (b) Static group membership strategy:
//         POST {GRAPH_BASE}/groups/{groupId}/members/$ref  Body: { "@odata.id": ".../devices/{azureAdDeviceId}" }
//         (and a corresponding DELETE .../members/{azureAdDeviceId}/$ref to remove from
//         the previous group) — requires resolving the device's Azure AD device object
//         id, not just its Autopilot identity id.
//
//   Apple ADE profile assignment: Graph does not expose a per-device "assign" call the
//   way Jamf's PUT scope endpoint does; profile-to-device assignment for Apple ADE is
//   configured through the depOnboardingSettings profile's `assignedDevices` or by the
//   device's default profile flag (`isDefault`) — consult current Graph beta docs for
//   your tenant's Apple ADE enrollment type before implementing.
//
// The server.ts route handler orchestrates "remove from current, then add to target" —
// same shape as the Jamf tool's /api/change-prestage route — call this only after
// removeDeviceFromProfile has been called for the device's current profile (if any).
// ============================================================================
export async function assignDeviceToProfile(_profileId: string, _serialNumber: string, _platform: Platform, _dryRun?: boolean): Promise<any> {
  throw new Error('assignDeviceToProfile is not implemented — see TODO comment above; the assignment model depends on your tenant\'s group-tag vs. static-group setup.');
}

export async function removeDeviceFromProfile(_profileId: string, _serialNumber: string, _platform: Platform): Promise<any> {
  throw new Error('removeDeviceFromProfile is not implemented — see assignDeviceToProfile TODO comment above.');
}

// ============================================================================
// Wipe a device via Intune MDM command.
//
// TODO: implement.
//   POST {GRAPH_BASE}/deviceManagement/managedDevices/{intuneDeviceId}/wipe
//   Body: { keepEnrollmentData: boolean, keepUserData: boolean }
//     - For Windows Autopilot devices, keepEnrollmentData: true lets the device
//       re-provision itself automatically on next boot (Autopilot Reset) instead of
//       dropping out of management — the closest Intune analog to how the Jamf tool
//       always re-applies a prestage after erase.
//   macOS Activation Lock bypass (Jamf's DEVICE_ERASE_PIN equivalent): fetch the code
//   via GET {GRAPH_BASE}/deviceManagement/managedDevices/{id}?$select=activationLockBypassCode
//   and surface it to the tech BEFORE wiping — Graph does not accept a caller-supplied
//   PIN the way Jamf's erase endpoint does.
// ============================================================================
export async function wipeDevice(_intuneDeviceId: string, _options?: { keepEnrollmentData?: boolean; keepUserData?: boolean }): Promise<Response> {
  return new Response(JSON.stringify('wipeDevice is not implemented — see TODO comment in utils.ts'), { ...CORS_HEADERS, status: 501 });
}

// ============================================================================
// Full device retirement sequence: retire from Intune management → remove Autopilot/
// Entra ID device records → GLPI update → Clearpass MAC removal.
//
// TODO: implement the Graph-specific steps:
//   1. POST {GRAPH_BASE}/deviceManagement/managedDevices/{intuneDeviceId}/retire
//      (unlike wipe, retire always removes MDM management; there is no reprovision option)
//   2. If Windows Autopilot: DELETE {GRAPH_BETA}/deviceManagement/windowsAutopilotDeviceIdentities/{autopilotId}
//      to fully deregister from zero-touch (only if the device is being decommissioned,
//      not repurposed — deleting this means it will need manual OOBE next time).
//   3. DELETE {GRAPH_BASE}/devices/{azureAdDeviceId}  (Entra ID device object)
//
// GLPI and Clearpass steps below are reused as-is from the Jamf tool — vendor-agnostic,
// non-fatal (a failure here must never surface as an error once Intune retire has
// already committed).
// ============================================================================
export async function retireDevice(
  intuneDeviceId: string,
  serialNumber: string,
  macAddress?: string,
  altMacAddress?: string,
): Promise<{ ok: boolean; message?: string }> {
  // TODO: replace with real Graph calls — see comment block above.
  void intuneDeviceId;

  // GLPI state update (non-fatal after Intune retire has already committed)
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

  // Clearpass MAC removal (non-fatal)
  const removeMac = async (mac: string) => {
    try { await deleteClearpassMAC(mac); }
    catch (err: any) { logger.warn({ mac, err: err.message }, 'Clearpass MAC deletion failed'); }
  };
  if (macAddress) await removeMac(macAddress);
  if (altMacAddress) await removeMac(altMacAddress);

  return { ok: false, message: 'retireDevice: Graph retire/delete steps are not implemented — see TODO comment in utils.ts' };
}
