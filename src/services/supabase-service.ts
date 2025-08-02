import { logger } from '../core/logging';
import { SupabaseConfig } from '../core/types';
import { createErrorResponse, makeProxyResponse, logErrorResponseBody } from '../helpers/http';
import { validateAcademicCredentials } from './siga-service';

/**
 * Finds a Supabase user by academic username (constructs email from username)
 * @param academicUsername - Student code (e.g., "0812024054")
 * @param supabaseConfig - Supabase configuration
 * @returns Promise<{userId: string | null, message: string}> - User ID if found, null otherwise
 */
async function _findUserByAcademicUsername(
	academicUsername: string,
	supabaseConfig: SupabaseConfig
): Promise<{ userId: string | null; message: string }> {
	const email = `${academicUsername}@sigapp.dev`;
	const endpoint = `${supabaseConfig.url}/rest/v1/users?select=id&email=eq.${encodeURIComponent(email)}`;

	logger.info(`Looking up user with email: ${email}`, 'PasswordReset');
	logger.debug(`Using endpoint: ${endpoint}`, 'PasswordReset');

	try {
		const response = await fetch(endpoint, {
			method: 'GET',
			headers: {
				'Content-Type': 'application/json',
				apikey: supabaseConfig.serviceRoleKey,
				Authorization: `Bearer ${supabaseConfig.serviceRoleKey}`,
			},
		});

		logger.info(`REST API response status: ${response.status} ${response.statusText}`, 'PasswordReset');

		if (!response.ok) {
			// Try to get error details from response body
			let errorDetails = response.statusText;
			try {
				const errorBody = await response.text();
				if (errorBody) {
					logger.error(`REST API error body: ${errorBody}`, 'PasswordReset');
					errorDetails = `${response.statusText} - ${errorBody}`;
				}
			} catch (bodyError) {
				logger.debug(`Could not read error body: ${bodyError}`, 'PasswordReset');
			}

			logger.error(`Error fetching user from ${endpoint}: ${response.status} ${errorDetails}`, 'PasswordReset');
			return {
				userId: null,
				message: `Failed to search for user: ${response.status} ${errorDetails}`,
			};
		}

		const users = (await response.json()) as Array<{ id: string }>;
		logger.debug(`Found ${users.length} users in REST API response`, 'PasswordReset');

		if (users.length === 0) {
			logger.warn(`No user found with email: ${email}`, 'PasswordReset');
			return {
				userId: null,
				message: `No user found with academic username ${academicUsername} (email: ${email})`,
			};
		}

		// Here we have the exact uid
		const userId = users[0].id;
		logger.info(`Found user ${userId} for academic username ${academicUsername}`, 'PasswordReset');

		return {
			userId,
			message: `User found: ${userId}`,
		};
	} catch (error) {
		logger.error(`Error searching for user at ${endpoint}: ${error}`, 'PasswordReset');
		return {
			userId: null,
			message: `Error searching for user: ${error instanceof Error ? error.message : String(error)}`,
		};
	}
}

/**
 * Updates a user's password in Supabase using admin privileges
 * @param userId - Supabase user ID
 * @param newPassword - New password to set
 * @param supabaseConfig - Supabase configuration
 * @returns Response from Supabase Admin API
 */
async function _updateUserPassword(userId: string, newPassword: string, supabaseConfig: SupabaseConfig): Promise<Response> {
	logger.info(`Updating password for user ${userId} in Supabase`, 'PasswordReset');

	const response = await fetch(`${supabaseConfig.url}/auth/v1/admin/users/${userId}`, {
		method: 'PUT',
		headers: {
			'Content-Type': 'application/json',
			apikey: supabaseConfig.serviceRoleKey,
			Authorization: `Bearer ${supabaseConfig.serviceRoleKey}`,
		},
		body: JSON.stringify({ password: newPassword }),
	});

	logger.info(`Supabase admin response status: ${response.status} ${response.statusText}`, 'PasswordReset');

	// Log error details but don't interpret them - just pass through transparently
	if (!response.ok) {
		logErrorResponseBody(response.clone());
	} else {
		logger.info(`Password successfully updated for user ${userId}`, 'PasswordReset');
	}

	return response;
}

