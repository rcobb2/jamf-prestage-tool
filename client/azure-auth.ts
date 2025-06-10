import { PublicClientApplication } from '@azure/msal-browser';

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

export default () => {
  return {
    isAuthenticated: false,
    errorMessage: '',

    async init() {
      try {
        await msalInstance.initialize(); // Initialize the MSAL instance
        const accounts = msalInstance.getAllAccounts();
        if (accounts.length > 0) {
          // Check if the account's tenantId matches the expected tenant
          this.isAuthenticated = accounts.some(
            (account: any) => account.idTokenClaims?.aud === process.env.AZURE_CLIENT_ID
          );

          // If no account is authenticated, set an error message
          if (!this.isAuthenticated) {
            this.errorMessage = "No authenticated account with the expected tenant ID found.";
          }
        }
        // Handle redirect response if applicable (e.g., after loginRedirect)
        await msalInstance.handleRedirectPromise();
      } catch (error: any) {
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
      } catch (error: any) {
        console.error("Login Error:", error);
        this.errorMessage = `Login failed: ${error.message}`;
      }
    },

    async signOut() {
      this.errorMessage = '';
      try {
        await msalInstance.logoutPopup(); // or logoutRedirect()
        this.isAuthenticated = false;
      } catch (error: any) {
        console.error("Logout Error:", error);
        this.errorMessage = `Logout failed: ${error.message}`;
      }
    }
  }
}