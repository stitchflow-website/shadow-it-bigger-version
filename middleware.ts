import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// This function runs on every request
export async function middleware(request: NextRequest) {
  console.log('Middleware path:', request.nextUrl.pathname);
  
  // Skip auth check for public routes and internal API calls
  const publicRoutes = [
    '/tools/shadow-it-scan',
    '/tools/shadow-it-scan/login',
    '/tools/shadow-it-scan/api/auth/google',
    '/tools/shadow-it-scan/api/auth/microsoft',
    '/tools/shadow-it-scan/api/auth/create-session',
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
  
  // Check if current URL is a public route or the main page
  const isPublicRoute = publicRoutes.some(route => 
    request.nextUrl.pathname === route || request.nextUrl.pathname.startsWith(route)
  );
  
  // Also check for the root shadow-it-scan path with query params
  const isMainPageWithParams = request.nextUrl.pathname === '/tools/shadow-it-scan/' || 
                               request.nextUrl.pathname === '/tools/shadow-it-scan';
  
  // Check for internal API calls with service role key
  const isInternalApiCall = request.headers.get('Authorization')?.includes(process.env.SUPABASE_SERVICE_ROLE_KEY || '');
  
  // If it's a public route, the main page, or an internal API call, proceed without auth check
  if (isPublicRoute || isMainPageWithParams || isInternalApiCall) {
    return NextResponse.next();
  }
  
  // For other routes, perform authentication checks
  
  // Check for Supabase session cookies
  const sbAccessToken = request.cookies.get('sb-access-token')?.value;
  const sbRefreshToken = request.cookies.get('sb-refresh-token')?.value;
  
  // Check traditional cookies as fallback
  const orgId = request.cookies.get('orgId')?.value;
  const userEmail = request.cookies.get('userEmail')?.value;
  
  // If Supabase cookies are present, validate the session
  if (sbAccessToken && sbRefreshToken) {
    try {
      // Create Supabase client with the session cookies
      const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
          auth: {
            autoRefreshToken: true,
            persistSession: true,
            detectSessionInUrl: false,
          },
          global: {
            headers: {
              Authorization: `Bearer ${sbAccessToken}`
            }
          }
        }
      );
      
      // Try to get the session
      const { data, error } = await supabase.auth.getSession();
      
      if (!error && data?.session) {
        // Session is valid, allow the request
        const response = NextResponse.next();
        
        // Make sure traditional cookies are also set for backward compatibility
        if (!orgId && data.session.user.user_metadata?.organization_id) {
          response.cookies.set('orgId', data.session.user.user_metadata.organization_id, {
            path: '/',
            sameSite: 'lax',
            secure: process.env.NODE_ENV === 'production'
          });
        }
        
        if (!userEmail && data.session.user.email) {
          response.cookies.set('userEmail', data.session.user.email, {
            path: '/',
            sameSite: 'lax',
            secure: process.env.NODE_ENV === 'production'
          });
        }
        
        return response;
      }
    } catch (error) {
      console.error('Error validating Supabase session:', error);
    }
  }
  
  // Check legacy cookies as fallback
  if (orgId && userEmail) {
    return NextResponse.next();
  }
  
  // If neither Supabase session nor legacy cookies are valid, redirect to login page
  // But add a console log to help debug the issue
  console.log('Authentication failed, redirecting to login_required page', {
    path: request.nextUrl.pathname,
    hasSbAccessToken: !!sbAccessToken,
    hasSbRefreshToken: !!sbRefreshToken,
    hasOrgId: !!orgId,
    hasUserEmail: !!userEmail
  });
  
  const redirectUrl = new URL('/tools/shadow-it-scan/?error=login_required', request.url);
  return NextResponse.redirect(redirectUrl);
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
  ],
}; 