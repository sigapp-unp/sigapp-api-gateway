import { logger } from './core/logging';
import { Env, SupabaseConfig } from './core/types';
import { parseAndLogRequestBody, createErrorResponse } from './helpers/http';
import { handleAuthRoute } from './routes/legacy/2.auth';
import { handleToolsRoute } from './routes/legacy/1.tools';
import { handleUpstreamRoute } from './routes/legacy/3.gateway';
import { createSupabaseConfig } from './core/config/supabase-config';

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
			const requestUrl = new URL(request.url);
			const jsonBody = await parseAndLogRequestBody(request, request.method);
			logger.info(`Processing ${request.method} request to ${requestUrl.pathname}`, 'Router');

			// Router: Direct requests to appropriate handlers based on path

			// Tools
			if (requestUrl.pathname.startsWith('/tools/')) {
				logger.info(`Handling tools route: ${requestUrl.pathname}`, 'Tools');
				const supabaseConfig = createSupabaseConfig(env);
				return await handleToolsRoute({ requestUrl, request, jsonBody, supabaseConfig });
			}

			// Supabase authentication - direct proxy to Supabase auth
			if (requestUrl.pathname.startsWith('/auth/')) {
				logger.info(`Handling auth route: ${requestUrl.pathname}`, 'Auth');
				const supabaseConfig = createSupabaseConfig(env);
				return await handleAuthRoute({ requestUrl, request, jsonBody, supabaseConfig });
			}

			// General routing based on X-Upstream header
			logger.info('Handling request via X-Upstream gateway', 'Router');
			return await handleUpstreamRoute({ request, requestUrl, jsonBody, env });
		} catch (err) {
			logger.error(`Unexpected error in worker: ${err}`, 'App');
			return createErrorResponse('Internal server error', err instanceof Error ? err.message : 'Unknown error', 500);
		}
	},
};
