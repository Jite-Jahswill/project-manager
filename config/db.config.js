const { Sequelize } = require("sequelize");
require("dotenv").config();

const sequelize = new Sequelize(
  process.env.DB_NAME,
  process.env.DB_USER,
  process.env.DB_PASSWORD,
  {
    host: process.env.DB_HOST,
    dialect: "mysql",
    logging: false,
    dialectOptions: {
      supportBigNumbers: true,
      bigNumberStrings: true,
    },
    pool: {
      max: 5,        // limit concurrent connections
      min: 0,
      acquire: 30000, // wait 30s for a connection before throwing error
      idle: 10000,   // release connection after 10s idle
      evict: 10000,  // actively remove idle connections
    },
    retry: {
      match: [
        /ETIMEDOUT/,
        /EHOSTUNREACH/,
        /ECONNRESET/,
        /ECONNREFUSED/,
        /EPIPE/,
        /SequelizeConnectionError/,
        /SequelizeConnectionRefusedError/,
        /SequelizeHostNotFoundError/,
        /SequelizeHostNotReachableError/,
        /SequelizeInvalidConnectionError/,
        /SequelizeConnectionTimedOutError/,
      ],
      max: 3, // Retry failed DB connections up to 3 times
    },
  }
);

// Optional: safe connect with retry loop
const connectWithRetry = async () => {
  try {
    await sequelize.authenticate();
    console.log("✅ Database connected successfully");
  } catch (err) {
    console.error("❌ Database connection failed. Retrying in 5s...\n", err.message);
    setTimeout(connectWithRetry, 5000);
  }
};
connectWithRetry();

// Gracefully close DB connection on Render shutdown
process.on("SIGTERM", async () => {
  console.log("🧹 Closing DB connections...");
  await sequelize.close();
  process.exit(0);
});

module.exports = sequelize;
