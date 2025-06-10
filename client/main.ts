import Alpine from 'alpinejs';
import AzureAuth from "./azure-auth.ts"
import axios, { type AxiosResponse } from 'axios';

const apiURL = `https://${process.env.SERVER_API_HOSTNAME}:${process.env.SERVER_API_PORT}/api`;
console.log(`Server URL: ${apiURL}`);
axios.defaults.baseURL = apiURL;

function createAlpineData() {
  return {
    searchData: '',
    dataIndex: 0,
    dataList: [
      { name: "Alice", test: "alice@example.com", role: "Admin", test2: "testess" },
      { name: "Bob", email: "bob@example.com", role: "User" },
      { name: "Carol", email: "carol@example.com", role: "Manager" }
    ],
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
      const response = await axios.get(`/data/${this.searchData}`);
      this.dataList = response.data;
      this.dataIndex = 0;
      console.log(`Search results: ${JSON.stringify(this.dataList)}`);
      return this.dataList;
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
Alpine.data('prestageDropdown', fetchPrestages);
Alpine.data('AlpineData', createAlpineData);

Alpine.start();