"use client";

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from "@/lib/supabase/client";

export default function SignedUpPage() {
  const router = useRouter();
  const supabase = createClient();
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const checkAuthAndRedirect = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        // If not authenticated, redirect to the main page of the tool
        router.push('/tools/renewal-tracker');
        return;
      }

      // No need to set a sessionStorage flag since we're now handling user detection in the auth callback

      // Redirect to home after a short delay
      const timer = setTimeout(() => {
        router.push('/tools/renewal-tracker/home');
      }, 2000);

      return () => clearTimeout(timer);
    };

    checkAuthAndRedirect();
  }, [router, supabase]);

  // Display a full-page loader for the 1-second duration
  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-[#FAF8FA] text-center p-4">
      {/* Optional: You can add a very subtle message or keep it just a spinner */}
      {/* <p className="text-md text-gray-500 mb-4">Finalizing setup...</p> */}
      <div className="animate-spin rounded-full h-12 w-12 border-b-4 border-primary"></div>
    </div>
  );
} 