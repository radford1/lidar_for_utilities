import { DBSQLClient } from '@databricks/sql';

/**
 * DatabricksSql - A stateless interface for executing SQL queries against Databricks
 *
 * Each query opens its own session, executes, and closes the session.
 * A single DBSQLClient is lazily initialized and reused across queries.
 *
 * Environment variables required:
 * - DATABRICKS_SERVER_HOSTNAME: The server hostname for your cluster or SQL warehouse
 * - DATABRICKS_HTTP_PATH: The HTTP path for your cluster or SQL warehouse
 * - DATABRICKS_TOKEN: Your Databricks personal access token (for token auth)
 * - DATABRICKS_CLIENT_ID: Service principal UUID/Application ID (for OAuth M2M)
 * - DATABRICKS_CLIENT_SECRET: Service principal secret (for OAuth M2M)
 */
class DatabricksSql {
  constructor(options = {}) {
    this._client = null;
    this._clientPromise = null;
    this.options = {
      authType: options.authType || (process.env.DATABRICKS_TOKEN ? 'token' : 'oauth-m2m'),
      initialCatalog: options.initialCatalog || null,
      initialSchema: options.initialSchema || null,
      queryTimeout: options.queryTimeout || 300,
      maxRows: options.maxRows || 10000,
      userAgent: options.userAgent || 'DatabricksSql/1.0.0',
      ...options
    };
  }

  /**
   * Lazy-initialize and return the DBSQLClient instance.
   * The client is created once and reused for all queries.
   * @returns {Promise<DBSQLClient>}
   */
  async getClient() {
    if (this._client) {
      return this._client;
    }

    // Prevent multiple concurrent initializations
    if (this._clientPromise) {
      return this._clientPromise;
    }

    this._clientPromise = this._initClient();
    try {
      this._client = await this._clientPromise;
      return this._client;
    } catch (error) {
      this._clientPromise = null;
      throw error;
    }
  }

  /**
   * Internal: create and connect the DBSQLClient
   * @returns {Promise<DBSQLClient>}
   */
  async _initClient() {
    const serverHostname = process.env.DATABRICKS_SERVER_HOSTNAME;
    const httpPath = process.env.DATABRICKS_HTTP_PATH;

    if (!serverHostname || !httpPath) {
      throw new Error(
        'Missing required environment variables: DATABRICKS_SERVER_HOSTNAME and DATABRICKS_HTTP_PATH'
      );
    }

    const client = new DBSQLClient();
    const connectOptions = {
      host: serverHostname,
      path: httpPath,
      userAgentEntry: this.options.userAgent
    };

    switch (this.options.authType) {
      case 'token': {
        const token = process.env.DATABRICKS_TOKEN;
        if (!token) {
          throw new Error('Missing DATABRICKS_TOKEN environment variable for token authentication');
        }
        connectOptions.token = token;
        break;
      }

      case 'oauth-u2m':
        connectOptions.authType = 'databricks-oauth';
        break;

      case 'oauth-m2m': {
        const clientId = process.env.DATABRICKS_CLIENT_ID;
        const clientSecret = process.env.DATABRICKS_CLIENT_SECRET;
        if (!clientId || !clientSecret) {
          throw new Error(
            'Missing DATABRICKS_CLIENT_ID or DATABRICKS_CLIENT_SECRET environment variables for OAuth M2M authentication'
          );
        }
        connectOptions.authType = 'databricks-oauth';
        connectOptions.oauthClientId = clientId;
        connectOptions.oauthClientSecret = clientSecret;
        break;
      }

      default:
        throw new Error(`Unsupported authentication type: ${this.options.authType}`);
    }

    await client.connect(connectOptions);
    console.log('DBSQLClient initialized successfully');
    return client;
  }

  /**
   * Open a new session on the client.
   * @returns {Promise<IDBSQLSession>}
   */
  async _openSession() {
    const client = await this.getClient();
    const sessionOptions = {};
    if (this.options.initialCatalog) {
      sessionOptions.initialCatalog = this.options.initialCatalog;
    }
    if (this.options.initialSchema) {
      sessionOptions.initialSchema = this.options.initialSchema;
    }
    return client.openSession(sessionOptions);
  }

  /**
   * Execute a SQL query and return all results.
   * Opens a session, runs the query, and closes the session.
   * @param {string} sql - The SQL query to execute
   * @param {Object} options - Query options
   * @returns {Promise<Array>} Array of result objects
   */
  async query(sql, options = {}) {
    const queryOptions = {
      runAsync: options.runAsync || false,
      maxRows: options.maxRows || this.options.maxRows,
      timeout: options.timeout || this.options.queryTimeout
    };

    const session = await this._openSession();
    try {
      console.log(`Executing query: ${sql.substring(0, 100)}${sql.length > 100 ? '...' : ''}`);
      const operation = await session.executeStatement(sql, queryOptions);
      const results = await operation.fetchAll();
      await operation.close();
      return results;
    } catch (error) {
      throw new Error(`Query execution failed: ${error.message}`);
    } finally {
      await session.close();
    }
  }

