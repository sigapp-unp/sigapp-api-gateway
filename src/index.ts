import { verifyJwt } from './jwt';
import { logger } from './logging';

/**
 * Environment variables required for the worker
 */
export interface Env {
	/** Base URL of the Supabase instance (with or without protocol) */
	SUPABASE_URL: string;
	/** Service role key with admin access (keep secure, never expose to clients) */
	SUPABASE_SERVICE_ROLE_KEY: string;
	/** Anonymous key for public authentication endpoints */
	SUPABASE_ANON_KEY: string;
	/** JWT secret used for token verification with HS256 algorithm */
	SUPABASE_JWT_SECRET: string;
}

/**
 * Helper function to safely truncate a token for logging
 * Shows first 5 and last 5 characters, replacing the middle with "..."
 *
 * @param token - The JWT token to truncate
 * @returns The truncated token string, safe for logging
 */
function truncateToken(token: string): string {
	if (!token) return '';
	// Show first 5 and last 5 characters
	return token.length > 15 ? `${token.substring(0, 5)}...${token.substring(token.length - 5)}` : token;
}

export default {
	/**
	 * Main handler for all requests to the worker
	 * Routes requests to appropriate handlers based on path
	 *
	 * @param request - The incoming HTTP request
	 * @param env - Environment variables
	 * @returns HTTP response
	 */
	async fetch(request: Request, env: Env): Promise<Response> {
		try {
			let { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY, SUPABASE_JWT_SECRET } = env;

			// Normalize Supabase URL (add protocol if missing, remove trailing slash)
			if (!SUPABASE_URL.startsWith('http://') && !SUPABASE_URL.startsWith('https://')) {
				SUPABASE_URL = `https://${SUPABASE_URL}`;
			}
			if (SUPABASE_URL.endsWith('/')) {
				SUPABASE_URL = SUPABASE_URL.slice(0, -1);
			}

			// Create essential URLs and extract request details
			const JWK_URL = `${SUPABASE_URL}/auth/v1/.well-known/jwks.json`;
			const url = new URL(request.url);
			const path = url.pathname;
			const method = request.method;

			// Log request details
			logger.info(`Processing ${method} request to ${path}`, 'Router');
			logger.debug(`Using Supabase URL: ${SUPABASE_URL}`, 'Config');

			// Validate required environment variables
			if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !SUPABASE_ANON_KEY) {
				logger.error('Missing essential environment variables', 'Config');
				return createErrorResponse('Server configuration error', 'Missing environment variables', 500);
			}

			// Parse and sanitize request body for logging if applicable
			const jsonBody = await parseAndLogRequestBody(request, method);

			// Router: Direct requests to appropriate handlers based on path

			// 1. Authentication endpoints
			if (path === '/auth/signup' && method === 'POST') {
				return proxyAuth(`${SUPABASE_URL}/auth/v1/signup`);
			}
			if (path === '/auth/login' && method === 'POST') {
				return proxyAuth(`${SUPABASE_URL}/auth/v1/token?grant_type=password`);
			}
			if (path === '/auth/refresh' && method === 'POST') {
				return proxyAuth(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`);
			}
			if (path === '/auth/user' && method === 'GET') {
				const authHeader = request.headers.get('Authorization') || '';
				if (!authHeader) return createErrorResponse('Missing Authorization header', undefined, 401);
				return proxyAuth(`${SUPABASE_URL}/auth/v1/user`, authHeader);
			}

			// 2. Protected database routes
			if (path.startsWith('/rest/v1')) {
				return handleProtectedRoute(
					path,
					method,
					request,
					url,
					SUPABASE_URL,
					SUPABASE_SERVICE_ROLE_KEY,
					SUPABASE_JWT_SECRET,
					JWK_URL,
					jsonBody
				);
			}

			// 3. Default: Route not found
			logger.warn(`Route not found: ${path}`, 'Router');
			return createErrorResponse('Not Found', `Route ${path} does not exist`, 404);

			/**
			 * Proxies authentication requests to Supabase Auth API
			 *
			 * @param endpoint - The Supabase Auth endpoint to call
			 * @param authHeader - Optional Authorization header to pass through
			 * @returns Response from Supabase Auth API
			 */
			async function proxyAuth(endpoint: string, authHeader?: string): Promise<Response> {
				try {
					logger.info(`Proxying auth request to: ${endpoint}`, 'Auth');

					// Validate URL before fetching
					validateUrl(endpoint);

					// Prepare headers for auth request
					const headers: Record<string, string> = {
						'Content-Type': 'application/json',
						apikey: SUPABASE_ANON_KEY,
						'X-Client-Info': 'sigapp-proxy',
					};

					if (authHeader) {
						headers['Authorization'] = authHeader;
						logger.debug(
							`Using provided Authorization header: ${authHeader.startsWith('Bearer') ? 'Bearer [REDACTED]' : '[REDACTED]'}`,
							'Auth'
						);
					}

					logger.debug(`Auth request method: ${method}`, 'Auth');

					// Make request to Supabase Auth API
					const response = await fetch(endpoint, {
						method,
						headers,
						body: ['GET', 'HEAD'].includes(method) ? undefined : jsonBody!,
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
		} catch (err) {
			logger.error(`Unexpected error in worker: ${err}`, 'App');
			return createErrorResponse('Internal server error', err instanceof Error ? err.message : 'Unknown error', 500);
		}
	},
};

/**
 * Parse the request body and log a sanitized version (without sensitive data)
 *
 * @param request - The incoming HTTP request
 * @param method - The HTTP method
 * @returns The parsed request body as a string, or null if not applicable
 */
async function parseAndLogRequestBody(request: Request, method: string): Promise<string | null> {
	const jsonBody = ['POST', 'PATCH', 'PUT'].includes(method) ? await request.text() : null;

	if (jsonBody) {
		try {
			// Parse JSON to validate it and create a sanitized version for logging
			const parsedBody = JSON.parse(jsonBody);
			const sanitizedBody = { ...parsedBody };

			// Redact sensitive fields
			if (sanitizedBody.password) sanitizedBody.password = '********';
			if (sanitizedBody.email) sanitizedBody.email = sanitizedBody.email.replace(/^(.{3})(.*)(@.*)$/, '$1****$3');

			logger.debug(`Request body: ${JSON.stringify(sanitizedBody)}`, 'Request');
		} catch (e) {
			logger.warn(`Unable to parse request body as JSON: ${e}`, 'Parser');
		}
	}

	return jsonBody;
}

/**
 * Handle protected routes that require JWT verification
 *
 * @param path - The request path
 * @param method - The HTTP method
 * @param request - The incoming HTTP request
 * @param url - The parsed URL
 * @param supabaseUrl - The Supabase URL
 * @param serviceRoleKey - The service role key
 * @param jwtSecret - The JWT secret
 * @param jwkUrl - The JWKS URL
 * @param jsonBody - The request body as a string
 * @returns HTTP response
 */
async function handleProtectedRoute(
	path: string,
	method: string,
	request: Request,
	url: URL,
	supabaseUrl: string,
	serviceRoleKey: string,
	jwtSecret: string,
	jwkUrl: string,
	jsonBody: string | null
): Promise<Response> {
	logger.info(`Processing protected route: ${path}`, 'Auth');

	// Extract and validate token from Authorization header
	const authHeader = request.headers.get('Authorization') || '';
	const token = authHeader.replace('Bearer ', '').trim();

	if (!token) {
		logger.error('Missing Authorization token', 'Auth');
		return createErrorResponse('Unauthorized', 'Missing Authorization token', 401);
	}

	logger.debug(`Received token: ${truncateToken(token)}`, 'Auth');

	// Verify JWT token
	try {
		logger.debug(`Verifying JWT against ${jwkUrl}`, 'Auth');
		const payload = await verifyJwt({
			token,
			jwkUrl,
			jwtSecret,
		});
		logger.info('JWT verification succeeded', 'Auth');

		// Log useful info from the payload (with PII redaction)
		logJwtPayload(payload);

		// Forward request to Supabase
		return forwardRequestToSupabase(path, method, url, supabaseUrl, serviceRoleKey, request, jsonBody);
	} catch (err) {
		return handleJwtVerificationError(err);
	}
}

/**
 * Log JWT payload information with PII redaction
 *
 * @param payload - The JWT payload
 */
function logJwtPayload(payload: any): void {
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
function handleJwtVerificationError(err: unknown): Response {
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
 * Forward authenticated requests to Supabase with service role key
 *
 * @param path - The request path
 * @param method - The HTTP method
 * @param url - The parsed URL
 * @param supabaseUrl - The Supabase URL
 * @param serviceRoleKey - The service role key
 * @param request - The original HTTP request
 * @param jsonBody - The request body as a string
 * @returns HTTP response from Supabase
 */
async function forwardRequestToSupabase(
	path: string,
	method: string,
	url: URL,
	supabaseUrl: string,
	serviceRoleKey: string,
	request: Request,
	jsonBody: string | null
): Promise<Response> {
	const supaUrl = `${supabaseUrl}${path}${url.search}`;
	logger.info(`Proxying request to Supabase: ${supaUrl}`, 'Proxy');

	try {
		// Log request headers (but redact sensitive info)
		logRequestHeaders(request);

		// Make request to Supabase with service role key
		const proxied = await fetch(supaUrl, {
			method,
			headers: {
				Authorization: `Bearer ${serviceRoleKey}`,
				'Content-Type': request.headers.get('Content-Type') ?? 'application/json',
				Prefer: request.headers.get('Prefer') ?? 'return=representation',
				apikey: serviceRoleKey, // Add the apikey header for Supabase REST API
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
 * Log request headers with sensitive information redacted
 *
 * @param request - The HTTP request
 */
function logRequestHeaders(request: Request): void {
	const headersLog = Array.from(request.headers.entries())
		.filter(([key]) => !['authorization', 'cookie'].includes(key.toLowerCase()))
		.reduce((obj, [key, value]) => ({ ...obj, [key]: value }), {});

	logger.debug(`Request headers: ${JSON.stringify(headersLog)}`, 'Proxy');
}

/**
 * Try to log the body of an error response
 *
 * @param response - The HTTP response to log
 */
async function logErrorResponseBody(response: Response): Promise<void> {
	try {
		const errorBody = await response.text();
		logger.error(`Error response: ${errorBody}`, 'Response');
	} catch (err) {
		logger.error('Could not read error response body', 'Response');
	}
}

/**
 * Log information about issued tokens without exposing the tokens themselves
 *
 * @param response - Auth response containing tokens
 */
async function logTokenIssuance(response: Response): Promise<void> {
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
 * Validate a URL before using it for network requests
 *
 * @param url - The URL to validate
 * @throws Error if URL is invalid
 */
function validateUrl(url: string): void {
	try {
		new URL(url);
	} catch (urlError) {
		logger.error(`Invalid URL: ${url}`, 'Validation');
		throw new Error(`Invalid URL: ${url}`);
	}
}

/**
 * Create a standardized error response
 *
 * @param error - The error type/name
 * @param message - The error message
 * @param status - The HTTP status code
 * @param details - Optional additional error details
 * @returns HTTP error response
 */
function createErrorResponse(error: string, message?: string, status: number = 500, details?: string): Response {
	return new Response(
		JSON.stringify({
			error,
			message,
			details,
		}),
		{
			status,
			headers: { 'Content-Type': 'application/json' },
		}
	);
}

/**
 * Transform a response from Supabase to be returned to the client
 *
 * @param res - The response from Supabase
 * @returns The response to send to the client
 */
function makeProxyResponse(res: Response): Response {
	const headers = new Headers(res.headers);
	headers.set('Content-Type', 'application/json');

	// Preserve the responses and their statuses, both for success and error
	return new Response(res.body, {
		status: res.status,
		statusText: res.statusText,
		headers,
	});
}
