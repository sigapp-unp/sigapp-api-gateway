import { jwtVerify, importJWK, JWTPayload, type JWK } from 'jose';

let cachedJWK: Record<string, CryptoKey> | null = null;

export async function getJWKS(jwkUrl: string): Promise<Record<string, CryptoKey>> {
	console.log(`📌 JWKS: Attempting to fetch keys from: ${jwkUrl}`);
	if (cachedJWK) {
		console.log('📌 JWKS: Using cached keys');
		return cachedJWK;
	}

	try {
		console.log(`📌 JWKS: Fetching from ${jwkUrl}`);
		const res = await fetch(jwkUrl);

		console.log(`📌 JWKS: Response status: ${res.status}`);
		if (!res.ok) {
			const error = await res.text();
			console.error(`📌 JWKS: Failed to fetch JWKS - Status: ${res.status}, Error: ${error}`);
			throw new Error(`Failed to fetch JWKS: ${res.status} ${res.statusText}`);
		}

		const data = await res.json();
		console.log(`📌 JWKS: Response data received: ${JSON.stringify(data, null, 2)}`);

		const { keys } = data as { keys: JWK[] };
		if (!keys || keys.length === 0) {
			console.error('📌 JWKS: No keys found in response');
			throw new Error('No keys found');
		}

		console.log(`📌 JWKS: Found ${keys.length} keys with ids: ${keys.map((k) => k.kid).join(', ')}`);

		const jwks: Record<string, CryptoKey> = {};
		for (const key of keys) {
			console.log(`📌 JWKS: Importing key with id: ${key.kid}`);
			try {
				const cryptoKey = await importJWK(key, key.alg);
				if (cryptoKey instanceof CryptoKey) {
					jwks[key.kid!] = cryptoKey;
					console.log(`📌 JWKS: Successfully imported key: ${key.kid}`);
				} else {
					console.error(`📌 JWKS: Invalid key type for kid: ${key.kid}`);
					throw new Error('Invalid key type returned by importJWK');
				}
			} catch (error) {
				console.error(`📌 JWKS: Failed to import key ${key.kid}: ${error}`);
				throw error;
			}
		}

		cachedJWK = jwks;
		console.log('📌 JWKS: Successfully cached keys');
		return jwks;
	} catch (error) {
		console.error(`📌 JWKS: Error in getJWKS: ${error}`);
		throw error;
	}
}

// Function to verify a token with either JWKS or shared secret
export async function verifyJwt({ token, jwkUrl, jwtSecret }: { token: string; jwkUrl: string; jwtSecret: string }): Promise<JWTPayload> {
	try {
		console.log('🔐 JWT: Starting verification process');

		// Safely decode the header
		try {
			const [headerB64] = token.split('.');
			console.log(`🔐 JWT: Token header portion: ${headerB64}`);

			if (!headerB64) {
				console.error('🔐 JWT: Invalid token format - missing header');
				throw new Error('Invalid token format');
			}

			// Pad the base64 if needed
			const base64 = headerB64.replace(/-/g, '+').replace(/_/g, '/');
			const padding = '='.repeat((4 - (base64.length % 4)) % 4);
			const headerJson = atob(base64 + padding);

			const header = JSON.parse(headerJson);
			console.log(`🔐 JWT: Decoded header: ${JSON.stringify(header)}`);

			const { kid, alg } = header;

			// Try verification with shared secret (HS256)
			console.log('🔐 JWT: Trying verification with shared secret (SUPABASE_ANON_KEY)');
			try {
				// Use TextEncoder to convert the string to Uint8Array for jose
				const secretKeyBytes = new TextEncoder().encode(jwtSecret);

				const { payload } = await jwtVerify(token, secretKeyBytes, {
					// If we have the algorithm information, specify it
					algorithms: alg ? [alg] : undefined,
				});

				console.log('🔐 JWT: Verification with shared secret successful');
				// Log expiration time if available
				if (payload.exp) {
					const expDate = new Date(payload.exp * 1000);
					const now = new Date();
					const timeUntilExp = expDate.getTime() - now.getTime();
					console.log(
						`🔐 JWT: Token expires at ${expDate.toISOString()} (${
							timeUntilExp > 0 ? 'valid for ' + Math.round(timeUntilExp / 1000) + ' seconds' : 'EXPIRED'
						})`
					);
				}

				return payload;
			} catch (hsError) {
				console.error(`🔐 JWT: Shared secret verification failed: ${hsError}`);
				// Don't throw here, continue to try JWKS if applicable
			}

			// If we're still here and have a kid, try with JWKS (public key verification)
			if (kid && alg !== 'HS256') {
				console.log(`🔐 JWT: Trying JWKS verification for token with kid: ${kid}`);

				try {
					const jwks = await getJWKS(jwkUrl);
					console.log(`🔐 JWT: Available key IDs: ${Object.keys(jwks).join(', ')}`);

					const key = jwks[kid];
					if (!key) {
						console.error(`🔐 JWT: No matching key found for kid: ${kid}`);
						throw new Error(`Invalid kid: ${kid} not found in JWKS`);
					}

					console.log(`🔐 JWT: Found matching key for kid: ${kid}, verifying signature...`);
					const { payload } = await jwtVerify(token, key);

					console.log('🔐 JWT: JWKS verification successful');
					// Log expiration time if available
					if (payload.exp) {
						const expDate = new Date(payload.exp * 1000);
						const now = new Date();
						const timeUntilExp = expDate.getTime() - now.getTime();
						console.log(
							`🔐 JWT: Token expires at ${expDate.toISOString()} (${
								timeUntilExp > 0 ? 'valid for ' + Math.round(timeUntilExp / 1000) + ' seconds' : 'EXPIRED'
							})`
						);
					}

					return payload;
				} catch (jwksError) {
					console.error(`🔐 JWT: JWKS verification failed: ${jwksError}`);
					throw jwksError; // Both methods failed
				}
			} else {
				// If we've tried shared secret and there's no kid or it's HS256, throw the last error
				throw new Error('Token verification failed. Ensure the SUPABASE_ANON_KEY is correct.');
			}
		} catch (decodeError: unknown) {
			console.error(`🔐 JWT: Error during verification: ${decodeError}`);
			const errorMessage = decodeError instanceof Error ? decodeError.message : String(decodeError);
			throw new Error(`JWT verification failed: ${errorMessage}`);
		}
	} catch (error) {
		console.error(`🔐 JWT: Verification failed: ${error}`);
		throw error;
	}
}
