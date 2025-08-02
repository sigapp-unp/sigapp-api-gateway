import { SupabaseConfig } from '../types';

export function createSupabaseConfig(env: Env): SupabaseConfig {
	// Create a configuration object to pass around
	let { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY, SUPABASE_JWT_SECRET } = env;
	const JWK_URL = `${SUPABASE_URL}/auth/v1/.well-known/jwks.json`;
	const config: SupabaseConfig = {
		url: SUPABASE_URL,
		serviceRoleKey: SUPABASE_SERVICE_ROLE_KEY,
		anonKey: SUPABASE_ANON_KEY,
		jwtSecret: SUPABASE_JWT_SECRET,
		jwkUrl: JWK_URL,
	};
	if (!config.url || !config.serviceRoleKey || !config.anonKey) {
		throw new Error('Missing essential environment variables');
	}
	return config;
}
