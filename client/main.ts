import Alpine from 'alpinejs';
import axios from 'axios';
// import "./search.ts"

const apiURL = `https://${process.env.SERVER_API_HOSTNAME}:${process.env.SERVER_API_PORT}`;
console.log(`Server URL: ${apiURL}`);


function AlpineData() {
  return {
    search: '',
    dataIndex: 0,
    dataList: [],
    get getData() {
      return this.dataList[this.dataIndex] || {};
    },
    loadData() {
      // // Simulate search by cycling through data
      // this.dataIndex = (this.dataIndex + 1) % this.dataList.length;
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

    async prestages() {
      return await axios.get(`${apiURL}/api/prestages`)
    }
  }
}

Alpine.data('AlpineData', AlpineData);
Alpine.start();