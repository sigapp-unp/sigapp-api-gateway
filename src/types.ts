/**
 * Environment variables required for the worker
 */
export interface Env {
	/** Base URL of the Supabase instance (with or without protocol) */
	SUPABASE_URL: string;
	/** Service role key with admin access (keep secure, never expose to clients) */
	SUPABASE_SERVICE_ROLE_KEY: string;
	/** Anonymous key for public authentication endpoints */
	SUPABASE_ANON_KEY: string;
	/** JWT secret used for token verification with HS256 algorithm */
	SUPABASE_JWT_SECRET: string;
	/** OpenAI API key for OpenAI service integration */
	OPENAI_API_KEY: string;
}

/**
 * Configuration object with processed environment variables
 */
export interface SupabaseConfig {
	url: string;
	serviceRoleKey: string;
	anonKey: string;
	jwtSecret: string;
	jwkUrl: string;
}
