// import 'dotenv/config';
import { DBSQLClient } from '@databricks/sql';

/**
 * DatabricksSql - A simplified interface for executing SQL queries against Databricks
 * 
 * This class handles all authentication and connection management internally,
 * providing a clean API for executing SQL queries.
 * 
 * Environment variables required:
 * - DATABRICKS_SERVER_HOSTNAME: The server hostname for your cluster or SQL warehouse
 * - DATABRICKS_HTTP_PATH: The HTTP path for your cluster or SQL warehouse
 * - DATABRICKS_TOKEN: Your Databricks personal access token (for token auth)
 * - DATABRICKS_CLIENT_ID: Service principal UUID/Application ID (for OAuth M2M)
 * - DATABRICKS_CLIENT_SECRET: Service principal secret (for OAuth M2M)
 */
console.log("Hi.");
class DatabricksSql {
  constructor(options = {}) {
    this.client = null;
    this.session = null;
    this.isConnected = false;
    this.options = {
      authType: options.authType || (process.env.DATABRICKS_TOKEN ? 'token' : 'oauth-m2m'), // 'token', 'oauth-u2m', 'oauth-m2m'
      initialCatalog: options.initialCatalog || null,
      initialSchema: options.initialSchema || null,
      queryTimeout: options.queryTimeout || 300, // seconds
      maxRows: options.maxRows || 10000,
      userAgent: options.userAgent || 'DatabricksSql/1.0.0',
      ...options
    };
    // console.log(this.options.authType);
    // console.log('All env vars:', process.env);
  }

  /**
   * Initialize the connection to Databricks
   * @returns {Promise<void>}
   */
  async connect() {
    if (this.isConnected) {
      return; // Already connected
    }

    try {
      // Get connection parameters from environment variables
      console.log("process.env.DATABRICKS_SERVER_HOSTNAME", process.env.DATABRICKS_SERVER_HOSTNAME)
      const serverHostname = process.env.DATABRICKS_SERVER_HOSTNAME;
      const httpPath = process.env.DATABRICKS_HTTP_PATH;

      if (!serverHostname || !httpPath) {
        throw new Error(
          'Missing required environment variables: DATABRICKS_SERVER_HOSTNAME and DATABRICKS_HTTP_PATH'
        );
      }

      // Create client and connection options based on auth type
      this.client = new DBSQLClient();
      const connectOptions = {
        host: serverHostname,
        path: httpPath,
        userAgentEntry: this.options.userAgent
      };

      console.log(this.options.authType);
      // Add authentication based on type
      switch (this.options.authType) {
        case 'token':
          const token = process.env.DATABRICKS_TOKEN;
          if (!token) {
            throw new Error('Missing DATABRICKS_TOKEN environment variable for token authentication');
          }
          connectOptions.token = token;
          break;

        case 'oauth-u2m':
          console.log("oauth-u2m")
          connectOptions.authType = 'databricks-oauth';
          break;

        case 'oauth-m2m':
          console.log("oauth-m2m")
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

        default:
          throw new Error(`Unsupported authentication type: ${this.options.authType}`);
      }

      // Connect to Databricks
      await this.client.connect(connectOptions);

      // Open a session
      const sessionOptions = {};
      if (this.options.initialCatalog) {
        sessionOptions.initialCatalog = this.options.initialCatalog;
      }
      if (this.options.initialSchema) {
        sessionOptions.initialSchema = this.options.initialSchema;
      }

      this.session = await this.client.openSession(sessionOptions);
      this.isConnected = true;

      console.log('Successfully connected to Databricks SQL');
    } catch (error) {
      this.isConnected = false;
      this.client = null;
      this.session = null;
      throw new Error(`Failed to connect to Databricks: ${error.message}`);
    }
  }

  /**
   * Execute a SQL query and return all results
   * @param {string} sql - The SQL query to execute
   * @param {Object} options - Query options
   * @returns {Promise<Array>} Array of result objects
   */
  async query(sql, options = {}) {
    if (!this.isConnected) {
      await this.connect();
    }

    const queryOptions = {
      runAsync: options.runAsync || false,
      maxRows: options.maxRows || this.options.maxRows,
      timeout: options.timeout || this.options.queryTimeout
    };

    try {
      console.log(`Executing query: ${sql.substring(0, 100)}${sql.length > 100 ? '...' : ''}`);
      
      const operation = await this.session.executeStatement(sql, queryOptions);
      const results = await operation.fetchAll();
      
      await operation.close();
      return results;
    } catch (error) {
      throw new Error(`Query execution failed: ${error.message}`);
    }
  }

