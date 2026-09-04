/// <reference lib="dom" />
import Alpine from 'alpinejs';
import AlpinePersist from "@alpinejs/persist";
import axios, { type AxiosResponse } from 'axios';
import AzureAuth, { authReady } from "./azure-auth.ts";



// Set up axios defaults
// SERVER_API_HOSTNAME/PORT let a reverse proxy (e.g. Caddy) put the client and API on the
// same public origin; unset, this falls back to the direct-to-container dev default.
const apiHost = process.env.SERVER_API_HOSTNAME || window.location.hostname;
const apiPort = process.env.SERVER_API_PORT || '8443';
const apiURL = `https://${apiHost}:${apiPort}/api`;
axios.defaults.baseURL = apiURL;

// Pass a dev placeholder for SKIP_ENTRA_AUTH mode; MSAL mode sets this after login via AzureAuth
if (process.env.SKIP_ENTRA_AUTH === 'true') {
  axios.defaults.headers.common['X-User-Name'] = 'dev-user';
}

type ComputerInfo = {
  assetTag: number,
  preloadId: number,
  computerId: number,
  name: string,
  room: string,
  email: string,
  building: string,
  username: string,
  macAddress: string,
  altMacAddress: string,
  serialNumber: string,
  currentPrestage: string,
  enrollmentMethod: string,
};

