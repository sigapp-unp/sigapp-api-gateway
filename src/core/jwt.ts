import { jwtVerify, importJWK, JWTPayload, type JWK } from 'jose';
import { logger } from './logging';

/**
 * In-memory cache for JSON Web Keys (JWK)
 * This prevents unnecessary network requests by storing keys after the first fetch
 */
let cachedJWK: Record<string, CryptoKey> | null = null;

/**
 * Fetches and processes JSON Web Keys (JWK) from a JWKS endpoint
 *
 * JWKS (JSON Web Key Set) is a set of public keys that can be used to verify
 * the signatures of JSON Web Tokens (JWTs). This function fetches these keys
 * and converts them into a format that can be used for cryptographic operations.
 *
 * @param jwkUrl - URL to the JWKS endpoint (usually ends with /.well-known/jwks.json)
 * @returns A record mapping key IDs to their corresponding CryptoKey objects
 */
export async function getJWKS(jwkUrl: string): Promise<Record<string, CryptoKey>> {
	logger.debug(`Attempting to fetch keys from: ${jwkUrl}`, 'JWKS');

	// Use cached keys if available to avoid unnecessary network requests
	if (cachedJWK) {
		logger.debug('Using cached keys', 'JWKS');
		return cachedJWK;
	}

	try {
		// Fetch the JWKS from the provided URL
		logger.debug(`Fetching from ${jwkUrl}`, 'JWKS');
		const res = await fetch(jwkUrl);

		// Check if the request was successful
		logger.debug(`Response status: ${res.status}`, 'JWKS');
		if (!res.ok) {
			const error = await res.text();
			logger.error(`Failed to fetch JWKS - Status: ${res.status}, Error: ${error}`, 'JWKS');
			throw new Error(`Failed to fetch JWKS: ${res.status} ${res.statusText}`);
		}

		// Parse the response as JSON
		const data = await res.json();
		logger.debug('Response data received', 'JWKS');

		// Extract the keys from the response
		const { keys } = data as { keys: JWK[] };
		if (!keys || keys.length === 0) {
			logger.error('No keys found in response', 'JWKS');
			throw new Error('No keys found');
		}

		logger.info(`Found ${keys.length} keys with ids: ${keys.map((k) => k.kid).join(', ')}`, 'JWKS');

		// Process each key and create a map of key IDs to CryptoKey objects
		const jwks: Record<string, CryptoKey> = {};
		for (const key of keys) {
			logger.debug(`Importing key with id: ${key.kid}`, 'JWKS');
			try {
				// Convert the JWK to a CryptoKey object using the jose library
				const cryptoKey = await importJWK(key, key.alg);
				if (cryptoKey instanceof CryptoKey) {
					jwks[key.kid!] = cryptoKey;
					logger.debug(`Successfully imported key: ${key.kid}`, 'JWKS');
				} else {
					logger.error(`Invalid key type for kid: ${key.kid}`, 'JWKS');
					throw new Error('Invalid key type returned by importJWK');
				}
			} catch (error) {
				logger.error(`Failed to import key ${key.kid}: ${error}`, 'JWKS');
				throw error;
			}
		}

		// Cache the keys for future use
		cachedJWK = jwks;
		logger.debug('Successfully cached keys', 'JWKS');
		return jwks;
	} catch (error) {
		logger.error(`Error in getJWKS: ${error}`, 'JWKS');
		throw error;
	}
}

/**
 * Verifies a JWT token using either a shared secret or public keys from JWKS
 *
 * This function attempts to verify a JWT token in two ways:
 * 1. First using the provided shared secret (SUPABASE_JWT_SECRET)
 * 2. If that fails, it attempts to verify using public keys from JWKS
 *
 * @param options - Object containing verification options
 * @param options.token - The JWT token to verify
 * @param options.jwkUrl - URL to the JWKS endpoint
 * @param options.jwtSecret - Shared secret for HS256 verification
 * @returns The decoded and verified JWT payload
 */
export async function verifyJwt({ token, jwkUrl, jwtSecret }: { token: string; jwkUrl: string; jwtSecret: string }): Promise<JWTPayload> {
	try {
		logger.debug('Starting JWT verification process', 'JWT');

		// Parse the JWT header to determine verification method
		const header = _parseJwtHeader(token);
		const { kid, alg } = header;

		// First try: Verify with shared secret (HS256)
		try {
			logger.debug('Attempting verification with shared secret', 'JWT');
			const secretKeyBytes = new TextEncoder().encode(jwtSecret);

			const { payload } = await jwtVerify(token, secretKeyBytes, {
				algorithms: alg ? [alg] : undefined,
			});

			logger.info('Verification with shared secret successful', 'JWT');
			_logTokenExpiration(payload);
			return payload;
		} catch (hsError) {
			logger.warn(`Shared secret verification failed: ${hsError}`, 'JWT');

			// Second try: Use JWKS (public key) verification if token has a key ID
			if (kid && alg !== 'HS256') {
				logger.debug(`Attempting JWKS verification with key ID: ${kid}`, 'JWT');

				const jwks = await getJWKS(jwkUrl);
				logger.debug(`Available key IDs: ${Object.keys(jwks).join(', ')}`, 'JWT');

				const key = jwks[kid];
				if (!key) {
					logger.error(`No matching key found for kid: ${kid}`, 'JWT');
					throw new Error(`Invalid kid: ${kid} not found in JWKS`);
				}

				logger.debug(`Found matching key, verifying signature...`, 'JWT');
				const { payload } = await jwtVerify(token, key);

				logger.info('JWKS verification successful', 'JWT');
				_logTokenExpiration(payload);
				return payload;
			}

			// If we're here, both methods failed
			throw new Error('Token verification failed. Ensure the provided secret is correct.');
		}
	} catch (error) {
		logger.error(`JWT verification failed: ${error}`, 'JWT');
		throw error;
	}
}

/**
 * Helper function to parse and extract the JWT header
 * @param token - The JWT token
 * @returns The decoded header as an object
 */
function _parseJwtHeader(token: string): { kid?: string; alg?: string } {
	const [headerB64] = token.split('.');

	if (!headerB64) {
		logger.error('Invalid token format - missing header', 'JWT');
		throw new Error('Invalid token format');
	}

	// Decode the base64 header with proper padding
	const base64 = headerB64.replace(/-/g, '+').replace(/_/g, '/');
	const padding = '='.repeat((4 - (base64.length % 4)) % 4);
	const headerJson = atob(base64 + padding);

	// Parse the JSON header
	const header = JSON.parse(headerJson);
	logger.debug(`Decoded JWT header successfully`, 'JWT');

	return header;
}

/**
 * Helper function to log token expiration information
 * @param payload - The JWT payload
 */
function _logTokenExpiration(payload: JWTPayload): void {
	if (payload.exp) {
		const expDate = new Date(payload.exp * 1000);
		const now = new Date();
		const timeUntilExp = expDate.getTime() - now.getTime();
		logger.debug(
			`Token expires at ${expDate.toISOString()} (${
				timeUntilExp > 0 ? 'valid for ' + Math.round(timeUntilExp / 1000) + ' seconds' : 'EXPIRED'
			})`,
			'JWT'
		);
	}
}
