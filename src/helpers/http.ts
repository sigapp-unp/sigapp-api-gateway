import { logger } from '../core/logging';

/**
 * Helper function to safely truncate a token for logging
 * Shows first 5 and last 5 characters, replacing the middle with "..."
 *
 * @param token - The JWT token to truncate
 * @returns The truncated token string, safe for logging
 */
export function truncateToken(token: string): string {
	if (!token) return '';
	// Show first 5 and last 5 characters
	return token.length > 15 ? `${token.substring(0, 5)}...${token.substring(token.length - 5)}` : token;
}

/**
 * Parse the request body and log a sanitized version (without sensitive data)
 *
 * @param request - The incoming HTTP request
 * @param method - The HTTP method
 * @returns The parsed request body as a string, or null if not applicable
 */
export async function parseAndLogRequestBody(request: Request, method: string): Promise<string | null> {
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
 * Validate a URL before using it for network requests
 *
 * @param url - The URL to validate
 * @throws Error if URL is invalid
 */
export function validateUrl(url: string): void {
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
export function createErrorResponse(error: string, message?: string, status: number = 500, details?: string): Response {
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
export function makeProxyResponse(res: Response): Response {
	const headers = new Headers(res.headers);
	headers.set('Content-Type', 'application/json');

	// Preserve the responses and their statuses, both for success and error
	return new Response(res.body, {
		status: res.status,
		statusText: res.statusText,
		headers,
	});
}

/**
 * Log request headers with sensitive information redacted
 *
 * @param request - The HTTP request
 */
export function logRequestHeaders(request: Request): void {
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
export async function logErrorResponseBody(response: Response): Promise<void> {
	try {
		const errorBody = await response.text();
		logger.error(`Error response: ${errorBody}`, 'Response');
	} catch (err) {
		logger.error('Could not read error response body', 'Response');
	}
}
