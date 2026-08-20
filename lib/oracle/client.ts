type OracleResult<T> = { rows?: T[]; outBinds?: unknown };
export type OracleConnection = {
  execute<T = Record<string, unknown>>(sql: string, binds?: Record<string, unknown>, options?: Record<string, unknown>): Promise<OracleResult<T>>;
  close(): Promise<void>;
};
type OraclePool = { getConnection(): Promise<OracleConnection> };
export type OracleModule = {
  fetchAsString: unknown[];
  CLOB: unknown;
  BIND_OUT: unknown;
  NUMBER: unknown;
  OUT_FORMAT_OBJECT: unknown;
  createPool(configuration: Record<string, unknown>): Promise<OraclePool>;
};

declare global { var __innohireOraclePool: OraclePool | undefined; }

export class ConfigurationError extends Error {}

export function isOracleConfigured() {
  return Boolean(process.env.ORACLE_USER && process.env.ORACLE_PASSWORD && process.env.ORACLE_CONNECT_STRING);
}

export async function getOracleDriver(): Promise<OracleModule> {
  const imported = await import("oracledb");
  const driver = (imported.default ?? imported) as unknown as OracleModule;
  driver.fetchAsString = [driver.CLOB];
  return driver;
}

async function getPool(): Promise<OraclePool> {
  if (!isOracleConfigured()) throw new ConfigurationError("Oracle connection settings are not configured.");
  if (globalThis.__innohireOraclePool) return globalThis.__innohireOraclePool;
  const driver = await getOracleDriver();
  globalThis.__innohireOraclePool = await driver.createPool({
    user: process.env.ORACLE_USER,
    password: process.env.ORACLE_PASSWORD,
    connectString: process.env.ORACLE_CONNECT_STRING,
    poolMin: 0,
    poolMax: 8,
    poolIncrement: 1,
  });
  return globalThis.__innohireOraclePool;
}

export async function withConnection<T>(operation: (connection: OracleConnection, driver: OracleModule) => Promise<T>): Promise<T> {
  const connection = await (await getPool()).getConnection();
  try { return await operation(connection, await getOracleDriver()); }
  finally { await connection.close(); }
}
