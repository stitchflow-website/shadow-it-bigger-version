"use client";

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from "@/lib/supabase/client";

export default function SignedUpPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = createClient();
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const checkAuthAndRedirect = async () => {
      // Get URL parameters
      const syncId = searchParams.get('syncId');
      const orgId = searchParams.get('orgId');
      const provider = searchParams.get('provider');
      
      // Determine which tool we're dealing with based on URL parameters
      const isShadowItScan = syncId || orgId || provider;
      
      if (isShadowItScan) {
        // For shadow-it-scan: redirect to loading page after a short delay
        console.log('New shadow-it-scan user signed up, redirecting to loading page');
        
        const timer = setTimeout(() => {
          const loadingUrl = new URL('/tools/shadow-it-scan/loading', window.location.origin);
          if (syncId) loadingUrl.searchParams.set('syncId', syncId);
          if (orgId) loadingUrl.searchParams.set('orgId', orgId);
          if (provider) loadingUrl.searchParams.set('provider', provider);
          
          router.push(loadingUrl.toString());
        }, 3000); // 3 second delay to show welcome message
        
        return () => clearTimeout(timer);
      } else {
        // For renewal-tracker: use the original logic
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) {
          router.push('/tools/shadow-it-scan');
          return;
        }

        const timer = setTimeout(() => {
          router.push('/tools/shadow-it-scan');
        }, 2000);

        return () => clearTimeout(timer);
      }
    };

    checkAuthAndRedirect();
  }, [router, supabase, searchParams]);

  // Get provider for display purposes
  const provider = searchParams.get('provider');
  const syncId = searchParams.get('syncId');
  const isShadowItScan = syncId || provider;

  // Display a full-page loader for the 1-second duration
  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-[#FAF8FA] text-center p-4">
      {/* Optional: You can add a very subtle message or keep it just a spinner */}
      {/* <p className="text-md text-gray-500 mb-4">Finalizing setup...</p> */}
      <div className="animate-spin rounded-full h-12 w-12 border-b-4 border-primary"></div>
    </div>
  );
} 