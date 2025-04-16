import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// Define paths that don't require authentication
const PUBLIC_PATHS = [
  '/login', 
  '/loading',
  '/privacy',
  '/terms',
  '/auth/google',
  '/api/auth/google',  // Add the API route for OAuth callback
  '/api/background/sync', // Allow background sync API
];
const PUBLIC_FILE_PATTERNS = [
  /\.(?:jpg|jpeg|gif|png|svg|ico)$/,  // images
  /^\/public\//,                       // public folder
  /^\/images\//,                       // images folder
  /^\/assets\//,                       // assets folder
  /^\/favicon\.ico$/,                  // favicon
  /^\/robots\.txt$/,                   // robots.txt
  /^\/manifest\.json$/,                // manifest file
];

export function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const searchParams = request.nextUrl.searchParams;
  const host = request.headers.get('host') || '';
  
  // Debug info
  console.log(`Middleware path: ${path}`);
  console.log(`Host: ${host}`);
  console.log(`Search params: ${searchParams.toString()}`);
  
  // Get authentication cookies
  const orgId = request.cookies.get('orgId')?.value;
  const userEmail = request.cookies.get('userEmail')?.value;
  
  console.log(`orgId cookie: ${orgId}`);
  console.log(`userEmail cookie: ${userEmail}`);
  
  // Check if the user is authenticated
  const isAuthenticated = orgId && userEmail;
  console.log(`isAuthenticated: ${isAuthenticated}`);

  // Helper function to create base URL
  const getBaseUrl = () => {
    const host = request.headers.get('host') || 'localhost:3000';
    const protocol = host.includes('localhost') ? 'http://' : 'https://';
    return `${protocol}${host}`;
  };

  // Check if the path is for a public file
  const isPublicFile = PUBLIC_FILE_PATTERNS.some(pattern => pattern.test(path));
  if (isPublicFile) {
    return NextResponse.next();
  }

  // Skip middleware completely for API routes other than auth
  if (path.startsWith('/api') && !path.startsWith('/api/auth')) {
    return NextResponse.next();
  }

  // Check if the path is public
  const isPublicPath = PUBLIC_PATHS.some(publicPath => 
    path === publicPath || path.startsWith(publicPath)
  );

  // If user is authenticated and trying to access login page, redirect to dashboard
  if (isAuthenticated && path === '/login') {
    return NextResponse.redirect(new URL(`/?orgId=${orgId}`, request.url));
  }

  // If user is not authenticated and trying to access non-public path, redirect to login
  if (!isAuthenticated && !isPublicPath) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  // For authenticated users, set organization and user headers
  const response = NextResponse.next();
  if (orgId) {
    response.headers.set('x-organization-id', orgId);
  }
  if (userEmail) {
    response.headers.set('x-user-email', userEmail);
  }

  return response;
}

// Configure the paths that middleware should run on
export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * 1. _next/static (static files)
     * 2. _next/image (image optimization files)
     * 3. favicon.ico (favicon file)
     * 4. public folder
     * 5. images in various formats
     */
    '/((?!_next/static|_next/image|favicon.ico|public/|assets/|images/|.*\\.(?:jpg|jpeg|gif|png|svg|ico)$).*)',
  ],
}; 