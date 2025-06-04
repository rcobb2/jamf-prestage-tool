function app() {
  return {
    search: '',
    dataIndex: 0,
    dataList: [
      { name: "Alice", test: "alice@example.com", role: "Admin", test2: "testess" },
      { name: "Bob", email: "bob@example.com", role: "User" },
      { name: "Carol", email: "carol@example.com", role: "Manager" }
    ],
    get data() {
      return this.dataList[this.dataIndex] || {};
    },
    loadData() {
      // Simulate search by cycling through data
      this.dataIndex = (this.dataIndex + 1) % this.dataList.length;
    },
    prev() {
      this.dataIndex = (this.dataIndex - 1 + this.dataList.length) % this.dataList.length;
    },
    next() {
      this.dataIndex = (this.dataIndex + 1) % this.dataList.length;
    }
  }
}


function test() {
  console.log('test');
}

console.log('test');