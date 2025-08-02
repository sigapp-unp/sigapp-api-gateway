type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const levelPriority: Record<LogLevel, number> = {
	debug: 0,
	info: 1,
	warn: 2,
	error: 3,
};

const CURRENT_LEVEL: LogLevel = 'debug';

const levelColors: Record<LogLevel, string> = {
	debug: '\x1b[36m', // cyan
	info: '\x1b[32m', // green
	warn: '\x1b[33m', // yellow
	error: '\x1b[31m', // red
};

const resetColor = '\x1b[0m';

function _log(level: LogLevel, message: unknown, name?: string, ...rest: unknown[]) {
	if (levelPriority[level] < levelPriority[CURRENT_LEVEL]) return;

	const timestamp = new Date().toISOString();
	const label = level.toUpperCase().padEnd(5);
	const context = name ?? 'App';

	const color = levelColors[level];
	const reset = resetColor;

	console.log(`${color}[${timestamp}] [${label}] [${context}]${reset}`, message, ...rest);
}

export const logger = {
	debug: (msg: unknown, name?: string, ...rest: unknown[]) => _log('debug', msg, name, ...rest),
	info: (msg: unknown, name?: string, ...rest: unknown[]) => _log('info', msg, name, ...rest),
	warn: (msg: unknown, name?: string, ...rest: unknown[]) => _log('warn', msg, name, ...rest),
	error: (msg: unknown, name?: string, ...rest: unknown[]) => _log('error', msg, name, ...rest),
};
