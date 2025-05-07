import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// This function runs on every request
export function middleware(request: NextRequest) {
  console.log('Middleware path:', request.nextUrl.pathname);
  
  // Check if the request is for the shadow-it-scan API that needs rewrites
  const pathname = request.nextUrl.pathname;
  
  // Check for any necessary URL rewrites
  if (pathname.startsWith('/tools/shadow-it-scan/api/categorization/status')) {
    // Create a new URL for the rewritten endpoint
    const url = new URL(request.url);
    // Change the pathname to the actual API endpoint
    url.pathname = `/api/categorization/status`;
    // Keep the query parameters
    
    return NextResponse.rewrite(url);
  }
  
  // Add rewrite for session-info endpoint
  if (pathname.startsWith('/tools/shadow-it-scan/api/session-info')) {
    const url = new URL(request.url);
    url.pathname = `/api/session-info`;
    
    // Forward cookies in the request
    return NextResponse.rewrite(url);
  }
  
  // Add rewrite for retry-session endpoint
  if (pathname.startsWith('/tools/shadow-it-scan/api/auth/retry-session')) {
    const url = new URL(request.url);
    url.pathname = `/api/auth/retry-session`;
    
    // Forward cookies in the request
    return NextResponse.rewrite(url);
  }
  
  // For all other requests, proceed normally
  return NextResponse.next();
}

// Configure which routes use this middleware
export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public folder
     */
    '/((?!_next/static|_next/image|favicon.ico|public/).*)',
    '/tools/shadow-it-scan/api/categorization/status/:path*',
    '/tools/shadow-it-scan/api/session-info/:path*',
    '/tools/shadow-it-scan/api/auth/retry-session/:path*',
  ],
}; 