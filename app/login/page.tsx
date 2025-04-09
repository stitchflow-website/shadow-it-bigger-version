'use client';

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useState, useEffect, Suspense } from "react";
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';

function LoginContent() {
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const searchParams = useSearchParams();

  useEffect(() => {
    const errorParam = searchParams.get('error');
    if (errorParam) {
      switch (errorParam) {
        case 'no_code':
          setError('No authorization code received from Google');
          break;
        case 'auth_failed':
          setError('Authentication failed. Please try again.');
          break;
        default:
          setError('An error occurred during authentication');
      }
    }
  }, [searchParams]);

  const handleGoogleLogin = () => {
    try {
      setIsLoading(true);
      setError(null);

      const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
      const redirectUri = process.env.NEXT_PUBLIC_GOOGLE_REDIRECT_URI;

      if (!clientId || !redirectUri) {
        setError("Missing Google OAuth configuration");
        console.error('Missing env variables:', { clientId, redirectUri });
        return;
      }
      
      const scopes = [
        // User and domain management - read-only access
        'https://www.googleapis.com/auth/admin.directory.user.readonly',
        'https://www.googleapis.com/auth/admin.directory.domain.readonly',
        'https://www.googleapis.com/auth/admin.directory.group.readonly',
        // Token management - required for accessing OAuth tokens
        'https://www.googleapis.com/auth/admin.directory.user.security',
        // Reports and audit logs - read-only access
        // 'https://www.googleapis.com/auth/admin.reports.audit.readonly',
        // 'https://www.googleapis.com/auth/admin.reports.usage.readonly',
        // Basic profile info
        'openid',
        'profile',
        'email'
      ].join(' ');

      const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      authUrl.searchParams.append('client_id', clientId);
      authUrl.searchParams.append('redirect_uri', redirectUri);
      authUrl.searchParams.append('response_type', 'code');
      authUrl.searchParams.append('scope', scopes);
      authUrl.searchParams.append('access_type', 'offline');
      authUrl.searchParams.append('prompt', 'consent');

      window.location.href = authUrl.toString();
    } catch (err) {
      console.error('Login error:', err);
      setError('Failed to initialize login. Please try again.');
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col">
      <div className="flex-grow flex items-center justify-center">
        <Card className="w-[400px]">
          <CardHeader>
            <CardTitle>Welcome to Shadow IT Scanner</CardTitle>
            <CardDescription>
              Sign in with your Google Workspace account to manage your organization's applications.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {error && (
              <div className="mb-4 p-4 text-sm text-red-800 bg-red-100 rounded-lg">
                {error}
              </div>
            )}
            <Button 
              onClick={handleGoogleLogin}
              className="w-full flex items-center justify-center gap-2 bg-white text-gray-700 border border-gray-300 hover:bg-gray-50"
              size="lg"
              disabled={isLoading}
            >
              <img src="/google-logo.svg" alt="Google logo" className="h-5 w-5" />
              {isLoading ? 'Connecting...' : 'Sign in with Google Workspace'}
            </Button>
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
          <Link href="/terms" className="hover:text-blue-500 transition-colors">
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