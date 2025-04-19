import { logger } from '../logging';
import { SupabaseConfig } from '../types';
import { createErrorResponse, logRequestHeaders, logErrorResponseBody, makeProxyResponse } from '../helpers/http';
import { verifyAuthToken, handleJwtVerificationError } from '../middleware/auth';

/**
 * Forward authenticated requests to Supabase with service role key
 *
 * @param path - The request path
 * @param method - The HTTP method
 * @param url - The parsed URL
 * @param request - The original HTTP request
 * @param jsonBody - The request body as a string
 * @param config - Supabase configuration
 * @returns HTTP response from Supabase
 */
export async function forwardRequestToSupabase(
	path: string,
	method: string,
	url: URL,
	request: Request,
	jsonBody: string | null,
	config: SupabaseConfig
): Promise<Response> {
	const supaUrl = `${config.supabaseUrl}${path}${url.search}`;
	logger.info(`Proxying request to Supabase: ${supaUrl}`, 'Proxy');

	try {
		// Log request headers (but redact sensitive info)
		logRequestHeaders(request);

		// Make request to Supabase with service role key
		const proxied = await fetch(supaUrl, {
			method,
			headers: {
				Authorization: `Bearer ${config.serviceRoleKey}`,
				'Content-Type': request.headers.get('Content-Type') ?? 'application/json',
				Prefer: request.headers.get('Prefer') ?? 'return=representation',
				apikey: config.serviceRoleKey, // Add the apikey header for Supabase REST API
			},
			body: ['GET', 'HEAD'].includes(method) ? undefined : jsonBody!,
		});

		logger.info(`Supabase response status: ${proxied.status} ${proxied.statusText}`, 'Proxy');

		// For error responses, log more details
		if (!proxied.ok) {
			logErrorResponseBody(proxied.clone());
		}

		return makeProxyResponse(proxied);
	} catch (err) {
		logger.error(`Error fetching from Supabase: ${err}`, 'Proxy');
		return createErrorResponse('Failed to fetch data from database', err instanceof Error ? err.message : 'Unknown error', 500);
	}
}

/**
 * Handle protected routes that require JWT verification
 *
 * @param path - The request path
 * @param method - The HTTP method
 * @param request - The incoming HTTP request
 * @param url - The parsed URL
 * @param jsonBody - The request body as a string
 * @param config - Supabase configuration
 * @returns HTTP response
 */
export async function handleProtectedRoute(
	path: string,
	method: string,
	request: Request,
	url: URL,
	jsonBody: string | null,
	config: SupabaseConfig
): Promise<Response | null> {
	// Only handle database routes
	if (!path.startsWith('/rest/v1')) {
		return null;
	}

	logger.info(`Processing protected route: ${path}`, 'Auth');

	// Verify JWT token
	try {
		await verifyAuthToken(request, config);
		// Forward request to Supabase if token is valid
		return forwardRequestToSupabase(path, method, url, request, jsonBody, config);
	} catch (err) {
		return handleJwtVerificationError(err);
	}
}
