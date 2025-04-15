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

          // If completed, redirect to dashboard
          if (data.status === 'COMPLETED') {
            // Wait a moment to show 100% before redirecting
            setTimeout(() => {
              router.push('/');
            }, 1500);
            return;
          }

          // If partial completion, offer option to proceed
          if (data.status === 'PARTIAL') {
            setMessage('Partial data loaded. You can proceed to dashboard or wait for more data.');
            // Show a button in the UI to continue
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
        setError('An unexpected error occurred. Please refresh the page or contact support.');
      }
    };

    // Check status immediately
    checkSyncStatus();

    // Then set up polling
    const intervalId = setInterval(checkSyncStatus, 2000);

    // Clean up on unmount
    return () => clearInterval(intervalId);
  }, [syncId, router]);

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
                <button 
                  className="px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600"
                  onClick={() => router.push('/')}
                >
                  Go to Dashboard
                </button>
              </div>
            </div>
          ) : status === 'PARTIAL' ? (
            <>
              <div className="mb-4">
                <Progress value={75} className="h-2" />
              </div>
              <div className="flex justify-between items-center text-sm text-gray-500">
                <span>{message}</span>
                <span>75%</span>
              </div>
              <div className="mt-4 p-4 bg-yellow-50 rounded-md text-yellow-700">
                <p>Some of your Google Workspace data was loaded successfully. You may see incomplete application information.</p>
                <div className="mt-4 flex justify-between">
                  <button 
                    className="px-4 py-2 bg-gray-200 text-gray-800 rounded-md hover:bg-gray-300"
                    onClick={() => {
                      // Restart sync
                      router.push('/login');
                    }}
                  >
                    Try Again
                  </button>
                  <button 
                    className="px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600"
                    onClick={() => router.push('/')}
                  >
                    Continue to Dashboard
                  </button>
                </div>
              </div>
            </>
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
                {progress === 30 && (
                  <p className="mt-2 text-blue-600">
                    Fetching application data can take some time for large organizations.
                    Please be patient.
                  </p>
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