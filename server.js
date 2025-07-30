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
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Project Management Backend</title>
        <style>
            body {
                display: flex;
                justify-content: center;
                align-items: center;
                height: 100vh;
                margin: 0;
                background-color: #f4f4f9;
                font-family: Arial, sans-serif;
            }
            .container {
                text-align: center;
                background-color: #ffffff;
                padding: 50px;
                border-radius: 10px;
                box-shadow: 0 4px 20px rgba(0, 0, 0, 0.1);
            }
            h1 {
                color: #333;
                font-size: 2.5em;
            }
            p {
                color: #666;
                font-size: 1.2em;
            }
            .footer {
                margin-top: 20px;
                font-size: 0.9em;
                color: #999;
            }
        </style>
    </head>
    <body>
        <div class="container">
            <h1>Project Management Backend</h1>
            <p>Backend is Running Smoothly!</p>
            <div class="footer">© 2025 Project Management Team</div>
        </div>
    </body>
    </html>
  `);
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
