const { Sequelize } = require('sequelize');
const path = require('path');

// Use DATABASE_URL if available (Render), otherwise use individual vars (local dev)
const sequelize = process.env.DATABASE_URL 
  ? new Sequelize(process.env.DATABASE_URL, {
      dialect: 'postgres',
      logging: process.env.NODE_ENV === 'development' ? console.log : false,
      dialectOptions: {
        ssl: {
          require: true,
          rejectUnauthorized: false
        }
      },
      pool: {
        max: parseInt(process.env.DB_POOL_MAX) || 10,
        min: parseInt(process.env.DB_POOL_MIN) || 2,
        acquire: parseInt(process.env.DB_POOL_ACQUIRE) || 30000,
        idle: parseInt(process.env.DB_POOL_IDLE) || 10000,
      },
      define: {
        timestamps: true,
        underscored: true,
        paranoid: true,
        freezeTableName: true,
      },
    })
  : new Sequelize(
      process.env.DB_NAME || 'engipay_db',
      process.env.DB_USER || 'engipay_user',
      process.env.DB_PASSWORD || 'your_secure_password_here',
      {
        host: process.env.DB_HOST || 'localhost',
        port: process.env.DB_PORT || 5432,
        dialect: 'postgres',
        logging: process.env.NODE_ENV === 'development' ? console.log : false,
        pool: {
          max: parseInt(process.env.DB_POOL_MAX) || 10,
          min: parseInt(process.env.DB_POOL_MIN) || 2,
          acquire: parseInt(process.env.DB_POOL_ACQUIRE) || 30000,
          idle: parseInt(process.env.DB_POOL_IDLE) || 10000,
        },
        define: {
          timestamps: true,
          underscored: true,
          paranoid: true,
          freezeTableName: true,
        },
        dialectOptions: {
          ssl: process.env.DB_SSL === 'true' ? {
            require: true,
            rejectUnauthorized: false
          } : false,
        },
      }
    );

// Test the connection
const testConnection = async () => {
  try {
    await sequelize.authenticate();
    console.log('✅ Database connection has been established successfully.');
    return true;
  } catch (error) {
    console.error('❌ Unable to connect to the database:', error);
    return false;
  }
};

// Sync database (create tables)
const syncDatabase = async (force = false) => {
  try {
    await sequelize.sync({ force });
    console.log(`✅ Database ${force ? 'force ' : ''}synchronized successfully.`);
    return true;
  } catch (error) {
    console.error('❌ Error synchronizing database:', error);
    return false;
  }
};

// Close database connection
const closeConnection = async () => {
  try {
    await sequelize.close();
    console.log('✅ Database connection closed.');
    return true;
  } catch (error) {
    console.error('❌ Error closing database connection:', error);
    return false;
  }
};

module.exports = {
  sequelize,
  testConnection,
  syncDatabase,
  closeConnection,
  Sequelize
};