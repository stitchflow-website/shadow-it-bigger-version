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
      
      const users = await this.getAllPages<MicrosoftGraphUser>(
        '/users', 
        'id,displayName,mail,userPrincipalName,jobTitle,department,lastSignInDateTime'
      );
      console.log(`✅ Found ${users.length} users in the organization`);

      const servicePrincipals = await this.getAllPages<any>(
        '/servicePrincipals',
        'id,appId,displayName,appRoles,oauth2PermissionScopes,servicePrincipalType'
      );
      console.log(`✅ Found ${servicePrincipals.length} service principals`);

      const systemAppPrefixes = ["Microsoft.", "Office 365", "SharePoint Online Web Client", "Microsoft Office"];
      const systemAppIds: string[] = [];
      const filteredServicePrincipals = servicePrincipals.filter(sp => {
        const isSystemApp = systemAppPrefixes.some(prefix => sp.displayName && sp.displayName.startsWith(prefix));
        const isBlockedAppId = systemAppIds.includes(sp.appId);
        return !isSystemApp && !isBlockedAppId;
      });
      console.log(`✅ After filtering system apps, using ${filteredServicePrincipals.length} relevant applications`);

      const spIdToAppIdMap = new Map<string, string>();
      const spAppIdToDisplayNameMap = new Map<string, string>();
      const spAppIdToServicePrincipalIdMap = new Map<string, string>(); // Added for easier lookup
      filteredServicePrincipals.forEach((sp: any) => {
        spIdToAppIdMap.set(sp.id, sp.appId);
        spAppIdToDisplayNameMap.set(sp.appId, sp.displayName);
        spAppIdToServicePrincipalIdMap.set(sp.appId, sp.id);
      });
      
      // Fetch ALL OAuth2 permission grants (both user-delegated and admin-consented for AllPrincipals)
      const allGrants = await this.getAllPages<OAuth2Grant & {consentType?: string} >('/oauth2PermissionGrants');
      console.log(`✅ Found ${allGrants.length} total OAuth2 permission grants of all types.`);

      // Map of App AppId to its admin-consented (AllPrincipals) scopes
      const appAdminConsents = new Map<string, Set<string>>();
      allGrants.filter(g => g.consentType === 'AllPrincipals').forEach(grant => {
        const appSp = filteredServicePrincipals.find(sp => sp.id === grant.clientId); // clientId of grant is the service principal of the app
        if (appSp && grant.scope) {
          if (!appAdminConsents.has(appSp.appId)) {
            appAdminConsents.set(appSp.appId, new Set<string>());
          }
          grant.scope.split(' ').filter(s => s.trim() !== '').forEach(s => appAdminConsents.get(appSp.appId)!.add(s));
        }
      });

      const finalTokens: Token[] = [];
      let processedUserCount = 0;

      for (const user of users) {
        processedUserCount++;
        const userEmail = user.mail || user.userPrincipalName;
        if (!userEmail) {
          console.log(`⚠️ Skipping user with ID ${user.id} - no email address found`);
          continue;
        }
        console.log(`👤 Processing user ${processedUserCount}/${users.length}: ${userEmail} (ID: ${user.id})`);

        const userAppAccessDetails = new Map<string, { userScopes: Set<string>, appRoleScopes: Set<string>, assignmentType: Set<string>, lastTimeUsed?: string, assignedDate?: string }>();

        // 1. Process user's direct OAuth grants (delegated permissions)
        const userSpecificGrants = allGrants.filter(grant => grant.principalId === user.id && grant.consentType !== 'AllPrincipals');
        console.log(`  🔑 Found ${userSpecificGrants.length} user-specific OAuth grants for ${userEmail}`);
        for (const grant of userSpecificGrants) {
          const resourceSp = filteredServicePrincipals.find(sp => sp.id === grant.resourceId); // resourceId is the API the app wants to access
          if (!resourceSp) continue; // Skip if the resource (API) is not in our filtered list

          const clientAppSp = filteredServicePrincipals.find(sp => sp.id === grant.clientId); // clientId is the app that was granted permission
          if (!clientAppSp) continue;

          const appId = clientAppSp.appId; // The App ID of the application the user granted consent to

          if (!userAppAccessDetails.has(appId)) {
            userAppAccessDetails.set(appId, { userScopes: new Set<string>(), appRoleScopes: new Set<string>(), assignmentType: new Set<string>() });
          }
          const access = userAppAccessDetails.get(appId)!;
          grant.scope?.split(' ').filter(s => s.trim() !== '').forEach(s => access.userScopes.add(s));
          access.assignmentType.add('DelegatedPermission');
          access.lastTimeUsed = grant.startTime || grant.createdTime || access.lastTimeUsed;
          access.assignedDate = grant.createdTime || grant.startTime || access.assignedDate;
        }

        // 2. Process user's app role assignments
        console.log(`  📋 Fetching app role assignments for ${userEmail}...`);
        const appRoleAssignments = await this.getAllPages<any>(`/users/${user.id}/appRoleAssignments`);
        console.log(`  ✅ Found ${appRoleAssignments.length} app role assignments for ${userEmail}`);
        for (const assignment of appRoleAssignments) {
          const resourceSp = filteredServicePrincipals.find(sp => sp.id === assignment.resourceId); // resourceId is the service principal of the app providing the role
          if (!resourceSp) continue;
          
          const appId = resourceSp.appId;

          if (!userAppAccessDetails.has(appId)) {
            userAppAccessDetails.set(appId, { userScopes: new Set<string>(), appRoleScopes: new Set<string>(), assignmentType: new Set<string>() });
          }
          const access = userAppAccessDetails.get(appId)!;
          
          const role = resourceSp.appRoles?.find((r: any) => r.id === assignment.appRoleId);
          if (role?.value) { // App roles can have 'value' which is like a scope string
            access.appRoleScopes.add(role.value);
          } else if (role?.displayName) { // Sometimes 'value' is null, use displayName as a fallback
             access.appRoleScopes.add(role.displayName);
          }
          access.assignmentType.add('AppRole');
          access.assignedDate = assignment.createdDateTime || access.assignedDate;
          // App role assignments don't typically have a "last used" time from this endpoint
        }
        
        // 3. Construct final tokens for this user
        for (const [appId, accessDetails] of userAppAccessDetails.entries()) {
          const appDisplayName = spAppIdToDisplayNameMap.get(appId) || 'Unknown App';
          const effectiveUserScopes = new Set([...accessDetails.userScopes, ...accessDetails.appRoleScopes]);
          const appOverallAdminScopes = Array.from(appAdminConsents.get(appId) || new Set<string>());
          
          const allPermissionsForUserInApp = Array.from(effectiveUserScopes);
          const highRiskPermissions = allPermissionsForUserInApp.filter(p => classifyPermissionRisk(p) === 'high');
          const mediumRiskPermissions = allPermissionsForUserInApp.filter(p => classifyPermissionRisk(p) === 'medium');

          console.log(`  🔹 Finalizing token for user ${userEmail} & app ${appDisplayName} (${appId})`);
          console.log(`    User-specific scopes (delegated + roles): ${allPermissionsForUserInApp.join(', ')}`);
          console.log(`    App's tenant-wide admin scopes: ${appOverallAdminScopes.join(', ')}`);

          finalTokens.push({
            clientId: appId,
            displayText: appDisplayName,
            userKey: user.id,
            userEmail: userEmail,
            scopes: allPermissionsForUserInApp, // User's actual scopes for this app
            adminScopes: appOverallAdminScopes, // App's tenant-wide admin-consented scopes
            userScopes: Array.from(accessDetails.userScopes),
            appRoleScopes: Array.from(accessDetails.appRoleScopes),
            permissionCount: allPermissionsForUserInApp.length,
            highRiskPermissions: highRiskPermissions,
            mediumRiskPermissions: mediumRiskPermissions,
            lastTimeUsed: accessDetails.lastTimeUsed || user.lastSignInDateTime || new Date().toISOString(),
            assignedDate: accessDetails.assignedDate || new Date().toISOString(),
            assignmentType: Array.from(accessDetails.assignmentType).join(', '),
            lastSignInDateTime: user.lastSignInDateTime || undefined,
          });
        }
      }

      console.log(`🎉 Successfully processed ${finalTokens.length} application tokens across ${processedUserCount} users`);
      if (finalTokens.length > 0) {
        console.log('📝 Sample final token structure:');
        const sample = finalTokens[0];
        console.log(JSON.stringify({
          clientId: sample.clientId,
          displayText: sample.displayText,
          userEmail: sample.userEmail,
          userSpecificScopes: sample.scopes, // Corrected field name for clarity
          appTenantAdminScopes: sample.adminScopes, // Corrected field name
          userDelegatedScopes: sample.userScopes,
          userAppRoleScopes: sample.appRoleScopes,
          assignmentType: sample.assignmentType,
          permissionCount: sample.permissionCount,
        }, null, 2));
      }
      return finalTokens;

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