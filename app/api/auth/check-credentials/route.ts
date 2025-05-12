import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { GoogleWorkspaceService } from '@/lib/google-workspace';
import crypto from 'crypto';

/**
 * API endpoint that checks if we already have stored credentials for a given user.
 * If we do, it returns the credentials; otherwise it returns a URL to redirect to.
 */
export async function POST(request: Request) {
  try {
    const { email, provider = 'google' } = await request.json();
    
    if (!email) {
      return NextResponse.json({
        needOauthUrl: true,
        error: 'email_required',
        message: 'Email is required to check credentials'
      }, { status: 400 });
    }
    
    // Check if we have stored credentials for this user
    const { data, error } = await supabaseAdmin
      .from('user_credentials')
      .select('*')
      .eq('email', email)
      .single();
    
    if (error || !data || !data.refresh_token) {
      console.log(`No stored credentials found for ${email}. Generating OAuth URL.`);
      
      // Generate a state parameter for CSRF protection
      const state = crypto.randomUUID();
      
      // Generate OAuth URL based on provider
      let oauthUrl = '';
      
      if (provider === 'google') {
        const googleService = new GoogleWorkspaceService({
          client_id: process.env.GOOGLE_CLIENT_ID,
          client_secret: process.env.GOOGLE_CLIENT_SECRET,
          redirect_uri: process.env.GOOGLE_REDIRECT_URI,
        });
        
        // First try with prompt=none for silent auth
        oauthUrl = googleService.generateAuthUrl({
          access_type: 'offline',
          include_granted_scopes: true,
          prompt: 'select_account', // Use select_account to minimize UI if user is already signed in
          login_hint: email, // Pre-select the user account if possible
          state
        });
      } else if (provider === 'microsoft') {
        // Microsoft implementation would go here
        oauthUrl = ''; // TODO: Implement Microsoft OAuth URL generation
      }
      
      return NextResponse.json({
        needOauthUrl: true,
        oauthUrl,
        state
      });
    }
    
    // If we have credentials, try to use them to get a new access token
    if (provider === 'google') {
      try {
        const googleService = new GoogleWorkspaceService({
          client_id: process.env.GOOGLE_CLIENT_ID,
          client_secret: process.env.GOOGLE_CLIENT_SECRET,
          redirect_uri: process.env.GOOGLE_REDIRECT_URI,
        });
        
        // Try to refresh the token
        const result = await googleService.refreshToken(data.refresh_token);
        
        if (result && result.access_token) {
          console.log(`Successfully refreshed token for ${email}`);
          
          // Get user information using the access token
          await googleService.setCredentials({
            access_token: result.access_token,
            refresh_token: data.refresh_token
          });
          
          const userInfo = await googleService.getAuthenticatedUserInfo();
          
          // Return success response with user info and new access token
          return NextResponse.json({
            needOauthUrl: false,
            userInfo,
            accessToken: result.access_token,
            expiresAt: result.expiry_date
          });
        }
      } catch (refreshError) {
        console.error('Error refreshing token:', refreshError);
        
        // Token refresh failed, mark the token as invalid
        await supabaseAdmin
          .from('user_credentials')
          .update({ is_valid: false, updated_at: new Date().toISOString() })
          .eq('email', email);
        
        // Generate a new auth URL with consent to get a new refresh token
        const googleService = new GoogleWorkspaceService({
          client_id: process.env.GOOGLE_CLIENT_ID,
          client_secret: process.env.GOOGLE_CLIENT_SECRET,
          redirect_uri: process.env.GOOGLE_REDIRECT_URI,
        });
        
        const state = crypto.randomUUID();
        const oauthUrl = googleService.generateAuthUrl({
          access_type: 'offline',
          include_granted_scopes: true,
          prompt: 'consent', // Force consent to get a new refresh token
          login_hint: email,
          state
        });
        
        return NextResponse.json({
          needOauthUrl: true,
          oauthUrl,
          state,
          error: 'refresh_failed',
          message: 'Failed to refresh token, new authorization required'
        });
      }
    }
    
    // Fallback response if something unexpected happens
    return NextResponse.json({
      needOauthUrl: true,
      error: 'provider_not_supported',
      message: `Provider ${provider} is not supported for credential checking`
    });
    
  } catch (error) {
    console.error('Error in check-credentials API:', error);
    return NextResponse.json({
      needOauthUrl: true,
      error: 'internal_server_error',
      message: 'Failed to check credentials'
    }, { status: 500 });
  }
} 