  /**
   * Execute a SQL query and return results in chunks
   * @param {string} sql - The SQL query to execute
   * @param {Object} options - Query options
   * @param {number} options.chunkSize - Number of rows per chunk
   * @returns {AsyncGenerator<Array>} Generator yielding chunks of results
   */
  async *queryChunked(sql, options = {}) {
    if (!this.isConnected) {
      await this.connect();
    }

    const queryOptions = {
      runAsync: options.runAsync || false,
      maxRows: options.maxRows || this.options.maxRows,
      timeout: options.timeout || this.options.queryTimeout
    };

    const chunkSize = options.chunkSize || 1000;

    try {
      console.log(`Executing chunked query: ${sql.substring(0, 100)}${sql.length > 100 ? '...' : ''}`);
      
      const operation = await this.session.executeStatement(sql, queryOptions);
      
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
    }
  }

  /**
   * Execute a SQL query that doesn't return results (INSERT, UPDATE, DELETE, etc.)
   * @param {string} sql - The SQL statement to execute
   * @param {Object} options - Query options
   * @returns {Promise<void>}
   */
  async execute(sql, options = {}) {
    if (!this.isConnected) {
      await this.connect();
    }

    const queryOptions = {
      runAsync: options.runAsync || false,
      timeout: options.timeout || this.options.queryTimeout
    };

    try {
      console.log(`Executing statement: ${sql.substring(0, 100)}${sql.length > 100 ? '...' : ''}`);
      
      const operation = await this.session.executeStatement(sql, queryOptions);
      await operation.close();
    } catch (error) {
      throw new Error(`Statement execution failed: ${error.message}`);
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
    if (!this.isConnected) {
      await this.connect();
    }

    try {
      const request = {};
      if (catalogName) request.catalogName = catalogName;
      if (schemaName) request.schemaName = schemaName;
      if (tableName) request.tableName = tableName;

      const operation = await this.session.getTables(request);
      const results = await operation.fetchAll();
      await operation.close();
      
      return results;
    } catch (error) {
      throw new Error(`Failed to get tables: ${error.message}`);
    }
  }

  /**
   * Get metadata about schemas in a catalog
   * @param {string} catalogName - Catalog name (optional)
   * @param {string} schemaName - Schema name pattern (optional)
   * @returns {Promise<Array>} Array of schema metadata
   */
  async getSchemas(catalogName = null, schemaName = null) {
    if (!this.isConnected) {
      await this.connect();
    }

    try {
      const request = {};
      if (catalogName) request.catalogName = catalogName;
      if (schemaName) request.schemaName = schemaName;

      const operation = await this.session.getSchemas(request);
      const results = await operation.fetchAll();
      await operation.close();
      
      return results;
    } catch (error) {
      throw new Error(`Failed to get schemas: ${error.message}`);
    }
  }

  /**
   * Get metadata about catalogs
   * @returns {Promise<Array>} Array of catalog metadata
   */
  async getCatalogs() {
    if (!this.isConnected) {
      await this.connect();
    }

    try {
      const operation = await this.session.getCatalogs({});
      const results = await operation.fetchAll();
      await operation.close();
      
      return results;
    } catch (error) {
      throw new Error(`Failed to get catalogs: ${error.message}`);
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

  /**
   * Close the connection and clean up resources
   * @returns {Promise<void>}
   */
  async disconnect() {
    try {
      if (this.session) {
        await this.session.close();
        this.session = null;
      }
      
      if (this.client) {
        await this.client.close();
        this.client = null;
      }
      
      this.isConnected = false;
      console.log('Disconnected from Databricks SQL');
    } catch (error) {
      console.error('Error during disconnect:', error.message);
    }
  }

  /**
   * Get connection status
   * @returns {boolean} True if connected
   */
  getConnectionStatus() {
    return this.isConnected;
  }
}

export default DatabricksSql; 