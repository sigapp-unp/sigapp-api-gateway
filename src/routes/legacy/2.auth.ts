import { logger } from '../../core/logging';
import { SupabaseConfig } from '../../core/types';
import { createErrorResponse, validateUrl, makeProxyResponse, logErrorResponseBody } from '../../helpers/http';

/**
 * Proxies all authentication requests directly to Supabase Auth API
 * Pure proxy, no special handling of endpoints
 *
 * @param requestUrl - The URL
 * @param request - The incoming HTTP request
 * @param jsonBody - The request body as a string
 * @param supabaseConfig - Supabase configuration
 * @returns Response from Supabase Auth API
 */
export async function handleAuthRoute({
	requestUrl,
	request,
	jsonBody,
	supabaseConfig,
}: {
	requestUrl: URL;
	request: Request;
	jsonBody: string | null;
	supabaseConfig: SupabaseConfig;
}): Promise<Response> {
	try {
		// Extract search params from original URL
		const originalUrl = new URL(request.url);
		const searchParams = originalUrl.search;

		// Create auth endpoint URL by combining Supabase URL and the original path + query params
		const endpoint = `${supabaseConfig.url}${requestUrl.pathname}${searchParams}`;

		logger.info(`Proxying auth request to: ${endpoint}`, 'Auth');

		// Validate URL before fetching
		validateUrl(endpoint);

		// Prepare headers for auth request
		const headers: Record<string, string> = {
			'Content-Type': request.headers.get('Content-Type') ?? 'application/json',
			apikey: supabaseConfig.anonKey,
			// 'X-Client-Info': 'sigapp-proxy',
		};

		// Pass through Authorization header if present
		const authHeader = request.headers.get('Authorization');
		if (authHeader) {
			headers['Authorization'] = authHeader;
			logger.debug(`Using provided Authorization header: ${authHeader.startsWith('Bearer') ? 'Bearer [REDACTED]' : '[REDACTED]'}`, 'Auth');
		}

		logger.debug(`Auth request method: ${request.method}`, 'Auth');

		// Make request to Supabase Auth API
		const response = await fetch(endpoint, {
			method: request.method,
			headers,
			body: ['GET', 'HEAD'].includes(request.method) ? undefined : jsonBody,
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
