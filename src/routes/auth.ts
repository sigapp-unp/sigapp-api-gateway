import { logger } from '../logging';
import { SupabaseConfig } from '../types';
import { createErrorResponse, validateUrl, makeProxyResponse, logErrorResponseBody } from '../helpers/http';

/**
 * Proxies all authentication requests directly to Supabase Auth API
 * No specific endpoint handling, just forwards the request
 *
 * @param path - The request path
 * @param method - The HTTP method
 * @param request - The incoming HTTP request
 * @param jsonBody - The request body as a string
 * @param config - Supabase configuration
 * @returns Response from Supabase Auth API
 */
export async function proxyAuthRequest(
	path: string,
	method: string,
	request: Request,
	jsonBody: string | null,
	config: SupabaseConfig
): Promise<Response> {
	try {
		// Extract search params from original URL
		const originalUrl = new URL(request.url);
		const searchParams = originalUrl.search;

		// Create auth endpoint URL by combining Supabase URL and the original path + query params
		const endpoint = `${config.supabaseUrl}${path}${searchParams}`;

		logger.info(`Proxying auth request to: ${endpoint}`, 'Auth');

		// Validate URL before fetching
		validateUrl(endpoint);

		// Prepare headers for auth request
		const headers: Record<string, string> = {
			'Content-Type': request.headers.get('Content-Type') ?? 'application/json',
			apikey: config.anonKey,
			'X-Client-Info': 'sigapp-proxy',
		};

		// Pass through Authorization header if present
		const authHeader = request.headers.get('Authorization');
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

		// Log additional details for error responses
		if (!response.ok) {
			logErrorResponseBody(response.clone());
		} else {
			logger.info('Auth request successful', 'Auth');
		}

		return makeProxyResponse(response);
	} catch (err) {
		logger.error(`Error proxying auth request: ${err}`, 'Auth');
		return createErrorResponse('Authentication service unavailable', err instanceof Error ? err.message : 'Unknown error', 500);
	}
}

/**
 * Function for handling all authentication routes
 * Simply checks if it's an auth route and forwards the request
 *
 * @param path - The request path
 * @param method - The HTTP method
 * @param request - The incoming request
 * @param config - Supabase configuration
 * @param jsonBody - The parsed request body
 * @returns Response for the authentication route or null if not an auth route
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

	// Directly proxy all auth requests to Supabase
	logger.info(`Handling auth route: ${path}`, 'Auth');
	return proxyAuthRequest(path, method, request, jsonBody, config);
}
