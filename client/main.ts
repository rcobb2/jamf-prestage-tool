import Alpine from 'alpinejs';
import axios from 'axios';
// import "./search.ts"

const apiURL = `https://${process.env.SERVER_API_HOSTNAME}:${process.env.SERVER_API_PORT}`;
console.log(`Server URL: ${apiURL}`);

function createAlpineData() {
  return {
    search: '',
    dataIndex: 0,
    dataList: [
      { name: "Alice", test: "alice@example.com", role: "Admin", test2: "testess" },
      { name: "Bob", email: "bob@example.com", role: "User" },
      { name: "Carol", email: "carol@example.com", role: "Manager" }
    ],
    prestages: [],
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
    searchButton() {
      console.log(this.search);
    },
    async fetchPrestages() {
      const response = await axios.get(`${apiURL}/api/prestages`);
      this.prestages = response.data;
      console.log(`Fetched prestages: ${this.prestages.length}`);
    }
  }
}

Alpine.data('AlpineData', createAlpineData);

Alpine.start();