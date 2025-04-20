import { logger } from './logging';
import { Env, SupabaseConfig } from './types';
import { parseAndLogRequestBody, createErrorResponse } from './helpers/http';
import { handleAuthRoutes } from './routes/auth';
import { handleUpstreamRoute } from './routes/gateway';

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

			// Create a configuration object to pass around
			const config: SupabaseConfig = {
				supabaseUrl: SUPABASE_URL,
				serviceRoleKey: SUPABASE_SERVICE_ROLE_KEY,
				anonKey: SUPABASE_ANON_KEY,
				jwtSecret: SUPABASE_JWT_SECRET,
				jwkUrl: JWK_URL,
			};

			// Parse and sanitize request body for logging if applicable
			const jsonBody = await parseAndLogRequestBody(request, method);

			// Router: Direct requests to appropriate handlers based on path

			// 1. Authentication endpoints - special case, direct proxy to Supabase auth
			const authResponse = await handleAuthRoutes(path, method, request, config, jsonBody);
			if (authResponse) {
				return authResponse;
			}

			// 2. General routing based on X-Upstream header
			logger.info('Handling request via X-Upstream gateway', 'Router');
			return await handleUpstreamRoute(path, method, request, url, jsonBody, env);
		} catch (err) {
			logger.error(`Unexpected error in worker: ${err}`, 'App');
			return createErrorResponse('Internal server error', err instanceof Error ? err.message : 'Unknown error', 500);
		}
	},
};
