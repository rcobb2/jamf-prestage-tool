// SKIP_AUTH is inlined as a boolean literal by Bun at build time (env: 'inline' in worker.ts).
// When true, MSAL is never imported or executed — the dynamic import below is dead code.
const SKIP_AUTH = process.env.SKIP_ENTRA_AUTH === 'true';

import axios from 'axios';

export default () => {
  return {
    isAuthenticated: SKIP_AUTH,
    errorMessage: '',
    _msal: null as any,

    async init() {
      if (SKIP_AUTH) return;

      const { PublicClientApplication } = await import('@azure/msal-browser');
      this._msal = new PublicClientApplication({
        auth: {
          clientId: process.env.AZURE_CLIENT_ID as string,
          authority: process.env.AZURE_AUTHORITY,
          redirectUri: `https://${process.env.CLIENT_HOSTNAME}:${process.env.CLIENT_PORT}/`,
        },
        cache: {
          cacheLocation: 'localStorage',
          storeAuthStateInCookie: false,
        },
      });
      try {
        await this._msal.initialize();
        const accounts = this._msal.getAllAccounts();
        if (accounts.length > 0) {
          this.isAuthenticated = accounts.some(
            (account: any) => account.idTokenClaims?.aud === process.env.AZURE_CLIENT_ID
          );
          if (!this.isAuthenticated) {
            this.errorMessage = 'No authenticated account with the expected tenant ID found.';
          }
        }
        await this._msal.handleRedirectPromise();
      } catch (error: any) {
        console.error('MSAL Initialization Error:', error);
        this.errorMessage = `Authentication error: ${error.message}`;
      }
    },

    async signIn() {
      if (SKIP_AUTH) return;
      this.errorMessage = '';
      try {
        const result = await this._msal.loginPopup();
        this.isAuthenticated = true;
        if (result?.account?.name) {
          axios.defaults.headers.common['X-User-Name'] = result.account.name;
        }
      } catch (error: any) {
        console.error('Login Error:', error);
        this.errorMessage = `Login failed: ${error.message}`;
      }
    },

    async signOut() {
      if (SKIP_AUTH) return;
      this.errorMessage = '';
      try {
        await this._msal.logoutPopup();
        this.isAuthenticated = false;
      } catch (error: any) {
        console.error('Logout Error:', error);
        this.errorMessage = `Logout failed: ${error.message}`;
      }
    },
  };
};
