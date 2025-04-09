'use client';

import { useEffect, useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';

function LoadingContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const syncId = searchParams.get('syncId');
  
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState('IN_PROGRESS');
  const [message, setMessage] = useState('Starting data sync...');
  const [error, setError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [lastProgressUpdate, setLastProgressUpdate] = useState<number>(Date.now());

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
          setRetryCount(prev => prev + 1);
          if (retryCount > 5) {
            setError('Unable to fetch sync status after multiple attempts. The process may still be running in the background. Please refresh or check again later.');
          }
          return;
        }

        const data = await response.json();
        
        if (data) {
          // Only update if the progress has changed
          if (data.progress !== progress) {
            setLastProgressUpdate(Date.now());
          }
          
          setProgress(data.progress);
          setStatus(data.status);
          setMessage(data.message || 'Processing your data...');
          setRetryCount(0); // Reset retry count on successful response

          // If completed, redirect to dashboard
          if (data.status === 'COMPLETED') {
            // Wait a moment to show 100% before redirecting
            setTimeout(() => {
              router.push('/');
            }, 1500);
            return;
          }

          // If failed, show error
          if (data.status === 'FAILED') {
            setError(`Sync failed: ${data.message}`);
            return;
          }
          
          // Check if progress has been stuck for too long (2 minutes)
          const timeSinceLastUpdate = Date.now() - lastProgressUpdate;
          if (progress > 0 && timeSinceLastUpdate > 120000) {
            setMessage(`${data.message} (taking longer than expected, please be patient)`);
          }
        }
      } catch (err) {
        console.error('Error in sync status check:', err);
        setRetryCount(prev => prev + 1);
        if (retryCount > 5) {
          setError('An unexpected error occurred. The process may still be running in the background. Please refresh or check your dashboard later.');
        }
      }
    };

    // Check status immediately
    checkSyncStatus();

    // Then set up polling
    const intervalId = setInterval(checkSyncStatus, 2000);

    // Clean up on unmount
    return () => clearInterval(intervalId);
  }, [syncId, router, progress, retryCount, lastProgressUpdate]);

  // Add manual refresh button
  const handleRefresh = () => {
    window.location.reload();
  };
  
  // Add go to dashboard button
  const handleGoToDashboard = () => {
    router.push('/');
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
              <div className="mt-4 flex space-x-4">
                <button 
                  className="px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600"
                  onClick={handleRefresh}
                >
                  Refresh Page
                </button>
                <button 
                  className="px-4 py-2 bg-gray-500 text-white rounded-md hover:bg-gray-600"
                  onClick={handleGoToDashboard}
                >
                  Go to Dashboard
                </button>
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
                {progress === 10 && (
                  <div className="mt-4 p-2 bg-yellow-50 rounded text-yellow-700">
                    <p>Data processing is in progress. This step may take several minutes.</p>
                    <button 
                      className="mt-2 px-3 py-1 bg-blue-500 text-white text-xs rounded-md hover:bg-blue-600"
                      onClick={handleRefresh}
                    >
                      Refresh
                    </button>
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