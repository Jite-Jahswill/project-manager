const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const sequelize = require("./config/db.config");
require("dotenv").config();
const swaggerUi = require("swagger-ui-express");
const swaggerSpec = require("./swagger");
const cron = require("node-cron");
const { sendWeeklySummary } = require("./cron/weeklySummary");

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(bodyParser.json());

// Test route
app.get("/", (req, res) => {
  res.send("Project Management Backend Running");
});

// Run every Monday at 8:00 AM
cron.schedule("0 8 * * 1", () => {
  console.log("⏰ Running weekly summary job...");
  sendWeeklySummary();
});

// Import Routes
require("./routes/auth.routes")(app);
require("./routes/project.routes")(app);
require("./routes/task.routes")(app);
require("./routes/user.routes")(app);
require("./routes/log.routes")(app);
require("./routes/leave.routes")(app);
require("./routes/report.routes")(app);
require("./routes/team.routes")(app);
require("./routes/client.routes")(app);
// In your main server.js or app.js
app.use("/uploads", express.static("uploads"));
app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));
// // (more will be added later)

sequelize.sync({ alter: true }).then(() => {
  console.log("Database synced");
  app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
});
