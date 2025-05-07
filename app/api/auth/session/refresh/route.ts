import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { GoogleWorkspaceService } from '@/lib/google-workspace';
import { MicrosoftWorkspaceService } from '@/lib/microsoft-workspace';

export async function POST(request: NextRequest) {
  try {
    // Get the session ID from the cookie
    const sessionId = request.cookies.get('shadow_session_id')?.value;
    
    if (!sessionId) {
      return NextResponse.json({ 
        success: false,
        message: 'No session cookie found' 
      }, { status: 401 });
    }
    
    // Get the session from the database
    const { data: session, error } = await supabaseAdmin
      .from('user_sessions')
      .select('*')
      .eq('id', sessionId)
      .single();
    
    if (error || !session) {
      return NextResponse.json({ 
        success: false,
        message: 'Session not found' 
      }, { status: 404 });
    }
    
    // Attempt to refresh the token based on the provider
    let newTokens;
    
    try {
      if (session.auth_provider === 'google') {
        const googleService = new GoogleWorkspaceService({
          client_id: process.env.GOOGLE_CLIENT_ID,
          client_secret: process.env.GOOGLE_CLIENT_SECRET,
          redirect_uri: process.env.GOOGLE_REDIRECT_URI,
        });
        
        newTokens = await googleService.refreshToken(session.refresh_token);
      } else if (session.auth_provider === 'microsoft') {
        const msService = new MicrosoftWorkspaceService({
          clientId: process.env.MICROSOFT_CLIENT_ID,
          clientSecret: process.env.MICROSOFT_CLIENT_SECRET,
          tenantId: 'common', // Use common for multi-tenant
          redirectUri: process.env.MICROSOFT_REDIRECT_URI,
        });
        
        newTokens = await msService.refreshToken(session.refresh_token);
      } else {
        throw new Error(`Unsupported auth provider: ${session.auth_provider}`);
      }
    } catch (refreshError) {
      console.error('Error refreshing token:', refreshError);
      
      // If we can't refresh the token, the session is invalid
      // Delete the session and return an error
      await supabaseAdmin
        .from('user_sessions')
        .delete()
        .eq('id', sessionId);
      
      // Clear the session cookie
      const response = NextResponse.json({ 
        success: false,
        message: 'Failed to refresh tokens, session invalidated' 
      }, { status: 401 });
      
      response.cookies.delete('shadow_session_id');
      
      return response;
    }
    
    // Calculate new expiry time (typically 1 hour from now for access tokens)
    const expiresAt = new Date();
    expiresAt.setSeconds(expiresAt.getSeconds() + (newTokens.expires_in || 3600));
    
    // Update the session with new tokens
    await supabaseAdmin
      .from('user_sessions')
      .update({
        access_token: newTokens.access_token,
        id_token: newTokens.id_token || session.id_token,
        refresh_token: newTokens.refresh_token || session.refresh_token, // Some providers don't return a new refresh token
        expires_at: expiresAt.toISOString(),
        last_active_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('id', sessionId);
    
    return NextResponse.json({
      success: true,
      message: 'Session refreshed successfully'
    });
  } catch (error) {
    console.error('Error refreshing session:', error);
    return NextResponse.json({ 
      success: false,
      message: 'Error refreshing session' 
    }, { status: 500 });
  }
} 