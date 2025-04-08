import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';

// Define interfaces for Google API responses
interface Token {
  clientId: string;
  displayText?: string;
  scopes?: string[];
  userKey: string;
  userEmail?: string;
  lastTimeUsed?: string;
  // Other token fields from Google API
  [key: string]: any;
}

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

  async getOAuthTokens(): Promise<Token[]> {
    try {
      // Get all users in the organization
      const users = await this.getUsersList();
      console.log(`Found ${users.length} users in the organization`);
      
      let allTokens: Token[] = [];
      
      // For each user, try to fetch their tokens
      for (const user of users) {
        try {
          console.log(`Fetching tokens for user: ${user.primaryEmail}`);
          const response = await this.admin.tokens.list({
            userKey: user.primaryEmail,
            maxResults: 500
          });
          
          // Add user reference to each token
          const userTokens = (response.data.items || []).map((token: any): Token => ({
            ...token,
            userKey: user.id, // Use the Google user ID as the userKey for mapping
            userEmail: user.primaryEmail // Add email for reference
          }));
          
          allTokens = [...allTokens, ...userTokens];
          console.log(`Found ${userTokens.length} tokens for user ${user.primaryEmail}`);
        } catch (error) {
          // Don't fail the entire process if one user fails
          console.error(`Error fetching tokens for user ${user.primaryEmail}:`, error);
        }
      }
      
      return allTokens;
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

  // Add method to get authenticated user info
  async getAuthenticatedUserInfo() {
    const response = await this.oauth2.userinfo.get();
    return response.data;
  }
} 