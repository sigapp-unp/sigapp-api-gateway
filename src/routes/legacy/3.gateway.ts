import { logger } from '../../core/logging';
import { Env } from '../../core/types';
import { createErrorResponse, makeProxyResponse, logRequestHeaders, logErrorResponseBody } from '../../helpers/http';
import { getUpstreamConfig, UpstreamConfig } from '../../core/config/gateway-config';

/**
 * Forward requests to an upstream service based on the X-Upstream header
 *
 * @param request - The original HTTP request
 * @param requestUrl - The parsed URL
 * @param jsonBody - The request body as a string
 * @param env - Environment variables
 * @returns HTTP response
 */
export async function handleUpstreamRoute({
	requestUrl,
	request,
	jsonBody,
	env,
}: {
	request: Request;
	requestUrl: URL;
	jsonBody: string | null;
	env: Env;
}): Promise<Response> {
	// Get the upstream service from header
	const upstreamService = request.headers.get('X-Upstream');

	if (!upstreamService) {
		logger.error('Missing X-Upstream header', 'Gateway');
		return createErrorResponse('Bad Request', 'Missing X-Upstream header', 400);
	}

	try {
		// Get configuration for the specified upstream service
		const upstreamConfig = getUpstreamConfig(upstreamService, env);
		logger.info(`Routing to upstream service: ${upstreamService}`, 'Gateway');

		// Forward the request to the appropriate upstream service
		return await forwardRequestToUpstream(request.method, request, requestUrl, jsonBody, upstreamConfig);
	} catch (err) {
		logger.error(`Error handling upstream route: ${err}`, 'Gateway');

		if (err instanceof Error && err.message.includes('not configured')) {
			return createErrorResponse('Bad Request', `Invalid upstream service: ${upstreamService}`, 400);
		}

		return createErrorResponse('Gateway Error', err instanceof Error ? err.message : 'Unknown error', 500);
	}
}

/**
 * Forward a request to an upstream service
 *
 * @param path - The request path
 * @param method - The HTTP method
 * @param request - The original HTTP request
 * @param url - The parsed URL
 * @param jsonBody - The request body as a string
 * @param upstreamConfig - Configuration for the upstream service
 * @returns HTTP response from the upstream service
 */
async function forwardRequestToUpstream(
	method: string,
	request: Request,
	url: URL,
	jsonBody: string | null,
	upstreamConfig: UpstreamConfig
): Promise<Response> {
	// Construct the upstream URL - append the path and search params to the base URL
	const upstreamUrl = `${upstreamConfig.baseUrl}${url.pathname}${url.search}`;
	logger.info(`Proxying request to: ${upstreamUrl}`, 'Gateway');

	try {
		// Log request headers (but redact sensitive info)
		logRequestHeaders(request);

		// Create headers for the upstream request
		// First copy all original headers from the request to preserve them
		const headers = new Headers();

		// Copy all original headers from the request
		for (const [key, value] of request.headers.entries()) {
			headers.set(key, value);
		}

		// Ensure content type is set properly
		if (!headers.has('Content-Type') && jsonBody) {
			headers.set('Content-Type', 'application/json');
		}

		// Add or override with headers defined in the upstream configuration
		// This patches the existing headers rather than replacing them completely
		for (const [key, value] of Object.entries(upstreamConfig.headers)) {
			headers.set(key, value);
		}

		logger.debug(`Final request headers (after patching): ${JSON.stringify(Object.fromEntries(headers.entries()))}`, 'Gateway');

		// Make request to upstream service
		const response = await fetch(upstreamUrl, {
			method,
			headers,
			body: ['GET', 'HEAD'].includes(method) ? undefined : jsonBody,
		});

		logger.info(`Upstream response status: ${response.status} ${response.statusText}`, 'Gateway');

		// For error responses, log more details
		if (!response.ok) {
			logErrorResponseBody(response.clone());
		}

		return makeProxyResponse(response);
	} catch (err) {
		logger.error(`Error fetching from upstream service: ${err}`, 'Gateway');
		return createErrorResponse('Gateway Error', err instanceof Error ? err.message : 'Unknown error', 502);
	}
}
