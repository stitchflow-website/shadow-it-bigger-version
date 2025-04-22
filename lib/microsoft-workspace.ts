import { Client } from '@microsoft/microsoft-graph-client';
import { TokenCredentialAuthenticationProvider } from '@microsoft/microsoft-graph-client/authProviders/azureTokenCredentials';
import { ClientSecretCredential } from '@azure/identity';

// Define interfaces for Microsoft API responses
interface Token {
  clientId: string;
  displayText?: string;
  scopes?: string[];
  userKey: string;
  userEmail?: string;
  lastTimeUsed?: string;
  [key: string]: any;
}

interface MicrosoftGraphUser {
  id: string;
  mail: string;
  displayName: string;
  userPrincipalName?: string;
}

interface ServicePrincipalResponse {
  value: Array<{
    id: string;
    appId: string;
    displayName: string;
    appRoles?: Array<{
      id: string;
      value: string;
      displayName: string;
      description: string;
    }>;
    oauth2PermissionScopes?: Array<{
      id: string;
      value: string;
      adminConsentDisplayName: string;
      adminConsentDescription: string;
    }>;
  }>;
}

export class MicrosoftWorkspaceService {
  private client: Client;
  private credential: ClientSecretCredential;

  constructor(credentials: any) {
    this.credential = new ClientSecretCredential(
      credentials.tenant_id,
      credentials.client_id,
      credentials.client_secret
    );

    const authProvider = new TokenCredentialAuthenticationProvider(this.credential, {
      scopes: ['https://graph.microsoft.com/.default']
    });

    this.client = Client.initWithMiddleware({
      authProvider: authProvider
    });
  }

  async setCredentials(tokens: any) {
    // For Microsoft, we'll use the access token directly with the client
    this.client = Client.init({
      authProvider: (done) => {
        done(null, tokens.access_token);
      }
    });
  }

  getCredentials() {
    return this.client;
  }

  async getToken(code: string) {
    // Exchange authorization code for tokens
    const tokenEndpoint = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';
    const params = new URLSearchParams({
      client_id: process.env.NEXT_PUBLIC_MICROSOFT_CLIENT_ID!,
      client_secret: process.env.MICROSOFT_CLIENT_SECRET!,
      code,
      grant_type: 'authorization_code',
      redirect_uri: process.env.NEXT_PUBLIC_MICROSOFT_REDIRECT_URI!,
    });

    const response = await fetch(tokenEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });

    if (!response.ok) {
      throw new Error('Failed to get tokens from Microsoft');
    }

    return response.json();
  }

  async getAuthenticatedUserInfo() {
    const response = await this.client.api('/me').get();
    return response;
  }

  async getUsersList() {
    const users = await this.client.api('/users')
      .select('id,displayName,mail,userPrincipalName,jobTitle,department,lastSignInDateTime')
      .get();
    return users.value;
  }

  async getOAuthTokens(): Promise<Token[]> {
    try {
      // Get all users in the organization
      const users = await this.getUsersList();
      console.log(`Found ${users.length} users in the organization`);
      
      const tokens: Token[] = [];
      const processedApps = new Set<string>(); // Track processed app-user combinations
      
      // Process users in larger batches for better performance
      const batchSize = 25; // Increased batch size
      const maxConcurrentBatches = 4; // Number of batches to process in parallel
      
      // Process batches in parallel
      for (let i = 0; i < users.length; i += batchSize * maxConcurrentBatches) {
        const batchPromises = [];
        
        // Create promises for each batch
        for (let j = 0; j < maxConcurrentBatches && i + j * batchSize < users.length; j++) {
          const start = i + j * batchSize;
          const end = Math.min(start + batchSize, users.length);
          const userBatch = users.slice(start, end);
          
          batchPromises.push(this.processUserBatch(userBatch, processedApps));
        }
        
        // Wait for all batches to complete
        const batchResults = await Promise.all(batchPromises);
        tokens.push(...batchResults.flat());
        
        // Small delay between major batch groups to avoid rate limits
        if (i + batchSize * maxConcurrentBatches < users.length) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
      
      return tokens;
    } catch (error) {
      console.error('Error fetching OAuth tokens:', error);
      throw error;
    }
  }

  private async processUserBatch(userBatch: MicrosoftGraphUser[], processedApps: Set<string>): Promise<Token[]> {
    const batchTokens: Token[] = [];
    
    // Process each user in the batch
    await Promise.all(userBatch.map(async (user: MicrosoftGraphUser) => {
      try {
        const userEmail = user.mail || user.userPrincipalName;
        
        if (!userEmail) {
          console.log(`Skipping user with ID ${user.id} - no email address or userPrincipalName found`);
          return;
        }
        
        // Get app role assignments and OAuth2 grants in parallel
        const [appRoleAssignments, oauth2Grants] = await Promise.all([
          this.client.api(`/users/${user.id}/appRoleAssignments`).get(),
          this.client.api(`/users/${user.id}/oauth2PermissionGrants`).get()
        ]);
        
        // Process app role assignments in parallel
        const appTokens = await Promise.all(
          appRoleAssignments.value.map(async (assignment: any) => {
            try {
              const appUserKey = `${assignment.resourceId}-${user.id}`;
              if (processedApps.has(appUserKey)) return null;
              processedApps.add(appUserKey);
              
              // Get service principal details
              const servicePrincipal = await this.client.api(`/servicePrincipals/${assignment.resourceId}`)
                .select('id,appId,displayName,appRoles,oauth2PermissionScopes')
                .get();
              
              if (!servicePrincipal) return null;
              
              // Get all permissions
              const assignedPermissions = new Set<string>();
              
              // Add app role permissions
              if (assignment.appRoleId) {
                const assignedRole = servicePrincipal.appRoles?.find(
                  (role: any) => role.id === assignment.appRoleId
                );
                if (assignedRole?.value) {
                  assignedPermissions.add(assignedRole.value);
                }
              }
              
              // Add delegated permissions
              const userGrants = oauth2Grants.value.filter(
                (grant: any) => grant.clientId === servicePrincipal.appId
              );
              
              userGrants.forEach((grant: any) => {
                if (grant.scope) {
                  grant.scope.split(' ').forEach((scope: string) => {
                    assignedPermissions.add(scope);
                  });
                }
              });
              
              return {
                clientId: servicePrincipal.appId,
                displayText: servicePrincipal.displayName,
                userKey: user.id,
                userEmail: userEmail,
                scopes: Array.from(assignedPermissions)
              };
            } catch (error) {
              console.error(`Error processing app assignment for user ${userEmail}:`, error);
              return null;
            }
          })
        );
        
        batchTokens.push(...appTokens.filter(Boolean));
      } catch (error) {
        console.error(`Error processing user ${user.id}:`, error);
      }
    }));
    
    return batchTokens;
  }
} 