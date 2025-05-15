import { Client } from '@microsoft/microsoft-graph-client';
import { TokenCredentialAuthenticationProvider } from '@microsoft/microsoft-graph-client/authProviders/azureTokenCredentials';
import { ClientSecretCredential } from '@azure/identity';
import { supabaseAdmin } from '@/lib/supabase';

// Define interfaces for Microsoft API responses
interface Token {
  clientId: string;
  displayText?: string;
  scopes?: string[];
  userKey: string;
  userEmail?: string;
  lastTimeUsed?: string;
  assignedDate?: string;    // When the user was assigned to the application
  lastSignInDateTime?: string; // When the user last signed in
  assignmentType?: string;  // Direct or inherited assignment
  // Fields for risk assessment
  adminScopes?: string[];   // Admin-consented permissions
  userScopes?: string[];    // User-consented permissions
  appRoleScopes?: string[]; // App role permissions
  permissionCount?: number; // Total number of unique permissions
  highRiskPermissions?: string[]; // Permissions that are considered high risk
  mediumRiskPermissions?: string[]; // Permissions that are considered medium risk
  [key: string]: any;
}

interface MicrosoftGraphUser {
  id: string;
  mail: string;
  displayName: string;
  userPrincipalName?: string;
  lastSignInDateTime?: string;
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

interface OAuth2Grant {
  principalId: string;
  clientId: string;
  resourceId: string;
  scope?: string;
  startTime?: string;
  createdTime?: string;
}

export class MicrosoftWorkspaceService {
  private client: Client;
  private credential: ClientSecretCredential;
  private clientId: string;
  private clientSecret: string;
  private tenantId: string;
  private currentTokens: any = null;

  constructor(credentials: any) {
    this.clientId = credentials.clientId;
    this.clientSecret = credentials.clientSecret;
    this.tenantId = credentials.tenantId;
    
    // Default to 'common' if no tenant ID is provided or it's empty/undefined
    if (!this.tenantId) {
      console.warn('No tenant ID provided, defaulting to "organizations"');
      this.tenantId = 'organizations';
    }
    
    // Log tenant ID for debugging
    console.log(`Creating Microsoft client with tenant ID: "${this.tenantId}"`);
    
    this.credential = new ClientSecretCredential(
      this.tenantId,
      this.clientId,
      this.clientSecret
    );

    const authProvider = new TokenCredentialAuthenticationProvider(this.credential, {
      scopes: ['https://graph.microsoft.com/.default']
    });

    this.client = Client.initWithMiddleware({
      authProvider: authProvider
    });
  }

  async setCredentials(tokens: any) {
    // Store the tokens
    this.currentTokens = tokens;
    
    // For Microsoft, we'll use the access token directly with the client
    this.client = Client.init({
      authProvider: (done) => {
        done(null, tokens.access_token);
      }
    });
  }

  getCredentials() {
    return this.currentTokens;
  }

  /**
   * Refreshes a token using a refresh token
   * @param refreshToken The refresh token to use
   * @returns Object with the new tokens
   */
  async refreshToken(refreshToken: string) {
    try {
      console.log('Refreshing Microsoft token with refresh token');
      
      // Prepare the token endpoint request
      const tokenEndpoint = `https://login.microsoftonline.com/common/oauth2/v2.0/token`;
      const params = new URLSearchParams({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
        scope: 'https://graph.microsoft.com/.default offline_access'
      });

      // Make the refresh token request
      const response = await fetch(tokenEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params.toString(),
      });

      if (!response.ok) {
        const errorData = await response.text();
        console.error('Failed to refresh Microsoft token:', errorData);
        throw new Error(`Failed to refresh token: ${response.status} ${response.statusText} - ${errorData}`);
      }

      // Parse the new tokens
      const newTokens = await response.json();
      
      // Return the token response with properly named fields
      return {
        access_token: newTokens.access_token,
        refresh_token: newTokens.refresh_token || refreshToken, // Keep original if not returned
        id_token: newTokens.id_token,
        expires_in: newTokens.expires_in || 3600 // Default to 1 hour
      };
    } catch (error) {
      console.error('Error refreshing Microsoft token:', error);
      throw error;
    }
  }

