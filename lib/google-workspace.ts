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
      
      // Increased batch sizes for larger organizations
      const batchSize = 25; // Increased from 10 to 25 users per batch
      const maxConcurrentBatches = 5; // Increased from 3 to 5 concurrent batches
      const userBatches: any[][] = [];
      
      // Calculate optimal delay based on organization size
      const totalUsers = users.length;
      const minDelay = 50; // Minimum delay in ms
      const delayBetweenBatches = Math.max(minDelay, Math.min(200, Math.floor(1000 / totalUsers))); 
      
      for (let i = 0; i < users.length; i += batchSize) {
        userBatches.push(users.slice(i, i + batchSize));
      }
      
      let allTokens: Token[] = [];
      
      // Process batches with controlled concurrency
      for (let i = 0; i < userBatches.length; i += maxConcurrentBatches) {
        const currentBatches = userBatches.slice(i, i + maxConcurrentBatches);
        console.log(`Processing batches ${i + 1} to ${i + currentBatches.length} of ${userBatches.length}`);
        
        const batchPromises = currentBatches.map(async (userBatch, batchIndex) => {
          // Dynamic delay based on batch index and organization size
          await new Promise(resolve => setTimeout(resolve, batchIndex * delayBetweenBatches));
          
          return Promise.all(userBatch.map(async (user: any) => {
            try {
              console.log(`Fetching tokens for user: ${user.primaryEmail}`);
              
              // Get tokens list with pagination - now in parallel
              const userTokens = await this.fetchUserTokens(user);
              
              // Process tokens in larger batches with parallel execution
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
        
        // Adaptive delay between major batch groups based on organization size
        if (i + maxConcurrentBatches < userBatches.length) {
          const adaptiveDelay = Math.max(100, Math.min(500, Math.floor(2000 / totalUsers)));
          await new Promise(resolve => setTimeout(resolve, adaptiveDelay));
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
        interface TokenListResponse {
          data: {
            items?: Array<{
              clientId: string;
              displayText?: string;
              scopes?: string[];
              userKey: string;
            }>;
            nextPageToken?: string;
          };
        }

        const listResponse: TokenListResponse = await this.admin.tokens.list({
          userKey: user.primaryEmail,
          maxResults: 100,
          pageToken,
          fields: 'items(clientId,displayText,scopes,userKey),nextPageToken'
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

  // Optimize token processing with larger batch sizes
  private async processUserTokens(user: any, tokens: any[]): Promise<Token[]> {
    if (!tokens.length) return [];
    
    const batchSize = 10;
    const tokenBatches = [];
    
    for (let i = 0; i < tokens.length; i += batchSize) {
      tokenBatches.push(tokens.slice(i, i + batchSize));
    }
    
    const processedTokens: Token[] = [];
    
    // Create batch request
    const batch = this.admin.newBatch();
    let batchCounter = 0;
    const batchPromises: Promise<any>[] = [];
    
    for (const tokenBatch of tokenBatches) {
      const currentBatchPromise = new Promise((resolve) => {
        const batchResults: any[] = [];
        
        tokenBatch.forEach((token, index) => {
          batch.add(this.admin.tokens.get({
            userKey: user.primaryEmail,
            clientId: token.clientId,
            fields: 'clientId,displayText,scopes,scopeData,scope,permissions' // Only fetch needed fields
          }), { id: `${batchCounter}-${index}` });
        });
        
        batch.then((response: any) => {
          Object.keys(response).forEach(key => {
            if (response[key].status === 200) {
              const detailedToken = response[key].data;
              const scopes = new Set<string>();
              this.processTokenScopes(detailedToken, scopes);
              
              batchResults.push({
                ...detailedToken,
                userKey: user.id,
                userEmail: user.primaryEmail,
                scopes: Array.from(scopes)
              });
            } else {
              // Handle error case
              batchResults.push({
                ...tokenBatch[parseInt(key.split('-')[1])],
                userKey: user.id,
                userEmail: user.primaryEmail,
                scopes: tokenBatch[parseInt(key.split('-')[1])].scopes || []
              });
            }
          });
          resolve(batchResults);
        });
      });
      
      batchPromises.push(currentBatchPromise);
      batchCounter++;
    }
    
    const results = await Promise.all(batchPromises);
    processedTokens.push(...results.flat());
    
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
      
      do {
        console.log(`Fetching user page${pageToken ? ' with token: ' + pageToken : ''}`);
        
        const response: any = await this.admin.users.list({
          customer: 'my_customer',
          maxResults: 500,
          orderBy: 'email',
          pageToken,
          viewType: 'admin_view',
          projection: 'basic',  // Changed from 'full' to 'basic'
          fields: 'nextPageToken,users(id,primaryEmail,isAdmin,orgUnitPath,name)', // Only fetch needed fields
        });

        if (response.data.users && response.data.users.length > 0) {
          users = [...users, ...response.data.users];
        }
        
        pageToken = response.data.nextPageToken;
      } while (pageToken);
      
      return users;
    } catch (error: any) {
      console.error('Error in getUsersListPaginated:', error);
      throw error;
    }
  }
} 