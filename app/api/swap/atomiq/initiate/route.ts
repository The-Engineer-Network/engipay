import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const { quoteId, fromToken, toToken, fromAmount, toAmount, slippage } = await request.json();

    // Validate input
    if (!quoteId || !fromToken || !toToken || !fromAmount || !toAmount) {
      return NextResponse.json(
        { error: 'Missing required parameters' },
        { status: 400 }
      );
    }

    // Forward request to backend
    const backendUrl = process.env.BACKEND_URL || 'http://localhost:3001';
    const token = request.headers.get('authorization');

    const response = await fetch(`${backendUrl}/api/swap/atomiq/initiate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': token || '',
      },
      body: JSON.stringify({
        quoteId,
        fromToken,
        toToken,
        fromAmount,
        toAmount,
        slippage: slippage || 0.5
      })
    });

    if (!response.ok) {
      const errorData = await response.json();
      return NextResponse.json(
        { error: errorData.message || 'Failed to initiate swap' },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);

  } catch (error) {
    console.error('Initiate swap API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}