import { logger } from './logging';
import { Env, SupabaseConfig } from './types';
import { parseAndLogRequestBody, createErrorResponse } from './helpers/http';
import { handleAuthRoute } from './routes/auth';
import { handleToolsRoute } from './routes/tools';
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
			// Create a configuration object to pass around
			let { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY, SUPABASE_JWT_SECRET } = env;
			const JWK_URL = `${SUPABASE_URL}/auth/v1/.well-known/jwks.json`;
			const supabaseConfig: SupabaseConfig = {
				url: SUPABASE_URL,
				serviceRoleKey: SUPABASE_SERVICE_ROLE_KEY,
				anonKey: SUPABASE_ANON_KEY,
				jwtSecret: SUPABASE_JWT_SECRET,
				jwkUrl: JWK_URL,
			};

			const requestUrl = new URL(request.url);

			// Log request details
			logger.info(`Processing ${request.method} request to ${requestUrl.pathname}`, 'Router');
			logger.debug(`Using Supabase URL: ${supabaseConfig.url}`, 'Config');

			// Validate required environment variables
			if (!supabaseConfig.url || !supabaseConfig.serviceRoleKey || !supabaseConfig.anonKey) {
				logger.error('Missing essential environment variables', 'Config');
				return createErrorResponse('Server configuration error', 'Missing environment variables', 500);
			}

			// Parse and sanitize request body for logging if applicable
			const jsonBody = await parseAndLogRequestBody(request, request.method);

			// Router: Direct requests to appropriate handlers based on path

			// 1. Tools endpoints - custom functionality like password reset, academic validation
			if (requestUrl.pathname.startsWith('/tools/')) {
				logger.info(`Handling tools route: ${requestUrl.pathname}`, 'Tools');
				return await handleToolsRoute({ requestUrl, request, jsonBody, supabaseConfig });
			}

			// 2. Authentication endpoints - direct proxy to Supabase auth
			if (requestUrl.pathname.startsWith('/auth/')) {
				logger.info(`Handling auth route: ${requestUrl.pathname}`, 'Auth');
				return await handleAuthRoute({ requestUrl, request, jsonBody, supabaseConfig });
			}

			// 3. General routing based on X-Upstream header
			logger.info('Handling request via X-Upstream gateway', 'Router');
			return await handleUpstreamRoute({ request, requestUrl, jsonBody, env });
		} catch (err) {
			logger.error(`Unexpected error in worker: ${err}`, 'App');
			return createErrorResponse('Internal server error', err instanceof Error ? err.message : 'Unknown error', 500);
		}
	},
};
