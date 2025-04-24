import { Client } from '@microsoft/microsoft-graph-client';
import { TokenCredentialAuthenticationProvider } from '@microsoft/microsoft-graph-client/authProviders/azureTokenCredentials';

interface OAuthGrant {
  clientId: string;
  principalId: string;
  resourceId: string;
  scope?: string;
  consentType?: string;
}

interface AppRoleAssignment {
  resourceId: string;
  principalId: string;
  appRoleId: string;
}

interface ServicePrincipal {
  id: string;
  appId: string;
  displayName: string;
  appRoles?: Array<{
    id: string;
    value: string;
  }>;
  oauth2PermissionScopes?: Array<{
    id: string;
    value: string;
  }>;
}

interface MicrosoftUser {
  id: string;
  mail?: string;
  userPrincipalName: string;
  displayName: string;
}

interface Token {
  clientId: string;
  displayText: string;
  userKey: string;
  userEmail: string;
  scopes: string[];
  adminScopes: string[];
  userScopes: string[];
  appRoleScopes: string[];
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

  private async getAllPages<T>(endpoint: string): Promise<T[]> {
    const results: T[] = [];
    let url = endpoint;
    
    do {
      const response = await this.client.api(url).get();
      results.push(...response.value);
      url = response['@odata.nextLink'];
    } while (url);
    
    return results;
  }

  async getOAuthTokens(): Promise<Token[]> {
    try {
      console.log('🔄 Starting OAuth token fetch process...');

      // Get all users first
      console.log('👥 Fetching all users...');
      const users = await this.getAllPages<MicrosoftUser>('/users');
      const userMap = new Map(users.map(user => [user.id, user]));
      console.log(`✅ Found ${users.length} users`);

      // Get all service principals (applications)
      console.log('🔍 Fetching service principals...');
      const servicePrincipals = await this.getAllPages<ServicePrincipal>('/servicePrincipals');
      console.log(`✅ Found ${servicePrincipals.length} service principals`);

      // Create maps for quick lookups
      const spMap = new Map(servicePrincipals.map(sp => [sp.id, sp]));
      const appRoleMap = new Map();
      servicePrincipals.forEach(sp => {
        if (sp.appRoles) {
          sp.appRoles.forEach(role => {
            appRoleMap.set(role.id, role.value);
          });
        }
      });

      // Get all OAuth permission grants
      console.log('🔑 Fetching OAuth permission grants...');
      const oauthGrants = await this.getAllPages<OAuthGrant>('/oauth2PermissionGrants');
      console.log(`✅ Found ${oauthGrants.length} OAuth grants`);

      // Get all app role assignments for all users
      console.log('👤 Fetching app role assignments...');
      const appRoleAssignments = await this.getAllPages<AppRoleAssignment>('/users/$/appRoleAssignments');
      console.log(`✅ Found ${appRoleAssignments.length} app role assignments`);

      // Track processed combinations to avoid duplicates
      const processedCombos = new Set<string>();
      const tokens: Token[] = [];
      
      // Store admin consent scopes separately - we'll only apply them to users who interact with those apps
      const adminConsentsByAppId = new Map<string, string[]>();

      // First pass: gather all admin consents
      for (const grant of oauthGrants) {
        const sp = spMap.get(grant.clientId);
        if (!sp) continue;

        if (grant.consentType === 'AllPrincipals') {
          const scopes = grant.scope ? grant.scope.split(' ') : [];
          console.log(`🔒 Found admin consent for app ${sp.displayName || sp.appId} with ${scopes.length} scopes`);
          
          // Store admin consents by app ID
          if (!adminConsentsByAppId.has(sp.appId)) {
            adminConsentsByAppId.set(sp.appId, []);
          }
          
          const adminScopes = adminConsentsByAppId.get(sp.appId) || [];
          const combinedScopes = [...new Set([...adminScopes, ...scopes])];
          adminConsentsByAppId.set(sp.appId, combinedScopes);
        }
      }

      // Second pass: Process user-specific grants
      for (const grant of oauthGrants) {
        if (grant.consentType === 'AllPrincipals') continue; // Skip admin consents in this pass
        
        const sp = spMap.get(grant.clientId);
        if (!sp) continue;

        const user = userMap.get(grant.principalId);
        if (!user) continue;

        const comboKey = `${user.id}-${sp.appId}`;
        if (processedCombos.has(comboKey)) continue;

        const userScopes = grant.scope ? grant.scope.split(' ') : [];
        const adminScopes = adminConsentsByAppId.get(sp.appId) || [];

        processedCombos.add(comboKey);
        tokens.push({
          clientId: sp.appId,
          displayText: sp.displayName,
          userKey: user.id,
          userEmail: user.mail || user.userPrincipalName,
          scopes: [],
          adminScopes: adminScopes,
          userScopes: userScopes,
          appRoleScopes: []
        });
        
        console.log(`👤 Created token for user ${user.mail || user.userPrincipalName} and app ${sp.displayName}`);
      }

      // Third pass: Process app role assignments
      for (const assignment of appRoleAssignments) {
        const sp = spMap.get(assignment.resourceId);
        const user = userMap.get(assignment.principalId);
        if (!sp || !user) continue;

        const roleValue = appRoleMap.get(assignment.appRoleId);
        if (!roleValue) continue;

        const comboKey = `${user.id}-${sp.appId}`;
        const existingToken = tokens.find(t => t.clientId === sp.appId && t.userKey === user.id);

        if (existingToken) {
          // Add app role to existing token
          const updatedRoles = [...new Set([...existingToken.appRoleScopes, roleValue])];
          existingToken.appRoleScopes = updatedRoles;
          console.log(`➕ Added app role ${roleValue} to existing token for user ${user.mail || user.userPrincipalName}`);
        } else {
          // Create new token with this app role
          const adminScopes = adminConsentsByAppId.get(sp.appId) || [];
          
          processedCombos.add(comboKey);
          tokens.push({
            clientId: sp.appId,
            displayText: sp.displayName,
            userKey: user.id,
            userEmail: user.mail || user.userPrincipalName,
            scopes: [],
            adminScopes: adminScopes,
            userScopes: [],
            appRoleScopes: [roleValue]
          });
          
          console.log(`👤 Created new token with app role for user ${user.mail || user.userPrincipalName}`);
        }
      }

      // Final pass: Combine all scopes for each token
      for (const token of tokens) {
        token.scopes = [...new Set([
          ...(token.adminScopes || []),
          ...(token.userScopes || []),
          ...(token.appRoleScopes || [])
        ])];
      }

      console.log(`✅ Successfully processed ${tokens.length} tokens`);
      return tokens;
    } catch (error) {
      console.error('❌ Error fetching OAuth tokens:', error);
      throw error;
    }
  }
}