import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';

export class GoogleWorkspaceService {
  private oauth2Client: OAuth2Client;
  private admin: any;
  private oauth2: any;

  constructor(credentials: any) {
    this.oauth2Client = new OAuth2Client({
      clientId: credentials.client_id,
      clientSecret: credentials.client_secret,
      redirectUri: credentials.redirect_uri,
    });

    // Initialize admin SDK
    this.admin = google.admin({
      version: 'directory_v1',
      auth: this.oauth2Client
    });

    // Initialize OAuth2 API
    this.oauth2 = google.oauth2({
      version: 'v2',
      auth: this.oauth2Client
    });
  }

  async setCredentials(tokens: any) {
    this.oauth2Client.setCredentials(tokens);
  }

  async getOrganizationDetails() {
    const response = await this.admin.domains.list({
      customer: 'my_customer',
    });
    return response.data;
  }

  async getUsersList() {
    const response = await this.admin.users.list({
      customer: 'my_customer',
      maxResults: 500,
      orderBy: 'email',
    });
    return response.data.users;
  }

  async getUserDetails(userKey: string) {
    const response = await this.admin.users.get({
      userKey,
    });
    return response.data;
  }

  async getOAuthTokens() {
    try {
      // Get the current user's email
      const userInfo = await this.oauth2.userinfo.get();
      const userEmail = userInfo.data.email;

      // List tokens for the current user
      const response = await this.admin.tokens.list({
        userKey: userEmail,
        maxResults: 500
      });
      return response.data.items || [];
    } catch (error) {
      console.error('Error fetching OAuth tokens:', error);
      // Return empty array instead of throwing to handle the case where no tokens exist
      return [];
    }
  }

  async getToken(code: string) {
    const { tokens } = await this.oauth2Client.getToken(code);
    return tokens;
  }
} 