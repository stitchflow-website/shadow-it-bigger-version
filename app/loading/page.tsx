'use client';

import { useEffect, useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';

type Provider = 'microsoft' | 'google' | null;

function LoadingContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const syncId = searchParams.get('syncId');
  
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState('IN_PROGRESS');
  const [message, setMessage] = useState('Initializing...');
  const [error, setError] = useState<string | null>(null);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [authRedirected, setAuthRedirected] = useState(false);
  const [stuckSync, setStuckSync] = useState(false);
  const [lastProgressUpdate, setLastProgressUpdate] = useState<number>(Date.now());
  const [isInitialLoad, setIsInitialLoad] = useState(true);
  const [provider, setProvider] = useState<Provider>(null);

  // Function to get provider-specific text
  const getProviderName = () => {
    switch (provider) {
      case 'microsoft':
        return 'Microsoft Entra ID';
      case 'google':
        return 'Google Workspace';
      default:
        return 'your organization';
    }
  };

  // Function to manually complete a stuck sync
  const completeStuckSync = async () => {
    if (!syncId) return;
    
    try {
      const response = await fetch('/tools/shadow-it-scan/api/background/sync/complete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ syncId }),
      });
      
      if (!response.ok) {
        throw new Error(`Failed to complete sync: ${response.statusText}`);
      }
      
      // Redirect to dashboard after completion
      if (orgId) {
        router.push(`/?orgId=${orgId}`);
      } else {
        router.push('/');
      }
    } catch (err) {
      console.error('Error completing sync:', err);
      setError('Failed to complete sync. Please try refreshing the page.');
    }
  };

  useEffect(() => {
    console.log('Loading page mounted, syncId:', syncId);
    
    if (!syncId) {
      console.error('No syncId provided');
      router.push('/');
      return;
    }

    // Function to check sync status
    const checkSyncStatus = async () => {
      try {
        console.log('Checking sync status for ID:', syncId);
        const response = await fetch(`/tools/shadow-it-scan/api/sync/status?syncId=${syncId}`);
        
        if (!response.ok) {
          console.error('Error fetching sync status:', response.statusText);
          setError('Unable to fetch sync status. Please refresh the page or contact support.');
          return;
        }

        const data = await response.json();
        console.log('Sync status data:', data);
        
        if (data) {
          setProgress(data.progress || 0);
          setStatus(data.status || 'IN_PROGRESS');
          setMessage(data.message || 'Processing your data...');
          setIsInitialLoad(false);
          
          // Determine provider from the sync record
          if (data.access_token) {
            // Check token audience or other properties to determine provider
            const provider = data.access_token.includes('microsoft') ? 'microsoft' : 'google';
            setProvider(provider);
          }
          
          if (data.organization_id) {
            setOrgId(data.organization_id);
          }

          // Update last progress timestamp
          if (data.progress !== progress) {
            setLastProgressUpdate(Date.now());
          }

          // Check for stuck sync (no progress for 30 seconds and not complete)
          const timeSinceLastUpdate = Date.now() - lastProgressUpdate;
          if (timeSinceLastUpdate > 30000 && data.status === 'IN_PROGRESS') {
            setStuckSync(true);
          }

          // If main sync is complete (progress >= 85%), redirect to dashboard
          if (data.progress >= 85 || data.status === 'COMPLETED') {
            console.log('Sync complete, redirecting to dashboard');
            // Wait a moment to show progress before redirecting
            setTimeout(() => {
              if (data.organization_id) {
                router.push(`/tools/shadow-it-scan/?orgId=${data.organization_id}`);
              } else {
                router.push('/tools/shadow-it-scan/');
              }
            }, 1500);
            return;
          }

          // If failed, show error
          if (data.status === 'FAILED') {
            console.error('Sync failed:', data.message);
            setError(`Sync failed: ${data.message}`);
            return;
          }
        }
      } catch (err) {
        console.error('Error in sync status check:', err);
        
        if (!authRedirected && (err instanceof Error) && err.message.includes('Authentication')) {
          setAuthRedirected(true);
          setTimeout(() => {
            router.push('/login');
          }, 2000);
          setError('Authentication error. Redirecting to login...');
          return;
        }
        
        setError('An unexpected error occurred. Please refresh the page or contact support.');
      }
    };

    // Check status immediately
    checkSyncStatus();

    // Then set up polling with a shorter initial interval
    const initialInterval = setInterval(checkSyncStatus, 1000); // Check every second initially

    // After 10 seconds, switch to a longer interval
    const timeoutId = setTimeout(() => {
      clearInterval(initialInterval);
      const regularInterval = setInterval(checkSyncStatus, 3000); // Then every 3 seconds
      return () => clearInterval(regularInterval);
    }, 10000);

    // Clean up on unmount
    return () => {
      clearInterval(initialInterval);
      clearTimeout(timeoutId);
    };
  }, [syncId, router, authRedirected, progress, lastProgressUpdate]);

  // Function to manually go to dashboard
  const goToDashboard = () => {
    if (orgId) {
      router.push(`/tools/shadow-it-scan/?orgId=${orgId}`);
    } else {
      router.push('/tools/shadow-it-scan/');
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <Card className="w-[600px]">
        <CardHeader>
          <CardTitle>Loading Your Data</CardTitle>
          <CardDescription>
            We're setting up your Shadow IT Scanner dashboard. This may take a few minutes.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {error ? (
            <div className="text-red-500 mb-4 p-4 bg-red-50 rounded-md">
              {error}
              <div className="mt-4">
                <Button 
                  onClick={goToDashboard}
                  className="px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600"
                >
                  Go to Dashboard
                </Button>
              </div>
            </div>
          ) : (
            <>
              <div className="mb-4">
                <Progress value={progress} className="h-2" />
              </div>
              <div className="flex justify-between items-center text-sm text-gray-500">
                <span>{message}</span>
                <span>{progress}%</span>
              </div>
              <div className="mt-8 text-center text-gray-500 text-sm">
                <p>
                  {isInitialLoad ? (
                    "Initializing connection..."
                  ) : (
                    <>
                      We're scanning {getProviderName()} to discover all connected applications.
                      <br />
                      This process is running in the background, so you'll be redirected once it completes.
                    </>
                  )}
                </p>
                {/* {progress >= 50 && (
                  <div className="mt-4">
                    <Button
                      variant="outline"
                      onClick={goToDashboard}
                      className="mt-2"
                    >
                      View Progress in Dashboard
                    </Button>
                  </div>
                )} */}
              </div>
              {stuckSync && progress >= 75 && progress < 100 && status === 'IN_PROGRESS' && (
                <div className="mt-4">
                  <p className="text-amber-600 mb-2">Sync seems to be taking longer than expected.</p>
                  <Button
                    variant="secondary"
                    onClick={completeStuckSync}
                    className="mt-2"
                  >
                    Manually Complete Sync
                  </Button>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function LoadingPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <LoadingContent />
    </Suspense>
  );
} 