import Alpine from 'alpinejs';
import AzureAuth from "./azure-auth.ts"

const apiURL = `https://${process.env.SERVER_API_HOSTNAME}:${process.env.SERVER_API_PORT}/api`;
console.log(`Server URL: ${apiURL}`);

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
    loadData() {
      return 'test';
    },
    prev() {
      this.dataIndex = (this.dataIndex - 1 + this.dataList.length) % this.dataList.length;
    },
    next() {
      this.dataIndex = (this.dataIndex + 1) % this.dataList.length;
    },
    search() {
      console.log(this.searchData);
    },
  }
}

function fetchPrestages() {
  return {
    prestages: [],
    selectedPrestage: '',

    async init() {
      try {
        const response = await fetch(`${apiURL}/prestages`);
        this.prestages = await response.json();

      } catch (error: any) {
        console.error(`Error fetching prestages: ${error.message}`);
      }
    }
  }
}

// @ts-ignore
window.Alpine = Alpine;

Alpine.data('azureAuth', AzureAuth);
Alpine.data('prestageDropdown', fetchPrestages);
Alpine.data('AlpineData', createAlpineData);

Alpine.start();