function createAlpineData() {
  return {
    theme: Alpine.$persist(process.env.THEME ?? 'dim'),
    searchData: '',
    searchType: Alpine.$persist('computers' as 'computers' | 'mobiledevices'),
    errorMessage: '',
    successMessage: '',
    dataList: [] as ComputerInfo[],
    dataListCopy: [] as ComputerInfo[],
    dataIndex: 0,
    totalPages: 0,
    currentPage: 0,
      updateToPrestage: '' as string,
    showPrestageDropdown: false,
    confirmModal: {
      title: '',
      lines: [] as string[],
      onConfirm: null as (() => Promise<void>) | null,
    },
    approvalModal: {
      open: false,
      action: '' as 'wipe' | 'retire' | '',
      device: null as ComputerInfo | null,
      justification: '',
      submitting: false,
      error: '',
    },
    approvalsPanel: {
      open: false,
      error: '',
    },
    pendingApprovals: [] as any[],
    pendingCount: 0,
    auditLog: [] as any[],
    auditLogOpen: false,
    adeAlerts: [] as any[],
    adeAlertCount: 0,
    _pollInterval: null as any,
      // SKIP_ENTRA_AUTH is inlined at build time by Bun (env: 'inline' in worker.ts)
      skipEntraAuth: process.env.SKIP_ENTRA_AUTH === 'true',

    get currentData() {
      return this.dataList[this.dataIndex] || {};
    },

    async init() {
      // Wait for a real session before polling an authenticated endpoint —
      // otherwise this fires immediately on page load, before sign-in completes.
      await authReady;
      await Promise.all([this.pollPending(), this.pollADEAlerts()]);
      this._pollInterval = setInterval(() => {
        this.pollPending();
        this.pollADEAlerts();
      }, 30000);
    },

    async pollPending() {
      try {
        const resp = await axios.get('/approvals/pending');
        this.pendingApprovals = resp.data.items ?? [];
        this.pendingCount = resp.data.count ?? 0;
      } catch { /* non-fatal */ }
    },

    async pollADEAlerts() {
      try {
        const resp = await axios.get('/ade-alerts?limit=100&unacknowledged=true');
        this.adeAlerts = resp.data.items ?? [];
        this.adeAlertCount = resp.data.count ?? 0;
      } catch { /* non-fatal */ }
    },

    // Clears the badge. Passing no serials acknowledges everything outstanding, which is
    // what the "Acknowledge all" button in the dialog does.
    async acknowledgeADEAlerts(serialNumbers: string[] = []) {
      try {
        await axios.post('/ade-alerts/acknowledge', { serialNumbers });
        await this.pollADEAlerts();
        if (this.adeAlertCount === 0) {
          (document.getElementById('adeAlertsDialog') as HTMLDialogElement).close();
        }
      } catch { /* non-fatal */ }
    },

    async loadAuditLog() {
      try {
        const resp = await axios.get('/audit-log?limit=100');
        this.auditLog = resp.data;
        this.auditLogOpen = true;
        (document.getElementById('auditLogDialog') as HTMLDialogElement).showModal();
      } catch { /* non-fatal */ }
    },

    async submitApproval() {
      const modal = this.approvalModal;
      if (!modal.device || !modal.justification.trim()) { modal.error = 'A justification is required.'; return; }
      modal.submitting = true;
      modal.error = '';
      try {
        const device = modal.device;
        await axios.post('/approvals', {
          action: modal.action,
          justification: modal.justification.trim(),
          deviceSerial: device.serialNumber,
          deviceId: String(device.computerId),
          deviceAssetTag: String(device.assetTag),
          payload: { computerId: String(device.computerId), serialNumber: device.serialNumber, macAddress: device.macAddress, altMacAddress: device.altMacAddress },
        });
        (document.getElementById('approvalRequestDialog') as HTMLDialogElement).close();
        this.successMessage = `${modal.action === 'wipe' ? 'Wipe' : 'Retire'} request submitted. Awaiting second admin approval.`;
        await this.pollPending();
      } catch (err: any) {
        modal.error = err.response?.data?.error ?? 'Failed to submit request.';
      } finally {
        modal.submitting = false;
      }
    },

    async approveRequest(id: number) {
      const panel = this.approvalsPanel;
      panel.error = '';
      try {
        await axios.post(`/approvals/${id}/approve`);
        await this.pollPending();
        this.successMessage = 'Action approved and executed.';
        if (this.pendingCount === 0) (document.getElementById('approvalsDialog') as HTMLDialogElement).close();
      } catch (err: any) {
        panel.error = err.response?.data?.error ?? 'Failed to approve.';
      }
    },

    async rejectRequest(id: number) {
      const panel = this.approvalsPanel;
      panel.error = '';
      try {
        await axios.post(`/approvals/${id}/reject`);
        await this.pollPending();
        this.successMessage = 'Request rejected.';
        if (this.pendingCount === 0) (document.getElementById('approvalsDialog') as HTMLDialogElement).close();
      } catch (err: any) {
        panel.error = err.response?.data?.error ?? 'Failed to reject.';
      }
    },

    prev() {
      this.dataIndex = (this.dataIndex - 1 + this.dataList.length) % this.dataList.length;
      this.updateToPrestage = '';
      this.showPrestageDropdown = false;
    },
    next() {
      this.dataIndex = (this.dataIndex + 1) % this.dataList.length;
      this.updateToPrestage = '';
      this.showPrestageDropdown = false;
    },

    async search() {
      try {
        if (!this.searchData) {
          return;
        }

        // Encode search term to avoid issues with special characters like '*'
        const encodedSearch = encodeURIComponent(this.searchData.trim());
        const response = await axios.get(`/${this.searchType}/${encodedSearch}`)
          .catch((error: any) => {
            console.error('Error fetching data:', error.response?.data || error.message);
            this.errorMessage = `An error occurred while searching for data. Error: ${error.response?.status ?? 'unknown'}`;
            throw error;
          });

        this.dataList = response.data;
        this.dataListCopy = JSON.parse(JSON.stringify(this.dataList));

        // Reset pagination and messages
        this.dataIndex = 0;
        this.errorMessage = '';
        this.successMessage = '';
        this.showPrestageDropdown = false;
        this.updateToPrestage = '';

        // Focus on the next non-disabled input element with the class 'datafield-input'
        Alpine.nextTick(() => {
          const nextInput = document.querySelector('.datafield-input:not(:disabled)');
          if (nextInput instanceof HTMLInputElement) {
            nextInput.focus();
          }
        });
      } catch (error: any) {
        if (error.response && error.response.status === 404) {
          const deviceType = String(this.searchType) === 'computers' ? 'computer' : 'mobile device';
          this.errorMessage = `No ${deviceType} found for: ${this.searchData}`;
        } else {
          this.errorMessage = `An error occurred while searching for data. Error: ${error.response?.status ?? 'unknown'}`;
        }
        this.dataList = [];
        this.dataListCopy = [];
        this.dataIndex = 0;
      }
    },

    async send() {
      const original = this.dataListCopy[this.dataIndex];
      const current = this.dataList[this.dataIndex];
      if (!current) { this.errorMessage = 'No data to update.'; this.successMessage = ''; return; }

      const EDITABLE = ['username', 'email', 'building', 'room', 'assetTag'] as const;
      const fieldLines: string[] = EDITABLE
        .filter(k => String((current as any)[k] ?? '') !== String((original as any)[k] ?? ''))
        .map(k => `${k}: "${(original as any)[k] ?? ''}" → "${(current as any)[k] ?? ''}"`);

      const hasPrestageUpdate = this.updateToPrestage !== ''
        && String(current.currentPrestage ?? '') !== String(original.currentPrestage ?? '');
      const prestageLines: string[] = hasPrestageUpdate
        ? [`Prestage: "${original.currentPrestage}" → "${current.currentPrestage}"`]
        : [];

      const lines = [...fieldLines, ...prestageLines];
      if (lines.length === 0) { this.errorMessage = 'No changes to update.'; this.successMessage = ''; return; }

      this.showConfirm('Confirm Changes', lines, async () => {
        try {
          if (hasPrestageUpdate) {
            await axios.post(`/change-prestage/${this.searchType}/${this.updateToPrestage}/${current.serialNumber}`);
          }
          if (fieldLines.length > 0) {
            Object.keys(current).forEach(key => {
              if ((current as any)[key] === null) (current as any)[key] = '';
            });
            let buildingId: number | undefined;
            if (current.building && current.building !== 'N/A' && current.building !== '') {
              try {
                const buildingsResponse = await axios.get('/buildings');
                const buildings = buildingsResponse.data as Array<{ name: string; id: string; }>;
                const match = buildings.find(b => b.name === current.building);
                if (match) buildingId = parseInt(match.id, 10);
              } catch { /* non-fatal */ }
            }
            await axios.put(`/update-info/${this.searchType}/${encodeURIComponent(current.preloadId)}/${encodeURIComponent(current.computerId)}`, { ...current, buildingId });
          }
          this.dataList[this.dataIndex] = { ...current };
          this.dataListCopy[this.dataIndex] = { ...current };
          this.updateToPrestage = '';
          this.errorMessage = '';
          this.successMessage = 'Data updated successfully.';
        } catch (error: any) {
          this.errorMessage = `An error occurred while sending data. Error: ${error.response?.status ?? 'unknown'}`;
        }
      });
    },

    async erase() {
      const current = this.dataList[this.dataIndex];
      if (!current) { this.errorMessage = 'No data to erase.'; this.successMessage = ''; return; }
      this.approvalModal.action = 'wipe';
      this.approvalModal.device = current;
      this.approvalModal.justification = '';
      this.approvalModal.error = '';
      (document.getElementById('approvalRequestDialog') as HTMLDialogElement).showModal();
    },

    async retire() {
      const current = this.dataList[this.dataIndex];
      if (!current) { this.errorMessage = 'No data to retire.'; this.successMessage = ''; return; }
      this.approvalModal.action = 'retire';
      this.approvalModal.device = current;
      this.approvalModal.justification = '';
      this.approvalModal.error = '';
      (document.getElementById('approvalRequestDialog') as HTMLDialogElement).showModal();
    },

    showConfirm(title: string, lines: string[], callback: () => Promise<void>) {
      this.confirmModal.title = title;
      this.confirmModal.lines = lines;
      this.confirmModal.onConfirm = callback;
      (document.getElementById('confirmDialog') as HTMLDialogElement).showModal();
    },
  }
}

