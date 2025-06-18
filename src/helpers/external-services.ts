import { logger } from '../logging';
import { SupabaseConfig } from '../types';
import { createErrorResponse, makeProxyResponse, logErrorResponseBody } from './http';

/**
 * Finds a Supabase user by academic username (constructs email from username)
 * @param academicUsername - Student code (e.g., "0812024054")
 * @param supabaseConfig - Supabase configuration
 * @returns Promise<{userId: string | null, message: string}> - User ID if found, null otherwise
 */
async function findUserByAcademicUsername(
	academicUsername: string,
	supabaseConfig: SupabaseConfig
): Promise<{ userId: string | null; message: string }> {
	const email = `${academicUsername}@sigapp.dev`;
	logger.info(`Looking up user with email: ${email}`, 'PasswordReset');

	try {
		const response = await fetch(`${supabaseConfig.url}/auth/v1/admin/users?email=${encodeURIComponent(email)}`, {
			method: 'GET',
			headers: {
				'Content-Type': 'application/json',
				apikey: supabaseConfig.serviceRoleKey,
				Authorization: `Bearer ${supabaseConfig.serviceRoleKey}`,
			},
		});

		if (!response.ok) {
			logger.error(`Failed to search user: ${response.status} ${response.statusText}`, 'PasswordReset');
			return {
				userId: null,
				message: `Failed to search for user: ${response.statusText}`,
			};
		}

		const data = (await response.json()) as { users?: Array<{ id: string; email: string }> };

		if (!data.users || data.users.length === 0) {
			logger.warn(`No user found with email: ${email}`, 'PasswordReset');
			return {
				userId: null,
				message: `No user found with academic username ${academicUsername} (email: ${email})`,
			};
		}

		const userId = data.users[0].id;
		logger.info(`Found user ${userId} for academic username ${academicUsername}`, 'PasswordReset');

		return {
			userId,
			message: `User found: ${userId}`,
		};
	} catch (error) {
		logger.error(`Error searching for user: ${error}`, 'PasswordReset');
		return {
			userId: null,
			message: `Error searching for user: ${error instanceof Error ? error.message : String(error)}`,
		};
	}
}

/**
 * Validates academic credentials against the external UNP system
 * @param username - Student code
 * @param password - Student password
 * @returns Promise<{isValid: boolean, message: string}> - Validation result with details
 */
async function validateAcademicCredentials(
	username: string,
	password: string
): Promise<{
	isValid: boolean;
	message: string;
}> {
	const formData = new URLSearchParams({
		Instancia: '01',
		CodAlumno: username,
		ClaveWeb: password,
		'g-recaptcha-response': '',
	});

	logger.info(`Validating academic credentials for student: ${username}`, 'PasswordReset');

	const baseUrl = 'https://academico.unp.edu.pe';
	const response = await fetch(`${baseUrl}/`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/x-www-form-urlencoded',
			Origin: baseUrl,
			Referer: `${baseUrl}/`,
		},
		body: formData.toString(),
		redirect: 'manual', // Don't follow redirects, we want to check for 302
	});

	logger.info(`Academic validation response status: ${response.status}`, 'PasswordReset');

	// Only 302 Found indicates successful authentication
	const locationHeader = response.headers.get('Location');
	return {
		isValid: response.status === 302,
		message: `Academic validation returned status ${response.status} and ${
			locationHeader ? `redirected to "${locationHeader}"` : 'no redirect location'
		}`,
	};
}

/**
 * Updates a user's password in Supabase using admin privileges
 * @param userId - Supabase user ID
 * @param newPassword - New password to set
 * @param supabaseConfig - Supabase configuration
 * @returns Response from Supabase Admin API
 */
async function updateUserPassword(userId: string, newPassword: string, supabaseConfig: SupabaseConfig): Promise<Response> {
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
		const { userId, message: userMessage } = await findUserByAcademicUsername(academicUsername, supabaseConfig);

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
		const response = await updateUserPassword(userId, academicPassword, supabaseConfig);

		// Always return the response transparently, whether success or error
		return makeProxyResponse(response);
	} catch (error) {
		logger.error(`Error in admin password reset: ${error}`, 'PasswordReset');
		return createErrorResponse('Service Unavailable', error instanceof Error ? error.message : `${error}`, 500);
	}
}