  /**
   * Refreshes the access token using the refresh token
   * @param force If true, forces a token refresh regardless of expiry status
   * @returns Object with the new tokens or null if refresh wasn't needed/possible
   */
  async refreshAccessToken(force = false) {
    try {
      // Check if we have a refresh token
      if (!this.currentTokens || !this.currentTokens.refresh_token) {
        console.error('No refresh token available for Microsoft, cannot refresh');
        throw new Error('Missing Microsoft refresh token - unable to refresh access token');
      }

      // Check if token is expired or we're forcing a refresh
      const now = Date.now();
      const isExpired = !this.currentTokens.expires_at || now >= this.currentTokens.expires_at;
      
      if (!force && !isExpired) {
        console.log('Microsoft access token still valid, no refresh needed');
        return null;
      }

      if (force) {
        console.log('Forcing Microsoft token refresh as requested');
      } else {
        console.log('Microsoft access token expired, refreshing...');
      }
      
      try {
        // Prepare the token endpoint request
        const tokenEndpoint = `https://login.microsoftonline.com/${this.tenantId}/oauth2/v2.0/token`;
        const params = new URLSearchParams({
          client_id: this.clientId,
          client_secret: this.clientSecret,
          refresh_token: this.currentTokens.refresh_token,
          grant_type: 'refresh_token',
          scope: 'https://graph.microsoft.com/.default offline_access'
        });

        // Make the refresh token request
        const response = await fetch(tokenEndpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: params.toString(),
        });

        if (!response.ok) {
          const errorData = await response.text();
          console.error('Failed to refresh Microsoft token:', errorData);
          throw new Error(`Failed to refresh token: ${response.status} ${response.statusText} - ${errorData}`);
        }

        // Parse the new tokens
        const newTokens = await response.json();
        
        // Merge with existing tokens, ensuring we keep the refresh token if not returned
        const updatedTokens = {
          ...this.currentTokens,
          access_token: newTokens.access_token,
          id_token: newTokens.id_token || this.currentTokens.id_token,
          refresh_token: newTokens.refresh_token || this.currentTokens.refresh_token,
          expires_at: Date.now() + (newTokens.expires_in * 1000)
        };
        
        // Update the client with the new tokens
        await this.setCredentials(updatedTokens);
        
        console.log('Successfully refreshed Microsoft access token');
        return updatedTokens;
      } catch (refreshError) {
        console.error('Detailed Microsoft token refresh error:', refreshError);
        
        // Add more context to the error
        if (refreshError instanceof Error) {
          // Check for common OAuth errors and provide better messages
          if (refreshError.message.includes('invalid_grant')) {
            throw new Error(`Invalid Microsoft refresh token. OAuth grant has expired or been revoked: ${refreshError.message}`);
          } else if (refreshError.message.includes('AADSTS')) {
            throw new Error(`Microsoft token refresh error: ${refreshError.message}`);
          } else {
            throw new Error(`Microsoft token refresh failed: ${refreshError.message}`);
          }
        }
        
        throw refreshError; // Re-throw any other errors
      }
    } catch (error) {
      console.error('Error in Microsoft refreshAccessToken:', error);
      throw error;
    }
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
    console.log(users.value);
    return users.value;
  }

  /**
   * Helper method to fetch all pages from a Microsoft Graph API endpoint
   */
  private async getAllPages<T>(endpoint: string, select?: string): Promise<T[]> {
    let url = endpoint;
    if (select) {
      url = `${url}?$select=${select}`;
    }
    
    const results: T[] = [];
    let response;
    
    do {
      response = await this.client.api(url).get();
      
      if (response.value && Array.isArray(response.value)) {
        results.push(...response.value);
      }
      
      // Get the next page URL if available
      url = response['@odata.nextLink'];
    } while (url);
    
    return results;
  }

  async getOAuthTokens(): Promise<Token[]> {
    try {
      console.log('🔄 Starting OAuth token fetch from Microsoft Entra ID...');
      
      // 1. Get all users in the organization with pagination
      console.log('👥 Fetching all users in the organization...');
      const users = await this.getAllPages<MicrosoftGraphUser>(
        '/users', 
        'id,displayName,mail,userPrincipalName,jobTitle,department,lastSignInDateTime'
      );
      console.log(`✅ Found ${users.length} users in the organization`);

      // 2. Get all service principals (applications) with pagination
      console.log('🔍 Fetching all service principals (applications)...');
      const servicePrincipals = await this.getAllPages<any>(
        '/servicePrincipals',
        'id,appId,displayName,appRoles,oauth2PermissionScopes,servicePrincipalType'
      );
      
      console.log(`✅ Found ${servicePrincipals.length} service principals`);

      // Filter out system applications that shouldn't be included
      // These are typically infrastructure apps that aren't relevant for Shadow IT discovery
      const systemAppPrefixes: string[] = [
        "Microsoft.",
        "Office 365",
        "SharePoint Online Web Client",
        "Microsoft Office"
      ];
      
      const systemAppIds: string[] = [
        // Add specific app IDs for system applications if known
      ];
      
      const filteredServicePrincipals = servicePrincipals.filter(sp => {
        // Filter out by display name prefix
        const isSystemApp = systemAppPrefixes.some(prefix => 
          sp.displayName && sp.displayName.startsWith(prefix)
        );
        
        // Filter out by specific app ID
        const isBlockedAppId = systemAppIds.includes(sp.appId);
        
        // Keep the app if it's not a system app and not a blocked app ID
        return !isSystemApp && !isBlockedAppId;
      });
      
      console.log(`✅ After filtering system apps, using ${filteredServicePrincipals.length} relevant applications`);

      // Create maps for quick lookups
      const appIdToNameMap = new Map<string, string>();
      const appIdToServicePrincipalIdMap = new Map<string, string>();
      const spIdToAppIdMap = new Map<string, string>();
      filteredServicePrincipals.forEach((sp: any) => {
        appIdToNameMap.set(sp.appId, sp.displayName);
        appIdToServicePrincipalIdMap.set(sp.appId, sp.id);
        spIdToAppIdMap.set(sp.id, sp.appId); // Add mapping from SP ID to App ID
      });

      // Get all OAuth2PermissionGrants - both user and admin consents
      console.log("🔐 Fetching all OAuth2 permission grants...");
      let allOAuth2Grants: any[] = [];
      try {
        const allGrantsResponse = await this.client.api('/oauth2PermissionGrants').filter('consentType eq \'AllPrincipals\'').get();
        if (allGrantsResponse && allGrantsResponse.value) {
          allOAuth2Grants = allGrantsResponse.value;
        }
        console.log(`✅ Found ${allOAuth2Grants.length} total OAuth2 permission grants`);
        
        if (allOAuth2Grants.length > 0) {
          console.log("📝 Sample OAuth2 grant structure:", JSON.stringify(allOAuth2Grants[0], null, 2));
        }
      } catch (error) {
        console.warn("⚠️ Could not fetch all OAuth2 grants:", error);
        allOAuth2Grants = [];
      }

      // Create a map of service principals (by ID) to their admin-consented scopes
      // Admin consent has principalId = null or consentType = 'AllPrincipals'
      const adminConsentedScopesMap = new Map<string, string[]>();
      
      // Create a separate map for Microsoft Graph scopes - DO NOT apply these to all apps
      const microsoftGraphId = '1cb195da-78a4-4ccd-bed9-8ac47e57acbe';
      
      // Create a map to store which clientId (app) is requesting access to which resourceId (API)
      const clientToResourceMap = new Map<string, string>();
            
      console.log("📊 Admin-consented scopes map:", Object.fromEntries(adminConsentedScopesMap));

      const tokens: Token[] = [];
      
      // Process each user
      console.log('🔄 Processing user application permissions...');
      let processedUserCount = 0;
      
      for (const user of users) {
        processedUserCount++;
        const userEmail = user.mail || user.userPrincipalName;
        
        if (!userEmail) {
          console.log(`⚠️ Skipping user with ID ${user.id} - no email address found`);
          continue;
        }

        console.log(`👤 Processing user ${processedUserCount}/${users.length}: ${userEmail}`);

        // 4. Get appRoleAssignments for each user (applications assigned to users)
        console.log(`  📋 Fetching app role assignments for ${userEmail}...`);
        const appRoleResponse = await this.client.api(`/users/${user.id}/appRoleAssignments`)
          .get();

        const appRolesCount = appRoleResponse?.value?.length || 0;
        console.log(`  ✅ Found ${appRolesCount} app role assignments`);

        // 5. Get OAuth2PermissionGrants for each user (delegated permissions)
        let userOAuth2Grants: any[] = [];
        try {
          // Get delegated permission grants for this user
          console.log(`  🔑 Fetching OAuth permission grants for ${userEmail}...`);
          
          // First, get user-specific permission grants
          const userOauthResponse = await this.client.api('/oauth2PermissionGrants')
            .filter(`principalId eq '${user.id}'`)
            .get();
          
          let userSpecificGrants = userOauthResponse?.value || [];
          console.log(`  ✅ Found ${userSpecificGrants.length} user-specific permission grants`);
          
          // Next, get admin consent permission grants (AllPrincipals) that apply to all users
          const adminOauthResponse = await this.client.api('/oauth2PermissionGrants')
            .filter(`consentType eq 'AllPrincipals'`)
            .get();
          
          let adminGrants = adminOauthResponse?.value || [];
          console.log(`  ✅ Found ${adminGrants.length} admin consent permission grants that apply to this user`);
          
          // Combine both types of grants
          userOAuth2Grants = [...userSpecificGrants, ...adminGrants];
          
          console.log(`  📊 Total permission grants to process: ${userOAuth2Grants.length}`);
        } catch (error) {
          console.warn(`  ⚠️ Could not fetch OAuth2 grants for user ${userEmail}:`, error);
          userOAuth2Grants = [];
        }

        // Create a map of resource IDs to their scopes from OAuth grants
        const resourceToScopesMap = new Map<string, string[]>();
        userOAuth2Grants.forEach(grant => {
          if (grant.scope) {
            const scopes = grant.scope.split(' ').filter((s: string) => s.trim() !== '');
            if (grant.resourceId) {
              resourceToScopesMap.set(grant.resourceId, scopes);
            }
          }
        });

        // Process app role assignments for this user
        const processedApps = new Set<string>(); // Track processed app IDs for this user

        if (appRoleResponse && appRoleResponse.value) {
          for (const assignment of appRoleResponse.value) {
            // Get the service principal for this app
            const resourceId = assignment.resourceId;
            const servicePrincipal = filteredServicePrincipals.find((sp: any) => sp.id === resourceId);
            
            if (!servicePrincipal) {
              console.log(`  ⚠️ Could not find service principal for resource ID ${resourceId}`);
              continue;
            }
            
            const appId = servicePrincipal.appId;
            if (processedApps.has(appId)) continue;
            processedApps.add(appId);
            
            console.log(`  🔹 Processing app: ${servicePrincipal.displayName} (${appId})`);
            
            // Find the assigned role from the service principal's appRoles
            const assignedPermissions = new Set<string>();
            
            // Add role-based permissions
            const assignedRole = servicePrincipal.appRoles?.find(
              (role: any) => role.id === assignment.appRoleId
            );
            
            if (assignedRole?.value) {
              assignedPermissions.add(assignedRole.value);
              console.log(`    📌 App role permission: ${assignedRole.value}`);
            }
            
            // Look for any delegated permissions for this app
            // First, find all relevant OAuth grants for this app
            // We need to check two cases:
            // 1. Grants where this app is the client (clientId === resourceId)
            // 2. Grants that specifically apply to this user
            
            let delegatedScopes: string[] = [];
            let adminScopes: string[] = [];
            
            // Process all grants related to this app
            for (const grant of userOAuth2Grants) {
              if (!grant.scope) continue;
              
              const scopes = grant.scope.split(' ').filter((s: string) => s.trim() !== '');
              if (scopes.length === 0) continue;
              
              const isForThisApp = grant.clientId === resourceId || grant.resourceId === resourceId;
              const isAdminConsent = grant.consentType === 'AllPrincipals';
              const isForThisUser = grant.principalId === user.id || isAdminConsent;
              
              // Skip if this grant doesn't apply to this app or user
              if (!isForThisApp || !isForThisUser) continue;
              
              if (isAdminConsent) {
                // Combine with existing admin scopes to avoid duplicates
                adminScopes = [...new Set([...adminScopes, ...scopes])];
                console.log(`    🛡️ Admin consent permissions: ${scopes.join(', ')}`);
              } else {
                // Combine with existing user scopes to avoid duplicates
                delegatedScopes = [...new Set([...delegatedScopes, ...scopes])];
                console.log(`    🔑 User consent permissions: ${scopes.join(', ')}`);
              }
            }
            
            // Add all scopes to the permissions set
            [...delegatedScopes, ...adminScopes].forEach(scope => {
              assignedPermissions.add(scope);
            });
            
            const allPermissions = Array.from(assignedPermissions);
            console.log(`    📊 Total distinct permissions: ${allPermissions.length}`);
            
            // Classify permissions by risk level
            const highRiskPermissions = allPermissions.filter(p => classifyPermissionRisk(p) === 'high');
            const mediumRiskPermissions = allPermissions.filter(p => classifyPermissionRisk(p) === 'medium');
            
            if (highRiskPermissions.length > 0) {
              console.log(`    ⚠️ High risk permissions: ${highRiskPermissions.join(', ')}`);
            }
            
            tokens.push({
              clientId: appId,
              displayText: servicePrincipal.displayName,
              userKey: user.id,
              userEmail: userEmail,
              scopes: allPermissions,
              // Store individual permission types for risk assessment
              adminScopes: adminScopes,
              userScopes: delegatedScopes,
              appRoleScopes: assignedRole?.value ? [assignedRole.value] : [],
              permissionCount: allPermissions.length,
              highRiskPermissions: highRiskPermissions,
              mediumRiskPermissions: mediumRiskPermissions,
              lastTimeUsed: assignment.createdDateTime || new Date().toISOString(),
              assignedDate: assignment.createdDateTime || new Date().toISOString(),
              assignmentType: 'AppRole',
              lastSignInDateTime: user.lastSignInDateTime || undefined
            });
          }
        }
        
        // Process OAuth2 permission grants that weren't covered by app role assignments
        for (const grant of userOAuth2Grants) {
          // Try to get servicePrincipal by clientId first, then by resourceId
          const clientId = grant.clientId;
          
          // Skip if we already processed this app for this user
          if (processedApps.has(clientId)) continue;
          
          // If this is a clientId we found in a service principal, use it
          const servicePrincipal = filteredServicePrincipals.find((sp: any) => sp.id === clientId || sp.appId === clientId);
          if (!servicePrincipal) {
            console.log(`  ⚠️ Could not find service principal for client ID ${clientId}`);
            continue;
          }
          
          // Add this app to processed list
          const appId = servicePrincipal.appId;
          processedApps.add(appId);
          
          console.log(`  🔹 Processing OAuth app: ${servicePrincipal.displayName} (${appId})`);
          
          // Get user-consented scopes
          const userScopes = grant.scope && !grant.consentType ? grant.scope.split(' ').filter((s: string) => s.trim() !== '') : [];
          if (userScopes.length > 0) {
            console.log(`    🔑 User consent permissions: ${userScopes.join(', ')}`);
          }
          
          // Get admin-consented scopes ONLY for this application and only apply to this user 
          // if they actually have access to this app either directly or via an admin consent
          const isAdminConsent = grant.consentType === 'AllPrincipals';
          const isForThisUser = grant.principalId === user.id || isAdminConsent;
          
          // Skip if this grant doesn't apply to this user
          if (!isForThisUser) continue;
          
          // Only use admin consents when they apply to this specific app
          let adminScopes: string[] = [];
          if (isAdminConsent && grant.scope) {
            adminScopes = grant.scope.split(' ').filter((s: string) => s.trim() !== '');
            if (adminScopes.length > 0) {
              console.log(`    🛡️ Admin consent permissions: ${adminScopes.join(', ')}`);
            }
          }
          
          // Combine user and admin scopes
          const allScopes = [...new Set([...userScopes, ...adminScopes])];
          
          // Skip if there are no scopes
          if (allScopes.length === 0) {
            console.log(`    ⚠️ No permissions found for this app and user`);
            continue;
          }
          
          console.log(`    📊 Total distinct permissions: ${allScopes.length}`);
          
          // Classify permissions by risk level
          const highRiskPermissions = allScopes.filter(p => classifyPermissionRisk(p) === 'high');
          const mediumRiskPermissions = allScopes.filter(p => classifyPermissionRisk(p) === 'medium');
          
          if (highRiskPermissions.length > 0) {
            console.log(`    ⚠️ High risk permissions: ${highRiskPermissions.join(', ')}`);
          }
          
          tokens.push({
            clientId: appId,
            displayText: servicePrincipal.displayName || appIdToNameMap.get(appId) || appId,
            userKey: user.id,
            userEmail: userEmail,
            scopes: allScopes,
            // Store individual permission types for risk assessment
            adminScopes: adminScopes,
            userScopes: userScopes,
            appRoleScopes: [],
            permissionCount: allScopes.length,
            highRiskPermissions: highRiskPermissions,
            mediumRiskPermissions: mediumRiskPermissions,
            lastTimeUsed: grant.startTime || grant.createdTime || new Date().toISOString(),
            assignedDate: grant.startTime || grant.createdTime || new Date().toISOString(),
            assignmentType: 'DelegatedPermission',
            lastSignInDateTime: user.lastSignInDateTime || undefined
          });
        }
      }

      console.log(`🎉 Successfully processed ${tokens.length} application tokens across ${processedUserCount} users`);
      
      // Log a sample token for debugging
      if (tokens.length > 0) {
        console.log('📝 Sample token structure:');
        console.log(JSON.stringify({
          clientId: tokens[0].clientId,
          displayText: tokens[0].displayText,
          userEmail: tokens[0].userEmail,
          scopes: tokens[0].scopes,
          adminScopes: tokens[0].adminScopes,
          userScopes: tokens[0].userScopes, 
          assignmentType: tokens[0].assignmentType
        }, null, 2));
      }
      
      return tokens;

    } catch (error) {
      console.error('❌ Error fetching OAuth tokens:', error);
      throw error;
    }
  }

  // Helper function to create user-application relationship with scopes
  async createUserAppRelationship(appId: string, token: any, organizationId: string) {
    try {
      // Get user by email or Microsoft user ID
      let { data: userData, error: userError } = await supabaseAdmin
        .from('users')
        .select('id')
        .eq('organization_id', organizationId)
        .or(`email.eq.${token.userEmail},microsoft_user_id.eq.${token.userKey}`)
        .single();

      if (userError) {
        console.error('❌ Error finding user:', userError);
        return;
      }

      if (!userData) {
        console.log(`⚠️ No user found for email: ${token.userEmail}. Creating new user record.`);
        
        // Create user if they don't exist
        const { data: newUser, error: createError } = await supabaseAdmin
          .from('users')
          .insert({
            organization_id: organizationId,
            microsoft_user_id: token.userKey,
            email: token.userEmail,
            name: token.userEmail.split('@')[0],
            role: 'User',
            updated_at: new Date().toISOString()
          })
          .select('id')
          .single();

        if (createError) {
          console.error('❌ Error creating user:', createError);
          return;
        }
        
        userData = newUser;
      }

      // First, check if there's an existing relationship we need to update
      const { data: existingRelationship, error: relationshipError } = await supabaseAdmin
        .from('user_applications')
        .select('id, scopes')
        .eq('user_id', userData.id)
        .eq('application_id', appId)
        .single();

      // Store the user-application relationship with permissions (scopes)
      console.log(`📝 Storing permissions for user ${token.userEmail} and app ${token.displayText || appId}`);
      console.log(`   Scopes: ${token.scopes ? JSON.stringify(token.scopes) : 'None'}`);
      
      if (existingRelationship) {
        // If relationship exists, merge the scopes and update
        console.log(`   ℹ️ Existing relationship found, merging scopes`);
        const existingScopes = existingRelationship.scopes || [];
        const mergedScopes = [...new Set([...existingScopes, ...(token.scopes || [])])];
        
        const { error: updateError } = await supabaseAdmin
          .from('user_applications')
          .update({
            scopes: mergedScopes,
            updated_at: new Date().toISOString()
          })
          .eq('id', existingRelationship.id);

        if (updateError) {
          console.error('❌ Error updating user-application relationship:', updateError);
        } else {
          console.log(`✅ Successfully updated app-user relationship with ${mergedScopes.length} permissions`);
        }
      } else {
        console.log(`   ℹ️ Creating new user-application relationship`);
        // Create new relationship
        const { error: insertError } = await supabaseAdmin
          .from('user_applications')
          .upsert({
            user_id: userData.id,
            application_id: appId,
            scopes: token.scopes || [],
            updated_at: new Date().toISOString()
          }, {
            onConflict: 'user_id,application_id',
            ignoreDuplicates: true
          });

        if (insertError) {
          console.error('❌ Error creating user-application relationship:', insertError);
          console.error('   Details:', insertError.details);
          console.error('   Message:', insertError.message);
        } else {
          console.log(`✅ Successfully created app-user relationship with ${token.scopes?.length || 0} permissions`);
        }
      }
    } catch (error) {
      console.error('❌ Error in createUserAppRelationship:', error);
    }
  }
}

