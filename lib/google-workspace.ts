import { google } from 'googleapis';
import { OAuth2Client, Credentials } from 'google-auth-library';

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

  constructor(config: {
    client_id: string;
    client_secret: string;
    redirect_uri: string;
  }) {
    this.oauth2Client = new OAuth2Client(
      config.client_id,
      config.client_secret,
      config.redirect_uri
    );

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

  async setCredentials(credentials: Credentials) {
    this.oauth2Client.setCredentials(credentials);
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
          
          // First get the list of tokens
          const listResponse = await this.admin.tokens.list({
            userKey: user.primaryEmail,
            maxResults: 500
          });
          
          // For each token, get detailed information
          const userTokens = await Promise.all((listResponse.data.items || []).map(async (token: any) => {
            try {
              // Get detailed token information
              const detailResponse = await this.admin.tokens.get({
                userKey: user.primaryEmail,
                clientId: token.clientId
              });
              
              const detailedToken = detailResponse.data;
              
              // Combine scopes from all possible sources
              let scopes = new Set<string>();
              
              // Add scopes from the detailed token response
              if (detailedToken.scopes) {
                detailedToken.scopes.forEach((s: string) => scopes.add(s));
              }
              
              // Add scopes from the list response
              if (token.scopes) {
                token.scopes.forEach((s: string) => scopes.add(s));
              }
              
              // Check scope_data field
              if (detailedToken.scopeData) {
                detailedToken.scopeData.forEach((sd: any) => {
                  if (sd.scope) scopes.add(sd.scope);
                  if (sd.value) scopes.add(sd.value);
                });
              }
              
              // Check raw scope string if available
              if (detailedToken.scope && typeof detailedToken.scope === 'string') {
                detailedToken.scope.split(/\s+/).forEach((s: string) => scopes.add(s));
              }
              
              // For admin applications, ensure we capture all relevant scopes
              if (detailedToken.displayText && (
                detailedToken.displayText.includes('Admin') || 
                detailedToken.displayText.includes('Google') ||
                detailedToken.displayText.includes('Workspace')
              )) {
                const adminScopesToCheck = [
                  'https://www.googleapis.com/auth/admin.directory.device.chromeos',
                  'https://www.googleapis.com/auth/admin.directory.device.mobile',
                  'https://www.googleapis.com/auth/admin.directory.group',
                  'https://www.googleapis.com/auth/admin.directory.group.member',
                  'https://www.googleapis.com/auth/admin.directory.orgunit',
                  'https://www.googleapis.com/auth/admin.directory.resource.calendar',
                  'https://www.googleapis.com/auth/admin.directory.rolemanagement',
                  'https://www.googleapis.com/auth/admin.directory.user',
                  'https://www.googleapis.com/auth/admin.directory.user.alias',
                  'https://www.googleapis.com/auth/admin.directory.user.security'
                ];
                
                // If there are any admin scopes, include the full set
                if ([...scopes].some(s => s.includes('admin.directory'))) {
                  adminScopesToCheck.forEach(s => scopes.add(s));
                }
              }
              
              console.log(`Token for ${detailedToken.displayText || 'Unknown'}: Found ${scopes.size} scopes`);
              
              return {
                ...detailedToken,
                userKey: user.id,
                userEmail: user.primaryEmail,
                scopes: Array.from(scopes)
              };
            } catch (tokenError) {
              console.error(`Error fetching detailed token info for ${token.clientId}:`, tokenError);
              // Return the basic token info if detailed fetch fails
              return {
                ...token,
                userKey: user.id,
                userEmail: user.primaryEmail,
                scopes: token.scopes || []
              };
            }
          }));
          
          allTokens = [...allTokens, ...userTokens];
          console.log(`Found ${userTokens.length} tokens for user ${user.primaryEmail}`);
        } catch (error) {
          console.error(`Error fetching tokens for user ${user.primaryEmail}:`, error);
        }
      }
      
      return allTokens;
    } catch (error) {
      console.error('Error fetching OAuth tokens:', error);
      return [];
    }
  }

  async getToken(code: string) {
    const { tokens } = await this.oauth2Client.getToken(code);
    return tokens;
  }

  // Add method to get authenticated user info
  async getAuthenticatedUserInfo() {
    const oauth2 = google.oauth2('v2');
    const response = await oauth2.userinfo.get({
      auth: this.oauth2Client,
    });
    return response.data;
  }
} 