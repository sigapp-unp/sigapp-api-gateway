import { verifyJwt } from './jwt';

export interface Env {
	SUPABASE_URL: string;
	SUPABASE_SERVICE_ROLE_KEY: string;
	SUPABASE_ANON_KEY: string;
	SUPABASE_JWT_SECRET: string;
}

// Helper function to safely truncate a token for logging
function truncateToken(token: string): string {
	if (!token) return '';
	// Show first 5 and last 5 characters
	return token.length > 15 ? `${token.substring(0, 5)}...${token.substring(token.length - 5)}` : token;
}

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		try {
			let { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY, SUPABASE_JWT_SECRET } = env;

			// Ensure SUPABASE_URL is properly formatted with protocol
			if (!SUPABASE_URL.startsWith('http://') && !SUPABASE_URL.startsWith('https://')) {
				SUPABASE_URL = `https://${SUPABASE_URL}`;
			}

			// Remove trailing slash if present
			if (SUPABASE_URL.endsWith('/')) {
				SUPABASE_URL = SUPABASE_URL.slice(0, -1);
			}

			const JWK_URL = `${SUPABASE_URL}/auth/v1/.well-known/jwks.json`;
			const url = new URL(request.url);
			const path = url.pathname;
			const method = request.method;

			console.log(`📝 Processing ${method} request to ${path}`);
			console.log(`🔗 Using Supabase URL: ${SUPABASE_URL}`);

			// Log some client info
			const clientIP = request.headers.get('CF-Connecting-IP') || 'unknown';
			const userAgent = request.headers.get('User-Agent') || 'unknown';
			console.log(`👤 Request from: ${clientIP} using ${userAgent}`);

			// Check for essential env vars
			if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !SUPABASE_ANON_KEY) {
				console.error('⚠️ Missing essential environment variables');
				return new Response(JSON.stringify({ error: 'Server configuration error', details: 'Missing environment variables' }), {
					status: 500,
					headers: { 'Content-Type': 'application/json' },
				});
			}

			const jsonBody = ['POST', 'PATCH', 'PUT'].includes(method) ? await request.text() : null;
			if (jsonBody) {
				try {
					// Try to parse the JSON to validate it and log a safe version (without sensitive data)
					const parsedBody = JSON.parse(jsonBody);
					// Create a sanitized version for logging by removing potential sensitive fields
					const sanitizedBody = { ...parsedBody };

					if (sanitizedBody.password) sanitizedBody.password = '********';
					if (sanitizedBody.email) sanitizedBody.email = sanitizedBody.email.replace(/^(.{3})(.*)(@.*)$/, '$1****$3');

					console.log(`📦 Request body: ${JSON.stringify(sanitizedBody)}`);
				} catch (e) {
					console.warn(`⚠️ Unable to parse request body as JSON: ${e}`);
				}
			}

			// ─── AUTH (signup/login/refresh) ─────────────────────────────────────────────
			if (path === '/auth/signup' && method === 'POST') {
				return proxyAuth(`${SUPABASE_URL}/auth/v1/signup`);
			}
			if (path === '/auth/login' && method === 'POST') {
				return proxyAuth(`${SUPABASE_URL}/auth/v1/token?grant_type=password`);
			}
			if (path === '/auth/refresh' && method === 'POST') {
				return proxyAuth(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`);
			}
			// Añadiendo soporte para verificar la sesión del usuario
			if (path === '/auth/user' && method === 'GET') {
				const authHeader = request.headers.get('Authorization') || '';
				if (!authHeader) return new Response('Missing Authorization header', { status: 401 });

				return proxyAuth(`${SUPABASE_URL}/auth/v1/user`, authHeader);
			}

			// ─── PROTECTED DB ROUTES (/rest/v1/...) ──────────────────────────────────────
			if (path.startsWith('/rest/v1')) {
				console.log(`🔒 Processing protected route: ${path}`);

				const authHeader = request.headers.get('Authorization') || '';
				const token = authHeader.replace('Bearer ', '').trim();

				if (!token) {
					console.error('❌ Missing Authorization token');
					return new Response(JSON.stringify({ error: 'Unauthorized', message: 'Missing Authorization token' }), {
						status: 401,
						headers: { 'Content-Type': 'application/json' },
					});
				}

				console.log(`🔑 Received token: ${truncateToken(token)}`);

				try {
					console.log(`🔐 Verifying JWT against ${JWK_URL}`);
					// Pasamos SUPABASE_ANON_KEY al verificador JWT como tercer parámetro
					const payload = await verifyJwt({
						token,
						jwkUrl: JWK_URL,
						jwtSecret: SUPABASE_JWT_SECRET,
					});
					console.log('✅ JWT verification succeeded');

					// Log useful info from the payload
					if (payload.sub) console.log(`👤 User ID: ${payload.sub}`);
					if (payload.email) {
						const maskedEmail = payload.email.toString().replace(/^(.{3})(.*)(@.*)$/, '$1****$3');
						console.log(`📧 Email: ${maskedEmail}`);
					}
					if (payload.role) console.log(`🧢 Role: ${payload.role}`);
				} catch (err) {
					console.error('❌ JWT verification failed:', err);

					// Provide more specific error responses based on error message
					let status = 401;
					let errorMessage = 'Invalid or expired token';
					let errorDetails = err instanceof Error ? err.message : String(err);

					if (errorDetails.includes('No keys found')) {
						errorMessage = 'Authentication configuration error';
						errorDetails = 'No JWKS keys available for token verification';
						status = 503; // Service Unavailable might be more appropriate here
					} else if (errorDetails.includes('expired')) {
						errorMessage = 'Token expired';
					} else if (errorDetails.includes('Invalid token format')) {
						errorMessage = 'Invalid token format';
					}

					return new Response(
						JSON.stringify({
							error: 'Unauthorized',
							message: errorMessage,
							details: errorDetails,
						}),
						{ status, headers: { 'Content-Type': 'application/json' } }
					);
				}

				const supaUrl = `${SUPABASE_URL}${path}${url.search}`;
				console.log(`🔄 Proxying request to Supabase: ${supaUrl}`);

				try {
					// Log request headers (but redact sensitive info)
					const headersLog = Array.from(request.headers.entries())
						.filter(([key]) => !['authorization', 'cookie'].includes(key.toLowerCase()))
						.reduce((obj, [key, value]) => ({ ...obj, [key]: value }), {});
					console.log(`📤 Request headers: ${JSON.stringify(headersLog)}`);

					const proxied = await fetch(supaUrl, {
						method,
						headers: {
							Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
							'Content-Type': request.headers.get('Content-Type') ?? 'application/json',
							Prefer: request.headers.get('Prefer') ?? 'return=representation',
							apikey: SUPABASE_SERVICE_ROLE_KEY, // Add the apikey header for Supabase REST API
						},
						body: ['GET', 'HEAD'].includes(method) ? undefined : jsonBody!,
					});

					console.log(`📥 Supabase response status: ${proxied.status} ${proxied.statusText}`);

					// For error responses, log more details
					if (!proxied.ok) {
						const clonedResponse = proxied.clone();
						try {
							const errorBody = await clonedResponse.text();
							console.error(`⚠️ Supabase error response: ${errorBody}`);
						} catch (err) {
							console.error('⚠️ Could not read error response body');
						}
					}

					return makeProxyResponse(proxied);
				} catch (err) {
					console.error('❌ Error fetching from Supabase:', err);
					return new Response(
						JSON.stringify({
							error: 'Failed to fetch data from database',
							message: err instanceof Error ? err.message : 'Unknown error',
							details: err instanceof Error && err.stack ? err.stack : undefined,
						}),
						{ status: 500, headers: { 'Content-Type': 'application/json' } }
					);
				}
			}

			// ─── FALLBACK ────────────────────────────────────────────────────────────────
			console.log(`⚠️ Route not found: ${path}`);
			return new Response(JSON.stringify({ error: 'Not Found', message: `Route ${path} does not exist` }), {
				status: 404,
				headers: { 'Content-Type': 'application/json' },
			});

			// Proxy function for authentication endpoints using anon key
			async function proxyAuth(endpoint: string, authHeader?: string): Promise<Response> {
				try {
					console.log(`🔄 Proxying auth request to: ${endpoint}`);

					// Validate URL before fetching
					try {
						new URL(endpoint);
					} catch (urlError) {
						console.error(`❌ Invalid URL: ${endpoint}`);
						throw new Error(`Invalid URL: ${endpoint}`);
					}

					const headers: Record<string, string> = {
						'Content-Type': 'application/json',
						apikey: SUPABASE_ANON_KEY,
						'X-Client-Info': 'sigapp-proxy',
					};

					if (authHeader) {
						headers['Authorization'] = authHeader;
						console.log(`🔑 Using provided Authorization header: ${authHeader.startsWith('Bearer') ? 'Bearer [REDACTED]' : '[REDACTED]'}`);
					}

					console.log(`📤 Auth request method: ${method}`);

					const response = await fetch(endpoint, {
						method,
						headers,
						body: ['GET', 'HEAD'].includes(method) ? undefined : jsonBody!,
					});

					console.log(`📥 Auth response status: ${response.status} ${response.statusText}`);

					// For authentication responses, let's log the body in case of error
					if (!response.ok) {
						const clonedResponse = response.clone();
						try {
							const errorBody = await clonedResponse.text();
							console.error(`⚠️ Auth error response: ${errorBody}`);
						} catch (err) {
							console.error('⚠️ Could not read error response body');
						}
					} else {
						console.log('✅ Auth request successful');

						// If it's a login or token refresh, log that tokens were issued (but not the tokens themselves)
						if (endpoint.includes('token?grant_type=')) {
							const clonedResponse = response.clone();
							try {
								const responseBody = (await clonedResponse.json()) as {
									access_token?: string;
									expires_in?: number;
									refresh_token?: string;
								};
								if (responseBody.access_token) {
									console.log('🎟️ Access token issued');
									// Log token expiry if provided
									if (responseBody.expires_in) {
										console.log(`⏱️ Token expires in: ${responseBody.expires_in} seconds`);
									}
								}
								if (responseBody.refresh_token) {
									console.log('🔄 Refresh token issued');
								}
							} catch (err) {
								console.error('⚠️ Could not parse auth response JSON');
							}
						}
					}

					return makeProxyResponse(response);
				} catch (err) {
					console.error(`❌ Error proxying auth request to ${endpoint}:`, err);
					return new Response(
						JSON.stringify({
							error: 'Authentication service unavailable',
							message: err instanceof Error ? err.message : 'Unknown error',
							details: err instanceof Error && err.stack ? err.stack : undefined,
						}),
						{ status: 500, headers: { 'Content-Type': 'application/json' } }
					);
				}
			}
		} catch (err) {
			console.error('❌ Unexpected error in worker:', err);
			return new Response(
				JSON.stringify({
					error: 'Internal server error',
					message: err instanceof Error ? err.message : 'Unknown error',
					details: err instanceof Error && err.stack ? err.stack : undefined,
				}),
				{ status: 500, headers: { 'Content-Type': 'application/json' } }
			);
		}
	},
};

// Helper
function makeProxyResponse(res: Response): Response {
	const headers = new Headers(res.headers);
	headers.set('Content-Type', 'application/json');

	// Preserve the responses and their statuses, both for success and error
	return new Response(res.body, {
		status: res.status,
		statusText: res.statusText,
		headers,
	});
}
