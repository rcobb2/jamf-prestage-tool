/// <reference lib="dom" />
import Alpine from 'alpinejs';
import AzureAuth from "./azure-auth.ts"
import axios, { type AxiosResponse } from 'axios';

const apiURL = `https://${process.env.SERVER_API_HOSTNAME}:${process.env.SERVER_API_PORT}/api`;
console.log(`Server URL: ${apiURL}`);
axios.defaults.baseURL = apiURL;

function createAlpineData() {
  return {
    searchData: '',
    errorMessage: '',
    selectedPrestage: '',
    dataIndex: 0,
    dataList: [],

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
        this.selectedPrestage = response.data[0].currentprestage || '';

        this.$nextTick(() => {
          const select = document.querySelector('select[name="prestage"]') as HTMLSelectElement | null;
          if (select) {
            Array.from(select.options).forEach(option => {
              option.selected = option.value === this.selectedPrestage;
            });
          }
        });

        const filteredData = response.data.map(({ currentPrestage, ...rest }: any) => rest);
        this.dataList = filteredData;
        this.dataIndex = 0;
        this.errorMessage = '';
      } catch (error: any) {
        if (error.response && error.response.status === 404) {
          this.errorMessage = `No computer found for: ${this.searchData}`;
        } else {
          this.errorMessage = 'An error occurred while searching.';
        }
        this.dataList = [];
        this.dataIndex = 0;
      }
    },
  }
}

function fetchPrestages() {
  return {
    prestages: [],
    selectedPrestage: '',

    async init() {
      const response: AxiosResponse = await axios.get(`/prestages`);
      this.prestages = await response.data;
    }
  }
}

// @ts-ignore
window.Alpine = Alpine;

Alpine.data('AzureAuth', AzureAuth);
Alpine.data('FetchPrestages', fetchPrestages);
Alpine.data('AlpineData', createAlpineData);

Alpine.start();