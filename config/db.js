const { Sequelize } = require('sequelize');

// The Sequelize instance will read connection details from process.env
// The dotenv package (loaded in app.js) makes these variables available.
const sequelize = new Sequelize(
    process.env.DB_NAME,
    process.env.DB_USER,
    process.env.DB_PASSWORD,
    {
        host: process.env.DB_HOST,
        port: process.env.DB_PORT, // Standard MySQL port is 3306
        dialect: process.env.DB_DIALECT, // Should be 'mysql'
        logging: false, // Set to true to see SQL queries in the console
        define: {
            // Sequelize adds createdAt and updatedAt columns by default
            timestamps: true, 
            underscored: true, // Use snake_case for column names (e.g., created_at)
        },
        pool: {
            max: 5,
            min: 0,
            acquire: 30000,
            idle: 10000
        }
    }
);

/**
 * Attempts to authenticate the database connection and sync the models (create tables).
 */
const connectDB = async () => {
    try {
        await sequelize.authenticate();
        console.log('Database connection has been established successfully (MySQL).');
        
        // This will create tables if they do not exist
        await sequelize.sync({ alter: true }); 
        console.log('Database models synced.');
    } catch (error) {
        console.error('Unable to connect to the database:', error);
        // Exiting the process if DB connection fails is critical for backend services
        process.exit(1); 
    }
};

module.exports = { sequelize, connectDB };