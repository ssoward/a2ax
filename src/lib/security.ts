/**
 * Security Hardening Utilities
 * 
 * Addresses MCP Security Report findings:
 * - Input validation enhancements
 * - Exception handling improvements
 * - API key security
 */

import { randomBytes } from 'crypto';

/**
 * Validate and sanitize API key format
 * Prevents injection attacks and ensures proper key structure
 */
export function validateApiKeyFormat(apiKey: string): boolean {
  if (!apiKey || typeof apiKey !== 'string') return false;
  // Must be alphanumeric, 40-128 chars, no special chars that could enable injection
  if (!/^[a-zA-Z0-9]{40,128}$/.test(apiKey)) return false;
  // Check for common injection patterns
  if (/[\x00-\x1F\x7F]/.test(apiKey)) return false;
  return true;
}

/**
 * Enhanced content sanitization
 * Strips dangerous characters, control chars, and enforces strict limits
 */
export function sanitizeInput(raw: string, maxLength: number = 280): string {
  if (!raw || typeof raw !== 'string') return '';
  
  return raw
    // Strip NULL bytes and control characters (except newline/tab)
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    // Strip HTML/XML tags to prevent XSS
    .replace(/<[^>]*>/g, '')
    // Strip potential SQL injection patterns (extra safety beyond parameterized queries)
    .replace(/(--|;|\/\*|\*\/|@@|@)/g, '')
    // Enforce length limit
    .slice(0, maxLength)
    .trim();
}

/**
 * Validate search query - prevents ReDoS and injection
 */
export function validateSearchQuery(query: string): { valid: boolean; sanitized?: string; error?: string } {
  if (!query || typeof query !== 'string') {
    return { valid: false, error: 'Query is required' };
  }
  
  const trimmed = query.trim();
  
  // Min/max length
  if (trimmed.length < 2) {
    return { valid: false, error: 'Query must be at least 2 characters' };
  }
  if (trimmed.length > 100) {
    return { valid: false, error: 'Query must be 100 characters or less' };
  }
  
  // Reject dangerous patterns
  const dangerousPatterns = [
    /\*{3,}/,           // Multiple asterisks (ReDoS risk)
    /[+|&!(){}[\]^~]/, // Regex special chars
    /\\/,              // Backslashes
    /[\x00-\x1F\x7F]/, // Control chars
  ];
  
  for (const pattern of dangerousPatterns) {
    if (pattern.test(trimmed)) {
      return { valid: false, error: 'Query contains invalid characters' };
    }
  }
  
  return { valid: true, sanitized: sanitizeInput(trimmed, 100) };
}

/**
 * Secure random token generation for API keys
 */
export function generateSecureToken(prefix: string = 'a2ax_', length: number = 32): string {
  const randomPart = randomBytes(length).toString('hex');
  return `${prefix}${randomPart}`;
}

/**
 * Rate limit key extractor - uses multiple factors for better security
 */
export function getRateLimitKey(req: any): string {
  // Prefer API key hash if authenticated
  if (req.apiKeyHash) {
    return `agent:${req.apiKeyHash}`;
  }
  // Fallback to IP + User-Agent fingerprint
  const ip = req.ip || req.socket?.remoteAddress || 'unknown';
  const ua = req.headers['user-agent'] || 'unknown';
  return `anon:${ip}:${ua}`;
}

/**
 * Structured error response - never leak internal details
 */
export function safeError(message: string, context?: Record<string, unknown>): {
  error: { code: string; message: string };
  timestamp: string;
} {
  // Log full error internally (handled by logger)
  // Return only safe, user-facing message
  const safeMessages = [
    'Invalid request',
    'Authentication failed',
    'Resource not found',
    'Rate limit exceeded',
    'Validation error',
    'Internal error',
  ];
  
  const safeMessage = safeMessages.includes(message) 
    ? message 
    : 'Internal error';
  
  return {
    error: {
      code: safeMessage.toLowerCase().replace(/\s+/g, '_'),
      message: safeMessage,
    },
    timestamp: new Date().toISOString(),
  };
}

/**
 * Validate pagination parameters - prevents abuse
 */
export function validatePagination(limit?: number, offset?: number): {
  limit: number;
  offset: number;
} {
  const safeLimit = Math.min(Math.max(1, limit ?? 20), 100);
  const safeOffset = Math.max(0, offset ?? 0);
  
  // Prevent massive offsets (DoS protection)
  if (safeOffset > 10000) {
    throw new Error('Offset too large. Use cursor-based pagination for large datasets.');
  }
  
  return { limit: safeLimit, offset: safeOffset };
}
