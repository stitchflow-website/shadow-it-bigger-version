import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// This function runs on every request
export function middleware(request: NextRequest) {
  console.log('Middleware path:', request.nextUrl.pathname);
  
  // Skip auth check for public routes and internal API calls
  const publicRoutes = [
    '/tools/shadow-it-scan/login',
    '/tools/shadow-it-scan/api/auth/google',
    '/tools/shadow-it-scan/api/auth/microsoft',
    '/tools/shadow-it-scan/api/auth/session/create',
    '/tools/shadow-it-scan/api/auth/session/validate',
    '/tools/shadow-it-scan/api/auth/session/refresh',
    '/tools/shadow-it-scan/api/auth/session/logout',
    '/tools/shadow-it-scan/api/background/sync',
    '/tools/shadow-it-scan/api/background/sync/google',
    '/tools/shadow-it-scan/api/background/sync/microsoft',
    '/tools/shadow-it-scan/api/background/sync/tokens',
    '/tools/shadow-it-scan/api/background/sync/users',
    '/tools/shadow-it-scan/api/background/sync/relations',
    '/tools/shadow-it-scan/api/background/sync/categorize',
    '/tools/shadow-it-scan/api/background/check-notifications',
    '/api/background/sync',
    '/api/background/sync/users',
    '/api/background/sync/tokens',
    '/api/background/sync/relations',
    '/api/background/sync/categorize',
    '/api/background/sync/microsoft',
    '/api/background/sync/google',
    '/tools/shadow-it-scan/api/categorize',  // Add the categorization API
    '/tools/shadow-it-scan/loading',
    '/tools/shadow-it-scan/api/user',
    '/tools/shadow-it-scan/api/session-info', // Add the new session-info API
    '/tools/shadow-it-scan/api/sync/status',
    '/tools/shadow-it-scan/favicon.ico',
    '/tools/shadow-it-scan/images',  // Add images directory
    '/tools/shadow-it-scan/.*\\.(?:jpg|jpeg|gif|png|svg|ico|css|js)$'
  ];
  
  // Check if current URL is a public route
  const isPublicRoute = publicRoutes.some(route => 
    request.nextUrl.pathname === route || request.nextUrl.pathname.startsWith(route)
  );
  
  // Check for internal API calls with service role key
  const isInternalApiCall = request.headers.get('Authorization')?.includes(process.env.SUPABASE_SERVICE_ROLE_KEY || '');
  
  // Check for session cookie instead of direct orgId cookie
  const hasSessionCookie = request.cookies.has('shadow_session_id');
  const hasLegacyAuthCookie = request.cookies.has('orgId');
  const isAuthenticated = hasSessionCookie || hasLegacyAuthCookie || isInternalApiCall;
  
  console.log('isAuthenticated:', isAuthenticated, 'isPublicRoute:', isPublicRoute, 'isInternalApiCall:', isInternalApiCall);
  
  // // // Redirect logic
  // if (!isAuthenticated && !isPublicRoute) {
  //   // Redirect to login page if not authenticated and trying to access protected route
  //   return NextResponse.redirect(new URL('/tools/shadow-it-scan/login', request.url));
  // }
  
  if (isAuthenticated && request.nextUrl.pathname === '/tools/shadow-it-scan/login' && !isInternalApiCall) {
    // Redirect to home page if already authenticated and trying to access login page
    return NextResponse.redirect(new URL(`/tools/shadow-it-scan/`, request.url));
  }
  
  // Check if the request is for the shadow-it-scan API
  const pathname = request.nextUrl.pathname;
  
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
    const response = NextResponse.rewrite(url);
    return response;
  }
  
  // Check if user is authenticated for protected routes
  /* if (pathname.startsWith('/tools/shadow-it-scan') &&
      !pathname.startsWith('/tools/shadow-it-scan/login') &&
      !pathname.startsWith('/tools/shadow-it-scan/api/')) {
    
    // Check for the new session cookie first, then fallback to legacy cookies
    if (!hasSessionCookie && !hasLegacyAuthCookie) {
      return NextResponse.redirect(new URL('/tools/shadow-it-scan/login', request.url));
    }
  } */
  
  // Continue with the request
  return NextResponse.next();
}

// Configure which routes use this middleware
export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - api (API routes)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public folder files
     */
    '/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
    '/tools/shadow-it-scan/api/categorization/status/:path*',
  ],
}; 