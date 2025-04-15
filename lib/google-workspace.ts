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
      const users = await this.getUsersListPaginated();
      console.log(`Found ${users.length} users in the organization`);
      
      // Create batches of users to process in parallel
      const batchSize = 10; // Process 10 users in parallel
      const userBatches: any[][] = [];
      
      for (let i = 0; i < users.length; i += batchSize) {
        userBatches.push(users.slice(i, i + batchSize));
      }
      
      let allTokens: Token[] = [];
      
      // Process each batch in parallel
      for (const [batchIndex, userBatch] of userBatches.entries()) {
        console.log(`Processing batch ${batchIndex + 1}/${userBatches.length} (${userBatch.length} users)`);
        
        // Create promises for all users in this batch
        const batchPromises = userBatch.map(async (user: any) => {
          try {
            console.log(`Fetching tokens for user: ${user.primaryEmail}`);
            
            // First get the list of tokens with pagination support
            let pageToken: string | undefined = undefined;
            let userTokensList: any[] = [];
            
            do {
              const listResponse: any = await this.admin.tokens.list({
                userKey: user.primaryEmail,
                maxResults: 100,
                pageToken
              });
              
              if (listResponse.data.items && listResponse.data.items.length > 0) {
                userTokensList = [...userTokensList, ...listResponse.data.items];
              }
              
              pageToken = listResponse.data.nextPageToken;
            } while (pageToken);
            
            // Process tokens in parallel batches to avoid rate limiting
            const tokenBatchSize = 5;
            const tokenBatches = [];
            
            for (let i = 0; i < userTokensList.length; i += tokenBatchSize) {
              tokenBatches.push(userTokensList.slice(i, i + tokenBatchSize));
            }
            
            let userTokens: Token[] = [];
            
            for (const tokenBatch of tokenBatches) {
              const tokenPromises = tokenBatch.map(async (token: any) => {
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
              });
              
              // Wait for this batch of token promises
              const batchResults = await Promise.all(tokenPromises);
              userTokens = [...userTokens, ...batchResults];
            }
            
            console.log(`Found ${userTokens.length} tokens for user ${user.primaryEmail}`);
            return userTokens;
          } catch (error) {
            console.error(`Error fetching tokens for user ${user.primaryEmail}:`, error);
            return [];
          }
        });
        
        // Process this batch of users
        const batchResults = await Promise.all(batchPromises);
        allTokens = [...allTokens, ...batchResults.flat()];
        
        console.log(`Completed batch ${batchIndex + 1}/${userBatches.length}, total tokens so far: ${allTokens.length}`);
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
    const response = await this.oauth2.userinfo.get();
    return response.data;
  }

  // Add this optimized method to get user list with pagination support
  async getUsersListPaginated(): Promise<any[]> {
    let users: any[] = [];
    let pageToken: string | undefined = undefined;
    
    do {
      const response: any = await this.admin.users.list({
        customer: 'my_customer',
        maxResults: 500,
        orderBy: 'email',
        pageToken
      });
      
      if (response.data.users && response.data.users.length > 0) {
        users = [...users, ...response.data.users];
      }
      
      pageToken = response.data.nextPageToken;
    } while (pageToken);
    
    return users;
  }
} 