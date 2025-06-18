/// <reference lib="dom" />
import Alpine from 'alpinejs';
import axios, { type AxiosResponse } from 'axios';
import AzureAuth from "./azure-auth.ts";

const apiURL = `https://${process.env.SERVER_API_HOSTNAME}:${process.env.SERVER_API_PORT}/api`;
axios.defaults.baseURL = apiURL;

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
    theme: process.env.THEME ?? 'dim',
    searchData: '',
    errorMessage: '',
    successMessage: '',
    updateToBuilding: '',
    dataList: [] as ComputerInfo[],
    dataListCopy: [] as ComputerInfo[],
    dataIndex: 0,
    totalPages: 0,
    currentPage: 0,
    updateToPrestage: 0,

    get currentData() {
      return this.dataList[this.dataIndex] || {};
    },
    prev() {
      this.dataIndex = (this.dataIndex - 1 + this.dataList.length) % this.dataList.length;
    },
    next() {
      this.dataIndex = (this.dataIndex + 1) % this.dataList.length;
    },

    async search() {
      try {
        if (!this.searchData) {
          return;
        }

        const response = await axios.get(`/data/${this.searchData}`)
          .catch((error: any) => {
            console.error('Error fetching data:', error.response?.data || error.message);
            throw error;
          });

        this.dataList = response.data;
        this.dataListCopy = JSON.parse(JSON.stringify(this.dataList));
        this.dataIndex = 0;
        this.errorMessage = '';
      } catch (error: any) {
        if (error.response && error.response.status === 404) {
          this.errorMessage = `No computer found for: ${this.searchData}`;
        } else {
          this.errorMessage = `An error occurred while searching for data. Error: ${error.response?.status ?? 'unknown'}`;
        }
        this.dataList = [];
        this.dataListCopy = [];
        this.dataIndex = 0;
      }
    },

    async send() {
      try {
        const original = this.dataListCopy[this.dataIndex];
        const current = this.dataList[this.dataIndex];

        if (!current) {
          this.errorMessage = 'No data to update.';
          this.successMessage = '';
          return;
        }

        // If no changes and no prestage/building update, do nothing
        if (JSON.stringify(current) === JSON.stringify(original) && this.updateToPrestage === 0 && this.updateToBuilding === '') {
          this.errorMessage = 'No changes to update.';
          this.successMessage = '';
          return;
        }

        // Update building if needed
        if (this.updateToBuilding !== '') {
          current.building = this.updateToBuilding;
        }

        // Update prestage if needed
        if (this.updateToPrestage !== 0) {
          await axios.post(`/change-prestage/${this.updateToPrestage}/${current.serialNumber}`);
        }

        // Update preload if changed
        if (JSON.stringify(current) !== JSON.stringify(original)) {
          // Ensure all null values are set to empty strings before sending
          for (const key in current) {
            if (current[key as keyof ComputerInfo] === null) {
              (current as any)[key] = '';
            }
          }
          await axios.put(`/update-preload/${current.preloadId}/${current.computerId}`, current);
        }

        // Reset the updateToPrestage and updateToBuilding flags
        this.updateToPrestage = 0;
        this.updateToBuilding = '';

        // Update the dataList and dataListCopy
        this.dataList[this.dataIndex] = { ...current };
        this.dataListCopy[this.dataIndex] = { ...current };

        // Reset the error message and set success message
        this.errorMessage = '';
        this.successMessage = 'Data updated successfully.';
      } catch (error: any) {
        this.errorMessage = `An error occurred while sending data. Error: ${error.response?.status ?? 'unknown'}`;
        this.successMessage = '';
      }
    },

    async erase() {
      try {
        const current = this.dataList[this.dataIndex];
        if (!current) {
          this.errorMessage = 'No data to erase.';
          this.successMessage = '';
          return;
        }

        if (!window.confirm('Are you sure you want to wipe this device? This action cannot be undone.')) {
          return;
        }

        await axios.delete(`/wipedevice/${current.computerId}`)
          .catch((error: any) => {
            console.error('Error wiping device:', error.response?.data || error.message);
            throw error;
          });
        this.errorMessage = '';
        this.successMessage = 'Device wipe sent.';
        this.dataList.splice(this.dataIndex, 1);
        this.dataListCopy.splice(this.dataIndex, 1);
        this.dataIndex = Math.min(this.dataIndex, this.dataList.length - 1);
      } catch (error: any) {
        this.errorMessage = `An error occurred while erasing data. Error: ${error.response?.status ?? 'unknown'}`;
        this.successMessage = '';
      }
    },

    async retire() {
      try {
        const current = this.dataList[this.dataIndex];
        if (!current) {
          this.errorMessage = 'No data to retire.';
          this.successMessage = '';
          return;
        }

        if (!window.confirm('Are you sure you want to retire this device? This action cannot be undone.')) {
          return;
        }

        await axios.delete(`/retiredevice/${current.computerId}/${current.serialNumber}/${current.macAddress}/${current.altMacAddress}`)
          .catch((error: any) => {
            console.error('Error retiring device:', error.response?.data || error.message);
            throw error;
          });
        this.errorMessage = '';
        this.successMessage = 'Device retired successfully.';
        this.dataList.splice(this.dataIndex, 1);
        this.dataListCopy.splice(this.dataIndex, 1);
        this.dataIndex = Math.min(this.dataIndex, this.dataList.length - 1);
      } catch (error: any) {
        this.errorMessage = `An error occurred while retiring data. Error: ${error.response?.status ?? 'unknown'}`;
        this.successMessage = '';
      }
    },
  }
}

function fetchPrestages() {
  return {
    prestages: [],

    async init() {
      const response: AxiosResponse = await axios.get(`/prestages`)
        .catch((error: any) => {
          console.error('Error fetching prestages:', error.response?.data || error.message);
          throw error;
        });
      response.data.sort((a: { displayName: string; }, b: { displayName: string; }) => a.displayName.localeCompare(b.displayName));
      this.prestages = response.data;
    }
  }
}

function fetchBuildings() {
  return {
    buildings: [],

    async init() {
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

Alpine.data('AzureAuth', AzureAuth);
Alpine.data('FetchBuildings', fetchBuildings);
Alpine.data('FetchPrestages', fetchPrestages);
Alpine.data('AlpineData', createAlpineData);

Alpine.start();