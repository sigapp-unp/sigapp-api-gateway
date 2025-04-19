import { verifyJwt } from './jwt';

export interface Env {
	SUPABASE_URL: string;
	SUPABASE_SERVICE_ROLE_KEY: string;
	SUPABASE_ANON_KEY: string;
}

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		try {
			let { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY } = env;

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

			console.log(`Processing ${method} request to ${path}`);
			console.log(`Using Supabase URL: ${SUPABASE_URL}`);

			const jsonBody = ['POST', 'PATCH', 'PUT'].includes(method) ? await request.text() : null;

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
				const authHeader = request.headers.get('Authorization') || '';
				const token = authHeader.replace('Bearer ', '').trim();
				if (!token) return new Response('Missing Authorization token', { status: 401 });

				try {
					await verifyJwt(token, JWK_URL);
				} catch (err) {
					console.error('JWT verification failed:', err);
					return new Response('Invalid or expired token', { status: 401 });
				}

				const supaUrl = `${SUPABASE_URL}${path}${url.search}`;
				try {
					const proxied = await fetch(supaUrl, {
						method,
						headers: {
							Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
							'Content-Type': request.headers.get('Content-Type') ?? 'application/json',
							Prefer: request.headers.get('Prefer') ?? 'return=representation',
						},
						body: ['GET', 'HEAD'].includes(method) ? undefined : jsonBody!,
					});
					return makeProxyResponse(proxied);
				} catch (err) {
					console.error('Error fetching from Supabase:', err);
					return new Response(
						JSON.stringify({
							error: 'Failed to fetch data from database',
							message: err instanceof Error ? err.message : 'Unknown error',
						}),
						{ status: 500, headers: { 'Content-Type': 'application/json' } }
					);
				}
			}

			// ─── FALLBACK ────────────────────────────────────────────────────────────────
			return new Response('Not Found', { status: 404 });

			// Proxy function for authentication endpoints using anon key
			async function proxyAuth(endpoint: string, authHeader?: string): Promise<Response> {
				try {
					console.log(`Proxying auth request to: ${endpoint}`);

					// Validate URL before fetching
					try {
						new URL(endpoint);
					} catch (urlError) {
						throw new Error(`Invalid URL: ${endpoint}`);
					}

					const headers: Record<string, string> = {
						'Content-Type': 'application/json',
						apikey: SUPABASE_ANON_KEY,
						'X-Client-Info': 'sigapp-proxy',
					};

					if (authHeader) {
						headers['Authorization'] = authHeader;
					}

					const response = await fetch(endpoint, {
						method,
						headers,
						body: ['GET', 'HEAD'].includes(method) ? undefined : jsonBody!,
					});

					console.log(`Auth response status: ${response.status}`);

					// For authentication responses, let's log the body in case of error
					if (!response.ok) {
						const clonedResponse = response.clone();
						try {
							const errorBody = await clonedResponse.text();
							console.error(`Auth error response: ${errorBody}`);
						} catch (err) {
							console.error('Could not read error response body');
						}
					}

					return makeProxyResponse(response);
				} catch (err) {
					console.error(`Error proxying auth request to ${endpoint}:`, err);
					return new Response(
						JSON.stringify({
							error: 'Authentication service unavailable',
							message: err instanceof Error ? err.message : 'Unknown error',
						}),
						{ status: 500, headers: { 'Content-Type': 'application/json' } }
					);
				}
			}
		} catch (err) {
			console.error('Unexpected error in worker:', err);
			return new Response(
				JSON.stringify({
					error: 'Internal server error',
					message: err instanceof Error ? err.message : 'Unknown error',
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
