import { Env } from '../types';

/**
 * Configuration for upstream services
 * Contains information about available proxied services, their base URLs and headers
 */
export interface UpstreamConfig {
	baseUrl: string;
	headers: Record<string, string>;
}

/**
 * Available upstream services configuration with placeholders for environment variables
 * The placeholders ${VARIABLE} will be replaced with actual environment variable values at runtime
 */
export const upstreamServices: Record<string, UpstreamConfig> = {
	supabase: {
		baseUrl: '${SUPABASE_URL}',
		headers: {
			apikey: '${SUPABASE_SERVICE_ROLE_KEY}',
			Authorization: 'Bearer ${SUPABASE_SERVICE_ROLE_KEY}',
			Prefer: 'return=representation',
		},
	},
	openai: {
		baseUrl: 'https://api.openai.com/v1',
		headers: {
			Authorization: 'Bearer ${OPENAI_API_KEY}',
		},
	},
};

/**
 * Replace environment variable placeholders in a string with their values
 *
 * @param template - String with placeholders like ${VARIABLE}
 * @param env - Environment variables object
 * @returns String with placeholders replaced by environment variable values
 */
export function replaceEnvPlaceholders(template: string, env: Env): string {
	return template.replace(/\${([^}]+)}/g, (match, key) => {
		const value = env[key as keyof Env];
		if (value === undefined) {
			throw new Error(`Environment variable ${key} not found`);
		}
		return value;
	});
}

/**
 * Process an upstream configuration by replacing environment variable placeholders
 *
 * @param config - Upstream configuration with placeholders
 * @param env - Environment variables object
 * @returns Processed configuration with actual values
 */
export function processUpstreamConfig(config: UpstreamConfig, env: Env): UpstreamConfig {
	const processedConfig: UpstreamConfig = {
		baseUrl: replaceEnvPlaceholders(config.baseUrl, env),
		headers: {},
	};

	// Process headers
	for (const [key, value] of Object.entries(config.headers)) {
		processedConfig.headers[key] = replaceEnvPlaceholders(value, env);
	}

	return processedConfig;
}

/**
 * Get a processed upstream configuration for a specified service
 *
 * @param service - Name of the upstream service (e.g., 'supabase', 'openai')
 * @param env - Environment variables object
 * @returns Processed upstream configuration
 * @throws Error if the service is not configured
 */
export function getUpstreamConfig(service: string, env: Env): UpstreamConfig {
	const config = upstreamServices[service];
	if (!config) {
		throw new Error(`Upstream service '${service}' not configured`);
	}
	return processUpstreamConfig(config, env);
}
