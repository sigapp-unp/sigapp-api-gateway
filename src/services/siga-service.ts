import { logger } from '../core/logging';

const BASE_URL = 'https://academico.unp.edu.pe';

/**
 * Validates academic credentials against the external UNP system
 * @param username - Student code
 * @param password - Student password
 * @returns Promise<{isValid: boolean, message: string}> - Validation result with details
 */
export async function validateAcademicCredentials(
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

	const response = await fetch(`${BASE_URL}/`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/x-www-form-urlencoded',
			Origin: BASE_URL,
			Referer: `${BASE_URL}/`,
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
