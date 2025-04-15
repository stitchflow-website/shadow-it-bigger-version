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
      const batchSize = 5; // Reduced batch size to avoid rate limits
      const userBatches: any[][] = [];
      
      for (let i = 0; i < users.length; i += batchSize) {
        userBatches.push(users.slice(i, i + batchSize));
      }
      
      let allTokens: Token[] = [];
      
      // Process each batch with exponential backoff retry
      for (const [batchIndex, userBatch] of userBatches.entries()) {
        console.log(`Processing batch ${batchIndex + 1}/${userBatches.length} (${userBatch.length} users)`);
        
        // Add delay between batches to respect rate limits
        if (batchIndex > 0) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
        
        // Process users in this batch with retries
        const batchResults = await Promise.all(
          userBatch.map(async (user: any) => {
            let retryCount = 0;
            const maxRetries = 3;
            
            while (retryCount < maxRetries) {
              try {
                console.log(`Fetching tokens for user: ${user.primaryEmail} (attempt ${retryCount + 1})`);
                
                // Get tokens list with pagination
                let pageToken: string | undefined = undefined;
                let userTokensList: any[] = [];
                
                do {
                  const listResponse: { data: { items?: any[]; nextPageToken?: string } } = await this.admin.tokens.list({
                    userKey: user.primaryEmail,
                    maxResults: 100,
                    pageToken
                  }).catch((error: any) => {
                    if (error.code === 404) {
                      console.log(`No tokens found for user: ${user.primaryEmail}`);
                      return { data: { items: [] } };
                    }
                    throw error;
                  });
                  
                  if (listResponse.data.items && listResponse.data.items.length > 0) {
                    userTokensList = [...userTokensList, ...listResponse.data.items];
                  }
                  
                  pageToken = listResponse.data.nextPageToken;
                } while (pageToken);
                
                // Process tokens in smaller batches
                const tokenBatchSize = 3;
                const tokenBatches = [];
                
                for (let i = 0; i < userTokensList.length; i += tokenBatchSize) {
                  tokenBatches.push(userTokensList.slice(i, i + tokenBatchSize));
                }
                
                let userTokens: Token[] = [];
                
                for (const tokenBatch of tokenBatches) {
                  // Add delay between token batches
                  await new Promise(resolve => setTimeout(resolve, 500));
                  
                  const tokenPromises = tokenBatch.map(async (token: any) => {
                    try {
                      const detailResponse = await this.admin.tokens.get({
                        userKey: user.primaryEmail,
                        clientId: token.clientId
                      });
                      
                      const detailedToken = detailResponse.data;
                      const scopes = new Set<string>();
                      
                      // Efficient scope processing
                      const processScopes = (scopeArray: string[] | undefined) => {
                        if (Array.isArray(scopeArray)) {
                          scopeArray.forEach(s => scopes.add(s));
                        }
                      };
                      
                      processScopes(detailedToken.scopes);
                      processScopes(token.scopes);
                      
                      if (detailedToken.scopeData) {
                        detailedToken.scopeData.forEach((sd: any) => {
                          if (sd.scope) scopes.add(sd.scope);
                          if (sd.value) scopes.add(sd.value);
                        });
                      }
                      
                      if (typeof detailedToken.scope === 'string') {
                        detailedToken.scope.split(/\s+/).forEach((s: string) => scopes.add(s));
                      }
                      
                      // Check for admin applications
                      if (detailedToken.displayText?.match(/Admin|Google|Workspace/i)) {
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
                        
                        if ([...scopes].some(s => s.includes('admin.directory'))) {
                          adminScopes.forEach(s => scopes.add(s));
                        }
                      }
                      
                      return {
                        ...detailedToken,
                        userKey: user.id,
                        userEmail: user.primaryEmail,
                        scopes: Array.from(scopes)
                      };
                    } catch (tokenError: any) {
                      console.error(
                        `Error fetching detailed token info for ${token.clientId} (user: ${user.primaryEmail}):`,
                        tokenError.message
                      );
                      
                      // Return basic token info on error
                      return {
                        ...token,
                        userKey: user.id,
                        userEmail: user.primaryEmail,
                        scopes: token.scopes || []
                      };
                    }
                  });
                  
                  const batchResults = await Promise.all(tokenPromises);
                  userTokens = [...userTokens, ...batchResults];
                }
                
                console.log(`Found ${userTokens.length} tokens for user ${user.primaryEmail}`);
                return userTokens;
              } catch (error: any) {
                retryCount++;
                
                if (retryCount === maxRetries) {
                  console.error(
                    `Failed to fetch tokens for user ${user.primaryEmail} after ${maxRetries} attempts:`,
                    error.message
                  );
                  return [];
                }
                
                // Exponential backoff
                const delay = Math.pow(2, retryCount) * 1000;
                console.log(`Retrying in ${delay}ms...`);
                await new Promise(resolve => setTimeout(resolve, delay));
              }
            }
            
            return []; // Fallback if all retries fail
          })
        );
        
        allTokens = [...allTokens, ...batchResults.flat()];
        console.log(`Completed batch ${batchIndex + 1}/${userBatches.length}, total tokens: ${allTokens.length}`);
      }
      
      return allTokens;
    } catch (error) {
      console.error('Error fetching OAuth tokens:', error);
      throw error; // Propagate error to caller
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
          projection: 'full'
        }).catch((error: any) => {
          console.error('Error in users.list API call:', {
            code: error?.code,
            message: error?.message,
            status: error?.status,
            response: error?.response?.data,
            scopes: this.oauth2Client.credentials.scope
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
        scopes: this.oauth2Client.credentials.scope
      });
      throw error;
    }
  }
} 