  /**
   * Execute a SQL query and return results in chunks.
   * Opens a session, streams chunks, and closes the session.
   * @param {string} sql - The SQL query to execute
   * @param {Object} options - Query options
   * @param {number} options.chunkSize - Number of rows per chunk
   * @returns {AsyncGenerator<Array>} Generator yielding chunks of results
   */
  async *queryChunked(sql, options = {}) {
    const queryOptions = {
      runAsync: options.runAsync || false,
      maxRows: options.maxRows || this.options.maxRows,
      timeout: options.timeout || this.options.queryTimeout
    };

    const chunkSize = options.chunkSize || 1000;

    const session = await this._openSession();
    try {
      console.log(`Executing chunked query: ${sql.substring(0, 100)}${sql.length > 100 ? '...' : ''}`);
      const operation = await session.executeStatement(sql, queryOptions);

      let hasMore = true;
      while (hasMore) {
        const chunk = await operation.fetchChunk({ maxRows: chunkSize });
        if (chunk && chunk.length > 0) {
          yield chunk;
        } else {
          hasMore = false;
        }
      }

      await operation.close();
    } catch (error) {
      throw new Error(`Chunked query execution failed: ${error.message}`);
    } finally {
      await session.close();
    }
  }

  /**
   * Execute a SQL statement that doesn't return results (INSERT, UPDATE, DELETE, etc.)
   * Opens a session, executes, and closes the session.
   * @param {string} sql - The SQL statement to execute
   * @param {Object} options - Query options
   * @returns {Promise<void>}
   */
  async execute(sql, options = {}) {
    const queryOptions = {
      runAsync: options.runAsync || false,
      timeout: options.timeout || this.options.queryTimeout
    };

    const session = await this._openSession();
    try {
      console.log(`Executing statement: ${sql.substring(0, 100)}${sql.length > 100 ? '...' : ''}`);
      const operation = await session.executeStatement(sql, queryOptions);
      await operation.close();
    } catch (error) {
      throw new Error(`Statement execution failed: ${error.message}`);
    } finally {
      await session.close();
    }
  }

  /**
   * Get metadata about tables in a schema
   * @param {string} catalogName - Catalog name (optional)
   * @param {string} schemaName - Schema name (optional)
   * @param {string} tableName - Table name (optional)
   * @returns {Promise<Array>} Array of table metadata
   */
  async getTables(catalogName = null, schemaName = null, tableName = null) {
    const session = await this._openSession();
    try {
      const request = {};
      if (catalogName) request.catalogName = catalogName;
      if (schemaName) request.schemaName = schemaName;
      if (tableName) request.tableName = tableName;

      const operation = await session.getTables(request);
      const results = await operation.fetchAll();
      await operation.close();
      return results;
    } catch (error) {
      throw new Error(`Failed to get tables: ${error.message}`);
    } finally {
      await session.close();
    }
  }

  /**
   * Get metadata about schemas in a catalog
   * @param {string} catalogName - Catalog name (optional)
   * @param {string} schemaName - Schema name pattern (optional)
   * @returns {Promise<Array>} Array of schema metadata
   */
  async getSchemas(catalogName = null, schemaName = null) {
    const session = await this._openSession();
    try {
      const request = {};
      if (catalogName) request.catalogName = catalogName;
      if (schemaName) request.schemaName = schemaName;

      const operation = await session.getSchemas(request);
      const results = await operation.fetchAll();
      await operation.close();
      return results;
    } catch (error) {
      throw new Error(`Failed to get schemas: ${error.message}`);
    } finally {
      await session.close();
    }
  }

  /**
   * Get metadata about catalogs
   * @returns {Promise<Array>} Array of catalog metadata
   */
  async getCatalogs() {
    const session = await this._openSession();
    try {
      const operation = await session.getCatalogs({});
      const results = await operation.fetchAll();
      await operation.close();
      return results;
    } catch (error) {
      throw new Error(`Failed to get catalogs: ${error.message}`);
    } finally {
      await session.close();
    }
  }

  /**
   * Test the connection by executing a simple query
   * @returns {Promise<boolean>} True if connection is working
   */
  async testConnection() {
    try {
      const results = await this.query('SELECT 1 as test');
      return results.length > 0 && results[0].test === 1;
    } catch (error) {
      console.error('Connection test failed:', error.message);
      return false;
    }
  }
}

export default DatabricksSql;
