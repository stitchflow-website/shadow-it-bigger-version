export function getAuthProvider() {
    // Check local storage or session storage for the auth provider
    const provider = localStorage.getItem('authProvider') || 'google'; // default to google
    return provider;
  }
  
  export function setAuthProvider(provider: 'google' | 'microsoft') {
    localStorage.setItem('authProvider', provider);
  }