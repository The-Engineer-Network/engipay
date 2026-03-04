// Centralized API configuration
// Use BACKEND_URL for server-side API routes (without NEXT_PUBLIC_ prefix)
export const BACKEND_URL = process.env.BACKEND_URL || process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001';
