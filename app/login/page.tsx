'use client';

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useState, useEffect, Suspense } from "react";
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';

function LoginContent() {
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [loginProvider, setLoginProvider] = useState<'google' | 'microsoft' | null>(null);
  const searchParams = useSearchParams();

  useEffect(() => {
    const errorParam = searchParams.get('error');
    if (errorParam) {
      switch (errorParam) {
        case 'no_code':
          setError('No authorization code received');
          break;
        case 'auth_failed':
          setError('Authentication failed. Please try again.');
          break;
        case 'not_workspace_account':
          setError('Please sign in with a Google Workspace account. Personal Gmail accounts are not supported.');
          break;
        case 'not_work_account':
          setError('Please sign in with a Microsoft work or school account. Personal Microsoft accounts are not supported.');
          break;
        case 'admin_required':
          setError('Admin access is required to use this application. Please sign in with an admin account.');
          break;
        case 'config_missing':
          setError('Authentication configuration is missing. Please contact support.');
          break;
        default:
          setError('An error occurred during authentication');
      }
    }
  }, [searchParams]);

  const handleGoogleLogin = () => {
    try {
      setIsLoading(true);
      setLoginProvider('google');
      setError(null);

      const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
      let redirectUri = process.env.NEXT_PUBLIC_GOOGLE_REDIRECT_URI;

      if (!clientId || !redirectUri) {
        setError("Missing Google OAuth configuration");
        console.error('Missing env variables:', { clientId, redirectUri });
        return;
      }

      // If we're on localhost, modify the redirect URI to match the main site's domain
      if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
        const baseUrl = `${window.location.protocol}//${window.location.host}`;
        redirectUri = window.location.origin + '/tools/shadow-it-scan/api/auth/google';
      }
      
      const scopes = [
        // User and domain management - read-only access
        'https://www.googleapis.com/auth/admin.directory.user.readonly',
        'https://www.googleapis.com/auth/admin.directory.domain.readonly',
        // Token management - required for accessing OAuth tokens
        'https://www.googleapis.com/auth/admin.directory.user.security',
        // // OAuth token management
        // 'https://www.googleapis.com/auth/admin.directory.userschema',
        // 'https://www.googleapis.com/auth/admin.directory.user',
        // 'https://www.googleapis.com/auth/admin.directory.group.readonly',
        // Basic profile info
        'openid',
        'profile',
        'email'
      ].join(' ');

      console.log('Redirect URI:', redirectUri);
      const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      authUrl.searchParams.append('client_id', clientId);
      authUrl.searchParams.append('redirect_uri', redirectUri);
      authUrl.searchParams.append('response_type', 'code');
      authUrl.searchParams.append('scope', scopes);
      authUrl.searchParams.append('access_type', 'offline');
      authUrl.searchParams.append('prompt', 'consent');

      localStorage.setItem('auth_provider', 'google');

      window.location.href = authUrl.toString();
    } catch (err) {
      console.error('Login error:', err);
      setError('Failed to initialize login. Please try again.');
      setIsLoading(false);
      setLoginProvider(null);
    }
  };

  const handleMicrosoftLogin = () => {
    try {
      console.log('Starting Microsoft login flow...');
      setIsLoading(true);
      setLoginProvider('microsoft');
      setError(null);

      const clientId = process.env.NEXT_PUBLIC_MICROSOFT_CLIENT_ID;
      let redirectUri = process.env.NEXT_PUBLIC_MICROSOFT_REDIRECT_URI;

      console.log('Microsoft client ID:', clientId?.substring(0, 8) + '...');
      console.log('Microsoft redirect URI:', redirectUri);

      if (!clientId || !redirectUri) {
        setError("Missing Microsoft OAuth configuration");
        console.error('Missing env variables:', { 
          clientId: clientId ? 'present' : 'missing',
          redirectUri: redirectUri ? 'present' : 'missing'
        });
        setIsLoading(false);
        setLoginProvider(null);
        return;
      }

      // If we're on localhost, update the redirect URI
      if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
        // For development, use the localhost URL but with the path matching production
        redirectUri = window.location.origin + '/api/auth/microsoft';
        console.log('Updated redirect URI for localhost:', redirectUri);
      } else {
        // For production, always ensure we use the production domain with correct path
        redirectUri = 'https://www.stitchflow.com/tools/shadow-it-scan/api/auth/microsoft';
        console.log('Using production redirect URI:', redirectUri);
      }
      
      const scopes = [
        // Microsoft Graph API scopes
        'User.Read',
        'Directory.Read.All',
        'Application.Read.All',     // For reading application info
        'DelegatedPermissionGrant.ReadWrite.All', // For reading delegated permissions
        'AppRoleAssignment.ReadWrite.All',        // For reading application role assignments
        'offline_access', // For refresh tokens
        'openid',
        'profile',
        'email'
      ].join(' ');

      console.log('Microsoft scopes:', scopes);
      const authUrl = new URL('https://login.microsoftonline.com/common/oauth2/v2.0/authorize');
      authUrl.searchParams.append('client_id', clientId);
      authUrl.searchParams.append('redirect_uri', redirectUri);
      authUrl.searchParams.append('response_type', 'code');
      authUrl.searchParams.append('scope', scopes);
      authUrl.searchParams.append('response_mode', 'query');
      authUrl.searchParams.append('prompt', 'consent');

      console.log('Redirecting to Microsoft auth URL:', authUrl.toString());
      localStorage.setItem('auth_provider', 'microsoft');
      window.location.href = authUrl.toString();
    } catch (err) {
      console.error('Microsoft login error:', err);
      setError('Failed to initialize Microsoft login. Please try again.');
      setIsLoading(false);
      setLoginProvider(null);
    }
  };

  return (
    <div className="min-h-screen flex flex-col">
      <div className="flex-grow flex items-center justify-center">
        <Card className="w-[400px]">
          <CardHeader>
            <CardTitle>Welcome to Shadow IT Scanner</CardTitle>
            <CardDescription>
              Sign in with your organization account to manage your applications.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {error && (
              <div className="mb-4 p-4 text-sm text-red-800 bg-red-100 rounded-lg">
                {error}
              </div>
            )}
            <div className="flex flex-col space-y-4">
              <Button 
                onClick={handleGoogleLogin}
                className="w-full flex items-center justify-center gap-2 bg-white text-gray-700 border border-gray-300 hover:bg-gray-50"
                size="lg"
                disabled={isLoading}
              >
                <img src="/tools/shadow-it-scan/images/google-logo.svg" alt="Google logo" className="h-5 w-5" />
                {isLoading && loginProvider === 'google' ? 'Connecting...' : 'Sign in with Google Workspace'}
              </Button>
              
              <Button 
                onClick={handleMicrosoftLogin}
                className="w-full flex items-center justify-center gap-2 bg-white text-gray-700 border border-gray-300 hover:bg-gray-50"
                size="lg"
                disabled={isLoading}
              >
                <img src="/tools/shadow-it-scan/images/microsoft-logo.svg" alt="Microsoft logo" className="h-5 w-5" />
                {isLoading && loginProvider === 'microsoft' ? 'Connecting...' : 'Sign in with Microsoft Entra ID'}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
      <footer className="bottom-0 left-0 right-0 flex justify-between items-center px-4 py-3 bg-[#1a1a2e] text-white">
        <div className="flex items-center gap-4">
          <Link href="/" className="hover:text-blue-500 transition-colors">
            stitchflow.com
          </Link>
          <Link href="/privacy" className="hover:text-blue-500 transition-colors">
            Privacy Policy
          </Link>
          <Link href="/terms-of-service" className="hover:text-blue-500 transition-colors">
            Terms of Service
          </Link>
        </div>
        <a 
          href="mailto:contact@stitchflow.io" 
          className="hover:text-blue-500 transition-colors"
        >
          contact@stitchflow.io
        </a>
      </footer>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center">
        <Card className="w-[400px]">
          <CardContent className="flex justify-center items-center h-[200px]">
            Loading...
          </CardContent>
        </Card>
      </div>
    }>
      <LoginContent />
    </Suspense>
  );
} 