import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// This function runs on every request
export async function middleware(request: NextRequest) {
  console.log('Middleware path:', request.nextUrl.pathname);
  
  // Skip auth check for public routes and internal API calls
  const publicRoutes = [
    '/tools/shadow-it-scan/login',
    '/tools/shadow-it-scan/api/auth/google',
    '/tools/shadow-it-scan/api/auth/microsoft',
    '/tools/shadow-it-scan/api/background/sync',
    '/tools/shadow-it-scan/api/background/sync/google',
    '/tools/shadow-it-scan/api/background/sync/microsoft',
    '/tools/shadow-it-scan/api/background/sync/tokens',
    '/tools/shadow-it-scan/api/background/sync/users',
    '/tools/shadow-it-scan/api/background/sync/relations',
    '/tools/shadow-it-scan/api/background/sync/categorize',
    '/api/background/sync',
    '/api/background/sync/users',
    '/api/background/sync/tokens',
    '/api/background/sync/relations',
    '/api/background/sync/categorize',
    '/api/background/sync/microsoft',
    '/api/background/sync/google',
    '/tools/shadow-it-scan/api/categorize',  // Add the categorization API
    '/tools/shadow-it-scan/loading',
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
  
  // Just check for the presence of user_info cookie for now
  const userInfo = request.cookies.get('orgId')?.value;
  const isAuthenticated = !!userInfo || isInternalApiCall;
  
  console.log('isAuthenticated:', isAuthenticated, 'isPublicRoute:', isPublicRoute, 'isInternalApiCall:', isInternalApiCall);
  
  // // Redirect logic
  if (!isAuthenticated && !isPublicRoute) {
    // Redirect to login page if not authenticated and trying to access protected route
    return NextResponse.redirect(new URL('/tools/shadow-it-scan/login', request.url));
  }
  
  if (isAuthenticated && request.nextUrl.pathname === '/tools/shadow-it-scan/login' && !isInternalApiCall) {
    // Redirect to home page if already authenticated and trying to access login page
    return NextResponse.redirect(new URL(`/tools/shadow-it-scan/?orgId=${request.cookies.get('orgId')?.value}`, request.url));
  }
  
  // Continue with the request
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
  ],
}; 