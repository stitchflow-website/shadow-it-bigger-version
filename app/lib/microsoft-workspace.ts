import { Client } from '@microsoft/microsoft-graph-client';
import { TokenCredentialAuthenticationProvider } from '@microsoft/microsoft-graph-client/authProviders/azureTokenCredentials';

interface OAuthGrant {
  clientId: string;
  principalId: string;
  scope?: string;
}

interface AppRoleAssignment {
  resourceId: string;
  principalId: string;
  appRoleId: string;
}

export class MicrosoftWorkspaceService {
  private client: Client = Client.init({
    authProvider: (done) => {
      done(null, ''); // Will be updated when credentials are set
    },
  });
  private credentials: {
    access_token: string;
    refresh_token: string;
  };

  constructor(config: { client_id: string; client_secret: string; tenant_id: string }) {
    this.credentials = { access_token: '', refresh_token: '' };
  }

  async setCredentials(credentials: { access_token: string; refresh_token: string }) {
    this.credentials = credentials;
    
    // Initialize Microsoft Graph client
    this.client = Client.init({
      authProvider: (done) => {
        done(null, this.credentials.access_token);
      },
    });
  }

  async getUsersList() {
    try {
      const response = await this.client
        .api('/users')
        .select('id,displayName,mail,userPrincipalName,jobTitle,department')
        .get();
      return response.value;
    } catch (error) {
      console.error('Error fetching users:', error);
      throw error;
    }
  }

  async getOAuthTokens() {
    try {
      // Get all service principals (applications)
      const servicePrincipals = await this.client
        .api('/servicePrincipals')
        .select('id,appId,displayName,appRoles,oauth2PermissionScopes')
        .get();

      // Get all OAuth permission grants
      const oauthGrants = await this.client
        .api('/oauth2PermissionGrants')
        .get();

      // Get all app role assignments
      const appRoleAssignments = await this.client
        .api('/users/$/appRoleAssignments')
        .get();

      // Process and combine the data
      const tokens = [];
      for (const sp of servicePrincipals.value) {
        // Get delegated permissions (OAuth grants) for this app
        const appGrants = oauthGrants.value.filter((grant: OAuthGrant) => grant.clientId === sp.id);
        
        // Get application permissions (app roles) for this app
        const appRoles = appRoleAssignments.value.filter((role: AppRoleAssignment) => role.resourceId === sp.id);

        // For each user that has permissions to this app
        for (const grant of appGrants) {
          const userEmail = grant.principalId; // This is the user's object ID
          
          // Get user's delegated permissions
          const delegatedScopes = grant.scope ? grant.scope.split(' ') : [];
          
          // Get user's application permissions
          const applicationScopes = appRoles
            .filter((role: AppRoleAssignment) => role.principalId === userEmail)
            .map((role: AppRoleAssignment) => role.appRoleId);

          // Combine all scopes
          const allScopes = [...delegatedScopes, ...applicationScopes];

          tokens.push({
            clientId: sp.appId,
            displayText: sp.displayName,
            userEmail,
            scopes: allScopes,
          });
        }
      }

      return tokens;
    } catch (error) {
      console.error('Error fetching OAuth tokens:', error);
      throw error;
    }
  }
} 