import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  try {
    // Get session from cookies
    const userInfo = request.cookies.get('user_info')?.value;
    
    if (!userInfo) {
      return NextResponse.json({
        authenticated: false,
        message: 'No session found'
      });
    }
    
    // Parse the user info
    const user = JSON.parse(userInfo);
    
    return NextResponse.json({
      authenticated: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        provider: user.provider
      }
    });
  } catch (error) {
    console.error('Error checking session:', error);
    return NextResponse.json({
      authenticated: false,
      message: 'Error checking session'
    }, { status: 500 });
  }
} 