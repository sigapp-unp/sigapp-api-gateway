import { logger } from '../logging';
import { SupabaseConfig } from '../types';
import { createErrorResponse, validateUrl, makeProxyResponse, logErrorResponseBody } from '../helpers/http';

/**
 * Log information about issued tokens without exposing the tokens themselves
 *
 * @param response - Auth response containing tokens
 */
export async function logTokenIssuance(response: Response): Promise<void> {
	try {
		const responseBody = (await response.json()) as {
			access_token?: string;
			expires_in?: number;
			refresh_token?: string;
		};

		if (responseBody.access_token) {
			logger.info('Access token issued', 'Auth');
			// Log token expiry if provided
			if (responseBody.expires_in) {
				logger.debug(`Token expires in: ${responseBody.expires_in} seconds`, 'Auth');
			}
		}

		if (responseBody.refresh_token) {
			logger.debug('Refresh token issued', 'Auth');
		}
	} catch (err) {
		logger.error('Could not parse auth response JSON', 'Auth');
	}
}

/**
 * Proxies authentication requests to Supabase Auth API
 *
 * @param endpoint - The Supabase Auth endpoint to call
 * @param config - The Supabase configuration
 * @param method - The HTTP method
 * @param jsonBody - The request body as a string
 * @param authHeader - Optional Authorization header to pass through
 * @returns Response from Supabase Auth API
 */
export async function proxyAuth(
	endpoint: string,
	config: SupabaseConfig,
	method: string,
	jsonBody: string | null,
	authHeader?: string
): Promise<Response> {
	try {
		logger.info(`Proxying auth request to: ${endpoint}`, 'Auth');

		// Validate URL before fetching
		validateUrl(endpoint);

		// Prepare headers for auth request
		const headers: Record<string, string> = {
			'Content-Type': 'application/json',
			apikey: config.anonKey,
			'X-Client-Info': 'sigapp-proxy',
		};

		if (authHeader) {
			headers['Authorization'] = authHeader;
			logger.debug(`Using provided Authorization header: ${authHeader.startsWith('Bearer') ? 'Bearer [REDACTED]' : '[REDACTED]'}`, 'Auth');
		}

		logger.debug(`Auth request method: ${method}`, 'Auth');

		// Make request to Supabase Auth API
		const response = await fetch(endpoint, {
			method,
			headers,
			body: ['GET', 'HEAD'].includes(method) ? undefined : jsonBody,
		});

		logger.info(`Auth response status: ${response.status} ${response.statusText}`, 'Auth');

		// Log additional details based on response status
		if (!response.ok) {
			logErrorResponseBody(response.clone());
		} else {
			logger.info('Auth request successful', 'Auth');

			// Log token issuance for login/refresh (without exposing tokens)
			if (endpoint.includes('token?grant_type=')) {
				logTokenIssuance(response.clone());
			}
		}

		return makeProxyResponse(response);
	} catch (err) {
		logger.error(`Error proxying auth request to ${endpoint}: ${err}`, 'Auth');
		return createErrorResponse('Authentication service unavailable', err instanceof Error ? err.message : 'Unknown error', 500);
	}
}

/**
 * Function for handling all authentication routes
 *
 * @param path - The request path
 * @param method - The HTTP method
 * @param request - The incoming request
 * @param config - Supabase configuration
 * @param jsonBody - The parsed request body
 * @returns Response for the authentication route
 */
export async function handleAuthRoutes(
	path: string,
	method: string,
	request: Request,
	config: SupabaseConfig,
	jsonBody: string | null
): Promise<Response | null> {
	// Only handle auth-related paths
	if (!path.startsWith('/auth/')) {
		return null;
	}

	if (path === '/auth/signup' && method === 'POST') {
		return proxyAuth(`${config.supabaseUrl}/auth/v1/signup`, config, method, jsonBody);
	}

	if (path === '/auth/login' && method === 'POST') {
		return proxyAuth(`${config.supabaseUrl}/auth/v1/token?grant_type=password`, config, method, jsonBody);
	}

	if (path === '/auth/refresh' && method === 'POST') {
		return proxyAuth(`${config.supabaseUrl}/auth/v1/token?grant_type=refresh_token`, config, method, jsonBody);
	}

	if (path === '/auth/user' && method === 'GET') {
		const authHeader = request.headers.get('Authorization') || '';
		if (!authHeader) {
			return createErrorResponse('Missing Authorization header', undefined, 401);
		}
		return proxyAuth(`${config.supabaseUrl}/auth/v1/user`, config, method, jsonBody, authHeader);
	}

	// If we get here, it's an auth route we don't handle
	return createErrorResponse('Not Found', `Route ${path} does not exist`, 404);
}