/**
 * Main handler for verifying if a user exists by academic username
 * @param jsonBody - Request body as string or null
 * @param supabaseConfig - Supabase configuration
 * @returns Response with user existence information
 */
export async function handleVerifyUserExists(jsonBody: string | null, supabaseConfig: SupabaseConfig): Promise<Response> {
	try {
		// Validate required fields
		if (!jsonBody) {
			return createErrorResponse('Bad Request', 'Request body is required', 400);
		}

		let requestBody;
		try {
			requestBody = JSON.parse(jsonBody);
		} catch (parseError) {
			return createErrorResponse('Bad Request', 'Invalid JSON in request body', 400);
		}

		if (!requestBody.academicUsername) {
			return createErrorResponse('Bad Request', 'Missing required field: academicUsername is required', 400);
		}

		const { academicUsername } = requestBody;

		// Find user by academic username
		logger.info(`Verifying user existence for academic username: ${academicUsername}`, 'UserVerification');
		const { userId, message } = await _findUserByAcademicUsername(academicUsername, supabaseConfig);

		if (!userId) {
			logger.info(`User verification result: User not found - ${message}`, 'UserVerification');
			return new Response(
				JSON.stringify({
					exists: false,
					academicUsername,
					message,
				}),
				{
					status: 200,
					headers: { 'Content-Type': 'application/json' },
				}
			);
		}

		logger.info(`User verification result: User found - ${userId}`, 'UserVerification');
		return new Response(
			JSON.stringify({
				exists: true,
				academicUsername,
				userId,
				message: `User found with ID: ${userId}`,
			}),
			{
				status: 200,
				headers: { 'Content-Type': 'application/json' },
			}
		);
	} catch (error) {
		logger.error(`Error in user verification: ${error}`, 'UserVerification');
		return createErrorResponse('Service Unavailable', error instanceof Error ? error.message : `${error}`, 500);
	}
}

/**
 * Main handler for admin password reset with academic validation
 * @param jsonBody - Request body as string or null
 * @param supabaseConfig - Supabase configuration
 * @returns Response from Supabase or error response
 */
export async function handlePasswordReset(jsonBody: string | null, supabaseConfig: SupabaseConfig): Promise<Response> {
	try {
		// Validate required fields
		if (!jsonBody) {
			return createErrorResponse('Bad Request', 'Request body is required', 400);
		}

		let requestBody;
		try {
			requestBody = JSON.parse(jsonBody);
		} catch (parseError) {
			return createErrorResponse('Bad Request', 'Invalid JSON in request body', 400);
		}

		if (!requestBody.academicUsername || !requestBody.academicPassword) {
			return createErrorResponse('Bad Request', 'Missing required fields: academicUsername and academicPassword are required', 400);
		}

		const { academicUsername, academicPassword } = requestBody;

		// Step 1: Find user by academic username
		logger.info(`Starting password reset for academic username: ${academicUsername}`, 'PasswordReset');
		const { userId, message: userMessage } = await _findUserByAcademicUsername(academicUsername, supabaseConfig);

		if (!userId) {
			logger.warn(`User lookup failed: ${userMessage}`, 'PasswordReset');
			return createErrorResponse('Not Found', userMessage, 404);
		}

		// Step 2: Validate academic credentials
		logger.info(`Attempting academic validation for user ${userId}`, 'PasswordReset');
		try {
			const { isValid, message } = await validateAcademicCredentials(academicUsername, academicPassword);
			if (!isValid) {
				logger.warn(`Academic validation failed for user ${userId}: ${message}`, 'PasswordReset');
				return createErrorResponse('Unauthorized', message, 401);
			}
		} catch (error) {
			logger.error(`Error validating academic credentials for user ${userId}: ${error}`, 'PasswordReset');
			return createErrorResponse('Academic Validation Error', error instanceof Error ? error.message : `${error}`, 500);
		}

		logger.info(`Academic validation successful for user ${userId}`, 'PasswordReset');

		// Step 3: Update password in Supabase
		const response = await _updateUserPassword(userId, academicPassword, supabaseConfig);

		// Always return the response transparently, whether success or error
		return makeProxyResponse(response);
	} catch (error) {
		logger.error(`Error in admin password reset: ${error}`, 'PasswordReset');
		return createErrorResponse('Service Unavailable', error instanceof Error ? error.message : `${error}`, 500);
	}
}
