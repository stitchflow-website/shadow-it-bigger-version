'use client';

import { useEffect, useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';

function LoadingContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const syncId = searchParams.get('syncId');
  
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState('IN_PROGRESS');
  const [message, setMessage] = useState('Starting data sync...');
  const [error, setError] = useState<string | null>(null);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [authRedirected, setAuthRedirected] = useState(false);

  useEffect(() => {
    if (!syncId) {
      router.push('/');
      return;
    }

    // Function to check sync status
    const checkSyncStatus = async () => {
      try {
        // Use the API endpoint instead of direct Supabase access
        const response = await fetch(`/api/sync/status?syncId=${syncId}`);
        
        if (!response.ok) {
          console.error('Error fetching sync status:', response.statusText);
          setError('Unable to fetch sync status. Please refresh the page or contact support.');
          return;
        }

        const data = await response.json();
        
        if (data) {
          setProgress(data.progress);
          setStatus(data.status);
          setMessage(data.message || 'Processing your data...');
          
          if (data.organization_id) {
            setOrgId(data.organization_id);
          }

          // If completed, redirect to dashboard
          if (data.status === 'COMPLETED') {
            // Wait a moment to show 100% before redirecting
            setTimeout(() => {
              if (data.organization_id) {
                router.push(`/?orgId=${data.organization_id}`);
              } else {
                router.push('/');
              }
            }, 1500);
            return;
          }

          // If failed, show error
          if (data.status === 'FAILED') {
            setError(`Sync failed: ${data.message}`);
            return;
          }
        }
      } catch (err) {
        console.error('Error in sync status check:', err);
        
        // Special handling for authentication errors
        if (!authRedirected && (err instanceof Error) && err.message.includes('Authentication')) {
          setAuthRedirected(true);
          // Add a delay before redirecting to login
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

    // Then set up polling
    const intervalId = setInterval(checkSyncStatus, 2000);

    // Clean up on unmount
    return () => clearInterval(intervalId);
  }, [syncId, router, authRedirected]);

  // Function to manually go to dashboard
  const goToDashboard = () => {
    if (orgId) {
      router.push(`/?orgId=${orgId}`);
    } else {
      router.push('/');
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
                  We're scanning your Google Workspace to discover all connected applications.
                  <br />
                  This process is running in the background, so you'll be redirected once it completes.
                </p>
                {progress >= 50 && (
                  <div className="mt-4">
                    <Button
                      variant="outline"
                      onClick={goToDashboard}
                      className="mt-2"
                    >
                      View Progress in Dashboard
                    </Button>
                  </div>
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function LoadingPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Card className="w-[600px]">
          <CardContent className="flex justify-center items-center py-10">
            <div className="text-center">
              <div className="animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-blue-500 mx-auto mb-4"></div>
              <p>Loading...</p>
            </div>
          </CardContent>
        </Card>
      </div>
    }>
      <LoadingContent />
    </Suspense>
  );
} 