function fetchPrestages(params?: { getSearchType: () => 'computers' | 'mobiledevices'; getDataList: () => any[] }) {
  return {
    prestages: [],
    currentSearchType: '',

    async init(this: any) {
      // If parent accessors are provided, watch those instead of relying on $root
      if (params && typeof params.getDataList === 'function' && typeof params.getSearchType === 'function') {
        this.$watch(() => params.getDataList(), async (dataList: any[]) => {
          if (Array.isArray(dataList) && dataList.length > 0) {
            const searchType = params.getSearchType() || 'computers';
            if (searchType !== this.currentSearchType || this.prestages.length === 0) {
              this.currentSearchType = searchType;
              await this.loadPrestages(searchType);
            }
          }
        });
      }
    },

    async loadPrestages(searchType: string) {
      const endpoint = searchType === 'mobiledevices' ? '/mobile-prestages' : '/prestages';
      try {
        const response: AxiosResponse = await axios.get(endpoint);
        response.data.sort((a: { displayName: string; }, b: { displayName: string; }) => a.displayName.localeCompare(b.displayName));
        this.prestages = response.data;
        console.log(`Loaded ${this.prestages.length} ${searchType === 'mobiledevices' ? 'mobile device' : 'computer'} prestages`);
      } catch (error: any) {
        console.error('Error fetching prestages:', error.response?.data || error.message);
        this.prestages = [];
      }
    }
  }
}

function fetchBuildings() {
  return {
    buildings: [] as Array<{ name: string; id: string; }>,

    async init() {
      // Same reasoning as AlpineData.init(): this fires on mount, not on user
      // interaction, so it must wait for a real session or it 401s and — since
      // there's no retry — leaves the buildings dropdown empty even after sign-in.
      await authReady;
      const response: AxiosResponse = await axios.get(`/buildings`)
        .catch((error: any) => {
          console.error('Error fetching buildings:', error.response?.data || error.message);
          throw error;
        });
      response.data.sort((a: { name: string; }, b: { name: string; }) => a.name.localeCompare(b.name));
      this.buildings = response.data;
    }
  }
}

// @ts-ignore
window.Alpine = Alpine;
Alpine.store('skipEntraAuth', process.env.SKIP_ENTRA_AUTH === 'true');

// Register Alpine components
Alpine.data('AzureAuth', AzureAuth);
Alpine.data('FetchBuildings', fetchBuildings);
Alpine.data('FetchPrestages', fetchPrestages);
Alpine.data('AlpineData', createAlpineData);

// Import Alpine plugins
Alpine.plugin(AlpinePersist);

// Start Alpine.js
Alpine.start();
