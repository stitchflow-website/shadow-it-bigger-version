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

  // New method to get current credentials
  getCredentials() {
    return this.oauth2Client.credentials;
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
      
      // Increased batch size and concurrent processing
      const batchSize = 100; // Increased from 5
      const maxConcurrentBatches = 100;
      const userBatches: any[][] = [];
      
      for (let i = 0; i < users.length; i += batchSize) {
        userBatches.push(users.slice(i, i + batchSize));
      }
      
      let allTokens: Token[] = [];
      
      // Process batches with controlled concurrency
      for (let i = 0; i < userBatches.length; i += maxConcurrentBatches) {
        const currentBatches = userBatches.slice(i, i + maxConcurrentBatches);
        console.log(`Processing batches ${i + 1} to ${i + currentBatches.length} of ${userBatches.length}`);
        
        const batchPromises = currentBatches.map(async (userBatch, batchIndex) => {
          // Stagger the start of concurrent batches to avoid rate limits
          await new Promise(resolve => setTimeout(resolve, batchIndex * 100));
          
          return Promise.all(userBatch.map(async (user: any) => {
            try {
              console.log(`Fetching tokens for user: ${user.primaryEmail}`);
              
              // Get tokens list with pagination - now in parallel
              const userTokens = await this.fetchUserTokens(user);
              
              // Process tokens in larger batches with parallel processing
              const processedTokens = await this.processUserTokens(user, userTokens);
              
              console.log(`Found ${processedTokens.length} tokens for user ${user.primaryEmail}`);
              return processedTokens;
            } catch (error: any) {
              console.error(`Error processing user ${user.primaryEmail}:`, error.message);
              return []; // Return empty array on error to continue with other users
            }
          }));
        });
        
        const batchResults = await Promise.all(batchPromises);
        allTokens = [...allTokens, ...batchResults.flat(2)];
        
        // Brief pause between major batch groups to respect rate limits
        if (i + maxConcurrentBatches < userBatches.length) {
          await new Promise(resolve => setTimeout(resolve, 500));
          // This 500ms pause between major batch groups helps prevent
          // overwhelming the API with too many requests in a short time
        }
      }
      
      return allTokens;
    } catch (error) {
      console.error('Error fetching OAuth tokens:', error);
      throw error;
    }
  }

  // New helper method to fetch user tokens with efficient pagination
  private async fetchUserTokens(user: any): Promise<any[]> {
    let pageToken: string | undefined = undefined;
    let allTokens: any[] = [];
    
    do {
      try {
        const listResponse: { data: { items?: any[]; nextPageToken?: string } } = await this.admin.tokens.list({
          userKey: user.primaryEmail,
          maxResults: 100,
          pageToken
        });
        
        if (listResponse.data.items) {
          allTokens = [...allTokens, ...listResponse.data.items];
        }
        
        pageToken = listResponse.data.nextPageToken;
      } catch (error: any) {
        if (error.code === 404) {
          console.log(`No tokens found for user: ${user.primaryEmail}`);
          return [];
        }
        throw error;
      }
    } while (pageToken);
    
    return allTokens;
  }

  // New helper method to process user tokens efficiently
  private async processUserTokens(user: any, tokens: any[]): Promise<Token[]> {
    if (!tokens.length) return [];
    
    const batchSize = 100; // Process 5 tokens at once
    const tokenBatches = [];
    
    for (let i = 0; i < tokens.length; i += batchSize) {
      tokenBatches.push(tokens.slice(i, i + batchSize));
    }
    
    const processedTokens: Token[] = [];
    
    for (const batch of tokenBatches) {
      try {
        const batchResults = await Promise.all(batch.map(async (token) => {
          try {
            const detailResponse = await this.admin.tokens.get({
              userKey: user.primaryEmail,
              clientId: token.clientId
            });
            
            const detailedToken = detailResponse.data;
            const scopes = new Set<string>();
            
            // More efficient scope processing
            this.processTokenScopes(detailedToken, scopes);
            
            return {
              ...detailedToken,
              userKey: user.id,
              userEmail: user.primaryEmail,
              scopes: Array.from(scopes)
            };
          } catch (error) {
            // Return basic token info on error
            return {
              ...token,
              userKey: user.id,
              userEmail: user.primaryEmail,
              scopes: token.scopes || []
            };
          }
        }));
        
        processedTokens.push(...batchResults);
        
        // Minimal delay between batches
        if (tokenBatches.length > 1) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      } catch (error) {
        console.error(`Error processing token batch for ${user.primaryEmail}:`, error);
      }
    }
    
    return processedTokens;
  }

  // New helper method for efficient scope processing
  private processTokenScopes(token: any, scopes: Set<string>): void {
    // Process direct scopes
    if (Array.isArray(token.scopes)) {
      token.scopes.forEach((s: string) => scopes.add(s));
    }
    
    // Process scope data
    if (Array.isArray(token.scopeData)) {
      token.scopeData.forEach((sd: any) => {
        if (sd.scope) scopes.add(sd.scope);
        if (sd.value) scopes.add(sd.value);
      });
    }
    
    // Process string scope
    if (typeof token.scope === 'string') {
      token.scope.split(/\s+/).forEach((s: string) => scopes.add(s));
    }
    
    // Process admin scopes
    if (token.displayText?.match(/Admin|Google|Workspace/i) && 
        [...scopes].some(s => s.includes('admin.directory'))) {
      this.addAdminScopes(scopes);
    }
  }

  // Helper for admin scopes
  private addAdminScopes(scopes: Set<string>): void {
    const adminScopes = [
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
    adminScopes.forEach(s => scopes.add(s));
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
    
    try {
      console.log('Starting paginated user list fetch');
      console.log('Using credentials with scopes:', this.oauth2Client.credentials.scope);
      
      do {
        console.log(`Fetching user page${pageToken ? ' with token: ' + pageToken : ''}`);
        
        const response: any = await this.admin.users.list({
          customer: 'my_customer',
          maxResults: 500,
          orderBy: 'email',
          pageToken,
          viewType: 'admin_view',
          projection: 'full'
        }).catch((error: any) => {
          console.error('Error in users.list API call:', {
            code: error?.code,
            message: error?.message,
            status: error?.status,
            response: error?.response?.data,
            scopes: this.oauth2Client.credentials.scope,
            credentials: {
              hasAccess: !!this.oauth2Client.credentials.access_token,
              hasRefresh: !!this.oauth2Client.credentials.refresh_token,
              expiry: this.oauth2Client.credentials.expiry_date 
                ? new Date(this.oauth2Client.credentials.expiry_date).toISOString() 
                : 'unknown'
            }
          });
          throw error;
        });
        
        console.log('User page response:', {
          hasUsers: !!response.data.users,
          userCount: response.data.users?.length || 0,
          hasNextPage: !!response.data.nextPageToken
        });
        
        if (response.data.users && response.data.users.length > 0) {
          users = [...users, ...response.data.users];
        }
        
        pageToken = response.data.nextPageToken;
      } while (pageToken);
      
      console.log(`Successfully fetched ${users.length} total users`);
      return users;
    } catch (error: any) {
      console.error('Error in getUsersListPaginated:', {
        name: error?.name,
        message: error?.message,
        code: error?.code,
        status: error?.status,
        response: error?.response?.data,
        scopes: this.oauth2Client.credentials.scope,
        requestedScopes: this.oauth2Client.credentials.scope?.split(' ') || []
      });
      throw error;
    }
  }
} 