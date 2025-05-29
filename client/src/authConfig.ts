export const msalConfig = {
  auth: {
    clientId: process.env.REACT_APP_CLIENT_ID,
    authority: process.env.REACT_APP_TENANT_ID,
    redirectUri: window.location.origin,
  },
  cache: {
    cacheLocation: "sessionStorage", // or "localStorage"
    storeAuthStateInCookie: false,
  },
};

export const loginRequest = {
  scopes: ["user.read"],
};