/// <reference lib="dom" />
import Alpine from 'alpinejs';
import AzureAuth from "./azure-auth.ts"
import axios, { type AxiosResponse } from 'axios';

const apiURL = `https://${process.env.SERVER_API_HOSTNAME}:${process.env.SERVER_API_PORT}/api`;
console.log(`Server URL: ${apiURL}`);
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
  serialNumber: string,
  currentPrestage: string,
  enrollmentMethod: string,
};

function createAlpineData() {
  return {
    theme: process.env.THEME || 'dim',
    searchData: '',
    errorMessage: '',
    dataList: [] as ComputerInfo[],
    dataListCopy: [] as ComputerInfo[],
    dataIndex: 0,
    totalPages: 0,
    currentPage: 0,
    updateToPrestage: 0,
    updateToBuilding: 0,

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
        const response = await axios.get(`/data/${this.searchData}`);

        this.dataList = response.data;
        this.dataListCopy = JSON.parse(JSON.stringify(this.dataList));
        this.dataIndex = 0;
        this.errorMessage = '';
      } catch (error: any) {
        if (error.response && error.response.status === 404) {
          this.errorMessage = `No computer found for: ${this.searchData}`;
        } else {
          this.errorMessage = `An error occurred while searching for data. Error: ${error.response.status}`;
        }
        this.dataList = [];
        this.dataIndex = 0;
      }
    },

    async send() {
      try {
        const current = this.dataList[this.dataIndex];
        if (!current) {
          this.errorMessage = 'No data to update.';
          return;
        }

        const original = this.dataListCopy[this.dataIndex];

        // Update preload
        // Only update if data has changed
        if (JSON.stringify(current) !== JSON.stringify(original)) {
          await axios.put(`/update-preload/${current.preloadId}/${current.computerId}`, current);
        }

        // Optionally add to prestage, if updateToPrestage is set
        if (this.updateToPrestage !== 0) {
          await axios.post('/add-to-prestage', {
            prestageId: this.updateToPrestage,
            serialNumber: current.serialNumber
          });
        }

        if (JSON.stringify(current) === JSON.stringify(original) && this.updateToPrestage === 0) {
          this.errorMessage = 'No changes to update.';
          return;
        }

        this.errorMessage = '';
      } catch (error: any) {
        this.errorMessage = `An error occurred while sending data. Error: ${error.response.status}`;
      }
    },

    async erase() {
      try {
        const current = this.dataList[this.dataIndex];
        if (!current) {
          this.errorMessage = 'No data to erase.';
          return;
        }

        if (!window.confirm('Are you sure you want to wipe this device? This action cannot be undone.')) {
          return;
        }

        await axios.delete(`/wipedevice/${current.computerId}`);
        this.errorMessage = '';
        this.dataList.splice(this.dataIndex, 1);
        this.dataListCopy.splice(this.dataIndex, 1);
        this.dataIndex = Math.min(this.dataIndex, this.dataList.length - 1);
      } catch (error: any) {
        this.errorMessage = `An error occurred while erasing data. Error: ${error.response.status}`;
      }
    },
  }
}

function fetchPrestages() {
  return {
    prestages: [],

    async init() {
      const response: AxiosResponse = await axios.get(`/prestages`);
      this.prestages = await response.data;
    }
  }
}

function fetchBuildings() {
  return {
    buildings: [],

    async init() {
      const response: AxiosResponse = await axios.get(`/buildings`);
      this.buildings = await response.data;
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