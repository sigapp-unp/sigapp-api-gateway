import { jwtVerify, importJWK, JWTPayload, type JWK } from 'jose';

let cachedJWK: Record<string, CryptoKey> | null = null;

export async function getJWKS(jwkUrl: string): Promise<Record<string, CryptoKey>> {
	if (cachedJWK) return cachedJWK;

	const res = await fetch(jwkUrl);
	if (!res.ok) throw new Error('Failed to fetch JWKS');

	const { keys } = (await res.json()) as { keys: JWK[] };
	if (!keys || keys.length === 0) throw new Error('No keys found');

	const jwks: Record<string, CryptoKey> = {};
	for (const key of keys) {
		const cryptoKey = await importJWK(key, key.alg);
		if (cryptoKey instanceof CryptoKey) {
			jwks[key.kid!] = cryptoKey;
		} else {
			throw new Error('Invalid key type returned by importJWK');
		}
	}

	cachedJWK = jwks;
	return jwks;
}

export async function verifyJwt(token: string, jwkUrl: string): Promise<JWTPayload> {
	const [headerB64] = token.split('.');
	const headerJson = atob(headerB64);
	const { kid } = JSON.parse(headerJson);

	const jwks = await getJWKS(jwkUrl);
	const key = jwks[kid];
	if (!key) throw new Error('Invalid kid');

	const { payload } = await jwtVerify(token, key);
	return payload;
}
