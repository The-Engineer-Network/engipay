#!/usr/bin/env node

/**
 * EngiPay PostgreSQL Database Setup Script
 *
 * This script helps you set up the PostgreSQL database for EngiPay.
 * Run this script to create the database, user, and tables.
 *
 * Usage:
 *   node scripts/setup-db.js
 *
 * Requirements:
 *   - PostgreSQL must be installed and running
 *   - You must have superuser access to PostgreSQL
 *   - Update the connection details below if needed
 */

const { Client } = require('pg');
require('dotenv').config();

// Database configuration
const config = {
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  user: process.env.DB_SETUP_USER || 'postgres', // Superuser for setup
  password: process.env.DB_SETUP_PASSWORD || '', // Set this in .env
  database: 'postgres' // Connect to default postgres database first
};

const dbName = process.env.DB_NAME || 'engipay_db';
const dbUser = process.env.DB_USER || 'engipay_user';
const dbPassword = process.env.DB_PASSWORD || 'your_secure_password_here';

async function setupDatabase() {
  const client = new Client(config);

  try {
    console.log('🔄 Connecting to PostgreSQL...');
    await client.connect();
    console.log('✅ Connected to PostgreSQL');

    // Check if database exists
    const dbCheck = await client.query(
      "SELECT 1 FROM pg_database WHERE datname = $1",
      [dbName]
    );

    if (dbCheck.rows.length > 0) {
      console.log(`⚠️  Database '${dbName}' already exists`);
    } else {
      // Create database
      console.log(`📦 Creating database '${dbName}'...`);
      await client.query(`CREATE DATABASE ${dbName}`);
      console.log(`✅ Database '${dbName}' created`);
    }

    // Check if user exists
    const userCheck = await client.query(
      "SELECT 1 FROM pg_roles WHERE rolname = $1",
      [dbUser]
    );

    if (userCheck.rows.length > 0) {
      console.log(`⚠️  User '${dbUser}' already exists`);
    } else {
      // Create user
      console.log(`👤 Creating user '${dbUser}'...`);
      await client.query(`CREATE USER ${dbUser} WITH PASSWORD '${dbPassword}'`);
      console.log(`✅ User '${dbUser}' created`);
    }

    // Grant privileges
    console.log(`🔑 Granting privileges to '${dbUser}' on '${dbName}'...`);
    await client.query(`GRANT ALL PRIVILEGES ON DATABASE ${dbName} TO ${dbUser}`);
    console.log(`✅ Privileges granted`);

    // Close connection to default database
    await client.end();

    // Connect to the new database to create extensions and tables
    const dbConfig = { ...config, database: dbName };
    const dbClient = new Client(dbConfig);

    console.log(`🔄 Connecting to '${dbName}' database...`);
    await dbClient.connect();
    console.log(`✅ Connected to '${dbName}' database`);

    // Create extensions
    console.log('🔧 Creating PostgreSQL extensions...');
    await dbClient.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
    await dbClient.query('CREATE EXTENSION IF NOT EXISTS "pgcrypto"');
    console.log('✅ Extensions created');

    // Grant schema privileges
    await dbClient.query(`GRANT ALL ON SCHEMA public TO ${dbUser}`);
    await dbClient.query(`GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO ${dbUser}`);
    await dbClient.query(`GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO ${dbUser}`);

    await dbClient.end();

    console.log('\n🎉 Database setup completed successfully!');
    console.log('\n📋 Next steps:');
    console.log('1. Update your .env file with the database credentials');
    console.log('2. Run: npm run migrate (if you have migration scripts)');
    console.log('3. Start your application: npm start');

    console.log('\n🔐 Security Reminder:');
    console.log('- Change the default database password in production');
    console.log('- Use strong passwords for database users');
    console.log('- Consider using connection pooling in production');

  } catch (error) {
    console.error('❌ Database setup failed:', error.message);
    console.log('\n🔍 Troubleshooting:');
    console.log('1. Make sure PostgreSQL is running');
    console.log('2. Check your PostgreSQL credentials');
    console.log('3. Ensure you have superuser privileges');
    console.log('4. Check if the port is correct (default: 5432)');
    process.exit(1);
  }
}

// Run setup if called directly
if (require.main === module) {
  setupDatabase().catch(console.error);
}

module.exports = { setupDatabase };