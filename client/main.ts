import { PublicClientApplication } from '@azure/msal-browser';
import Alpine from 'alpinejs';
import axios from 'axios';
// import "./search.ts"

const apiURL = `https://${process.env.SERVER_API_HOSTNAME}:${process.env.SERVER_API_PORT}`;
console.log(`Server URL: ${apiURL}`);

const msalConfig = {
  auth: {
    clientId: process.env.AZURE_CLIENT_ID as string,
    authority: process.env.AZURE_AUTHORITY, // e.g., "https://login.microsoftonline.com/common"
    redirectUri: `https://${process.env.CLIENT_HOSTNAME}:${process.env.CLIENT_PORT}/`, // Must match your app registration's redirect URI
  },
  cache: {
    cacheLocation: "localStorage", // Can be "localStorage" or "sessionStorage"
    storeAuthStateInCookie: false, // Set to true if you're experiencing issues with third-party cookies
  }
};
const msalInstance = new PublicClientApplication(msalConfig);

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

function AzureAuth() {
  return {
    isAuthenticated: false,
    errorMessage: '',

    async init() {
      try {
        await msalInstance.initialize(); // Initialize the MSAL instance
        const accounts = msalInstance.getAllAccounts();
        if (accounts.length > 0) {
          this.isAuthenticated = true;
          this.username = accounts[0].username;
        }
        // Handle redirect response if applicable (e.g., after loginRedirect)
        await msalInstance.handleRedirectPromise();
      } catch (error) {
        console.error("MSAL Initialization Error:", error);
        this.errorMessage = `Authentication error: ${error.message}`;
      }
    },

    async signIn() {
      this.errorMessage = '';
      try {
        // Use loginPopup for a popup window, or loginRedirect for a full page redirect
        const loginResponse = await msalInstance.loginPopup();
        this.isAuthenticated = true;
      } catch (error) {
        console.error("Login Error:", error);
        this.errorMessage = `Login failed: ${error.message}`;
      }
    },

    async signOut() {
      this.errorMessage = '';
      try {
        await msalInstance.logoutPopup(); // or logoutRedirect()
        this.isAuthenticated = false;
      } catch (error) {
        console.error("Logout Error:", error);
        this.errorMessage = `Logout failed: ${error.message}`;
      }
    }
  }
}

// @ts-ignore
window.Alpine = Alpine;

Alpine.data('AzureAuth', AzureAuth);
Alpine.data('AlpineData', createAlpineData);

Alpine.start();