import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  try {
    // Forward request to backend
    const backendUrl = process.env.BACKEND_URL || 'http://localhost:3001';
    const token = request.headers.get('authorization');

    const response = await fetch(`${backendUrl}/api/portfolio/balances`, {
      method: 'GET',
      headers: {
        'Authorization': token || '',
      }
    });

    if (!response.ok) {
      const errorData = await response.json();
      return NextResponse.json(
        { error: errorData.message || 'Failed to get portfolio balances' },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);

  } catch (error) {
    console.error('Portfolio balances API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}