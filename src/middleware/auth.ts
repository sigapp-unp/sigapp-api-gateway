import { logger } from '../logging';
import { verifyJwt } from '../jwt';
import { JWTPayload } from 'jose';
import { truncateToken, createErrorResponse } from '../helpers/http';
import { SupabaseConfig } from '../types';

/**
 * Log JWT payload information with PII redaction
 *
 * @param payload - The JWT payload
 */
export function logJwtPayload(payload: any): void {
	if (payload.sub) logger.debug(`User ID: ${payload.sub}`, 'Auth');

	if (payload.email) {
		const maskedEmail = payload.email.toString().replace(/^(.{3})(.*)(@.*)$/, '$1****$3');
		logger.debug(`Email: ${maskedEmail}`, 'Auth');
	}

	if (payload.role) logger.debug(`Role: ${payload.role}`, 'Auth');
}

/**
 * Handle JWT verification errors with appropriate responses
 *
 * @param err - The error that occurred during JWT verification
 * @returns HTTP error response
 */
export function handleJwtVerificationError(err: unknown): Response {
	logger.error(`JWT verification failed: ${err}`, 'Auth');

	// Provide specific error responses based on error message
	let status = 401;
	let errorMessage = 'Invalid or expired token';
	let errorDetails = err instanceof Error ? err.message : String(err);

	if (errorDetails.includes('No keys found')) {
		errorMessage = 'Authentication configuration error';
		errorDetails = 'No JWKS keys available for token verification';
		status = 503; // Service Unavailable
	} else if (errorDetails.includes('expired')) {
		errorMessage = 'Token expired';
	} else if (errorDetails.includes('Invalid token format')) {
		errorMessage = 'Invalid token format';
	}

	return createErrorResponse('Unauthorized', errorMessage, status, errorDetails);
}

/**
 * Verify a JWT token from an Authorization header
 *
 * @param request - The incoming HTTP request
 * @param config - Supabase configuration
 * @returns The JWT payload or throws an error
 */
export async function verifyAuthToken(request: Request, config: SupabaseConfig): Promise<JWTPayload> {
	const authHeader = request.headers.get('Authorization') || '';
	const token = authHeader.replace('Bearer ', '').trim();

	if (!token) {
		logger.error('Missing Authorization token', 'Auth');
		throw new Error('Missing Authorization token');
	}

	logger.debug(`Received token: ${truncateToken(token)}`, 'Auth');

	// Verify JWT token
	logger.debug(`Verifying JWT against ${config.jwkUrl}`, 'Auth');
	const payload = await verifyJwt({
		token,
		jwkUrl: config.jwkUrl,
		jwtSecret: config.jwtSecret,
	});

	logger.info('JWT verification succeeded', 'Auth');

	// Log useful info from the payload (with PII redaction)
	logJwtPayload(payload);

	return payload;
}
