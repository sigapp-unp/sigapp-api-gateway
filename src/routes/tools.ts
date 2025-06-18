import { logger } from '../logging';
import { SupabaseConfig } from '../types';
import { createErrorResponse } from '../helpers/http';
import { handlePasswordReset, handleVerifyUserExists } from '../helpers/external-services';

/**
 * Handles tools-related requests (password reset, academic validation, etc.)
 *
 * @param requestUrl - The URL
 * @param request - The incoming HTTP request
 * @param jsonBody - The request body as a string
 * @param supabaseConfig - Supabase configuration
 * @returns Response from appropriate tool handler
 */
export async function handleToolsRoute({
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
		// Route: POST /tools/password-reset
		if (requestUrl.pathname === '/tools/password-reset' && request.method === 'POST') {
			logger.info(`Handling password reset request`, 'Tools');
			return await handlePasswordReset(jsonBody, supabaseConfig);
		}

		// Route: POST /tools/verify-user-exists
		if (requestUrl.pathname === '/tools/verify-user-exists' && request.method === 'POST') {
			logger.info(`Handling user verification request`, 'Tools');
			return await handleVerifyUserExists(jsonBody, supabaseConfig);
		}

		// Add more tools here in the future:
		// - Academic validation only
		// - User lookup by academic username
		// - Bulk operations
		// etc.

		// If no route matches, return 404
		logger.warn(`Unknown tools route: ${request.method} ${requestUrl.pathname}`, 'Tools');
		return createErrorResponse('Not Found', `Tool endpoint not found: ${request.method} ${requestUrl.pathname}`, 404);
	} catch (err) {
		logger.error(`Error in tools route: ${err}`, 'Tools');
		return createErrorResponse('Internal Server Error', err instanceof Error ? err.message : 'Unknown error', 500);
	}
}