// Helper function to classify Microsoft Graph permissions by risk level
function classifyPermissionRisk(permission: string): 'high' | 'medium' | 'low' {
  // High risk permissions - full admin access or write permissions
  const highRiskPatterns = [
    'ReadWrite.All',
    'Write.All',
    '.ReadWrite',
    '.Write',
    'FullControl.All',
    'AccessAsUser.All',
    'Directory.ReadWrite',
    'Files.ReadWrite',
    'Mail.ReadWrite',
    'Mail.Send',
    'Group.ReadWrite',
    'User.ReadWrite',
    'Application.ReadWrite',
    'Sites.FullControl',
    'User.Export',
    'User.Invite',
    'User.ManageIdentities',
    'User.EnableDisableAccount',
    'DelegatedPermissionGrant.ReadWrite'
  ];

  // Medium risk permissions - read access to sensitive data
  const mediumRiskPatterns = [
    'Read.All',
    '.Read',
    'Directory.Read',
    'Files.Read',
    'User.Read.All',
    'Mail.Read',
    'AuditLog.Read',
    'Reports.Read',
    'Sites.Read'
  ];

  // Check for high risk first
  for (const pattern of highRiskPatterns) {
    if (permission.includes(pattern)) {
      return 'high';
    }
  }

  // Then check for medium risk
  for (const pattern of mediumRiskPatterns) {
    if (permission.includes(pattern)) {
      return 'medium';
    }
  }

  // Default to low risk
  return 'low';
}