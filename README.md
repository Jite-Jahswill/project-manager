# 🛠️ Project Management Backend

A powerful Node.js-based RESTful API designed to manage **projects**, **tasks**, **teams**, **reports**, and **clients**. Built with **Express.js**, **Sequelize ORM**, and **MySQL**, this backend includes features like JWT authentication, role-based access control, automated email notifications, file uploads, and Swagger API docs.

---

## 🚀 Features

- 🔐 **User Authentication** – JWT-based login and access control
- 👥 **Role-Based Access** – Admin, Manager, and Staff permissions
- 📁 **Project Management** – CRUD projects, assign teams and clients
- ✅ **Task Tracking** – Assign, update, and track task status (To Do, In Progress, Review, Done)
- 📝 **Reports** – Users submit reports tied to specific projects
- 📧 **Email Notifications** – Triggered on key actions like task assignments
- 📎 **File Uploads** – Support for user avatars, documents, etc.
- ⏰ **Scheduled Jobs** – Automated reminders using `node-cron`
- 📚 **API Documentation** – Fully documented via Swagger UI

---

## ⚙️ Prerequisites

- **Node.js** v22.9.0+
- **MySQL** v8.0+
- **npm** v10.8.1+
- **`.env`** file – Based on `.env.example` for config

---

## 📦 Installation

### 1. Clone the Repo

```bash
git clone https://github.com/Jite-Jahswill/project-manager.git
cd project-manager


User Authentication: JWT-based authentication for secure access.
Role-Based Access Control: Admins and managers can create/update/delete projects, tasks, and teams, while staff can view assigned tasks and submit reports.
Project Management: Create, update, delete projects, assign teams or clients, and update project statuses.
Task Management: Create, update, delete tasks, assign them to users, and track status (To Do, In Progress, Review, Done).
Report Generation: Users can create and manage reports tied to projects.
Email Notifications: Sends emails for task assignments, project updates, and other events using Nodemailer.
File Uploads: Supports file uploads via Multer (e.g., for user profiles or project documents).
Scheduled Tasks: Uses node-cron for automated tasks (e.g., reminders or cleanup).
API Documentation: Swagger UI available at /api-docs for interactive API exploration.


Install Dependencies:
npm install


Set Up Environment Variables: Create a .env file in the root directory and configure it based on .env.example. Example:
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=yourpassword
DB_NAME=project_management
JWT_SECRET=your_jwt_secret
EMAIL_USER=your_email@example.com
EMAIL_PASS=your_email_password


Set Up the Database:

Ensure MySQL is running.

Create a database named project_management:
CREATE DATABASE project_management;


Run Sequelize migrations to set up the database schema:
npx sequelize-cli db:migrate


Optionally, seed the database with initial data:
npx sequelize-cli db:seed:all




Start the Server:

For development (with auto-restart via Nodemon):
npm run dev


For production:
node server.js



The server will run on http://localhost:8000 (or the port specified in .env).


API Usage
The API is accessible at http://localhost:8000/api. Use Swagger UI at http://localhost:8000/api-docs to explore and test endpoints interactively.
Authentication

Login: POST /api/auth/login
{
  "email": "john.doe@example.com",
  "password": "password123"
}

Response:
{
  "token": "jwt_token"
}


All endpoints require a Bearer token in the Authorization header.


Key Endpoints



Resource
Endpoint
Description



Projects
POST /api/projects/create
Create a new project



POST /api/projects/assign
Assign a team to a project



GET /api/projects/:projectId/members
Get project members



PATCH /api/projects/:projectId/status
Update project status



POST /api/projects/:projectId/clients
Add a client to a project


Tasks
POST /api/tasks
Create a new task



GET /api/tasks/project/:projectId
Get tasks for a project



PUT /api/tasks/:taskId/status
Update task status



DELETE /api/tasks/:taskId
Delete a task


Reports
POST /api/reports
Create a new report



GET /api/reports?projectId=1&userName=John
Get reports with filters



PUT /api/reports/:id
Update a report



DELETE /api/reports/:id
Delete a report


Users
POST /api/users/register
Register a new user



GET /api/users/profile
Get user profile


Clients
POST /api/clients
Create a new client



POST /api/projects/:projectId/clients
Assign a client to a project


Example Request
Create a Task:
curl -X POST http://localhost:8000/api/tasks \
-H "Authorization: Bearer <your_jwt_token>" \
-H "Content-Type: application/json" \
-d '{
  "title": "Design Homepage",
  "description": "Create wireframes and mockups for the homepage",
  "dueDate": "2025-07-20",
  "projectId": 1,
  "assignedTo": 1,
  "status": "To Do"
}'

Response:
{
  "message": "Task created successfully",
  "task": {
    "id": 1,
    "title": "Design Homepage",
    "description": "Create wireframes and mockups for the homepage",
    "dueDate": "2025-07-20",
    "projectId": 1,
    "assignedTo": 1,
    "status": "To Do",
    "createdAt": "2025-07-11T12:00:00Z",
    "User": {
      "id": 1,
      "firstName": "John",
      "lastName": "Doe",
      "email": "john.doe@example.com"
    },
    "Project": {
      "id": 1,
      "name": "Website Redesign"
    }
  }
}

Project Structure
project-management-backend/
├── controllers/        # Business logic for API endpoints
├── middlewares/        # Authentication and authorization middleware
├── models/             # Sequelize models (User, Project, Task, etc.)
├── routes/             # Express route definitions
├── migrations/         # Sequelize database migrations
├── seeders/           # Sequelize seed data
├── server.js           # Main server entry point
├── package.json        # Project metadata and dependencies
├── .env.example        # Example environment variables
└── README.md           # Project documentation

Dependencies

bcryptjs: Password hashing
body-parser: Parse incoming request bodies
cors: Enable Cross-Origin Resource Sharing
dotenv: Load environment variables
express: Web framework
jsonwebtoken: JWT authentication
multer: File upload handling
mysql2: MySQL database driver
node-cron: Scheduled tasks
nodemailer: Email notifications
sequelize: ORM for MySQL
swagger-jsdoc: Generate Swagger documentation
swagger-ui-express: Serve Swagger UI
nodemon (dev): Auto-restart server during development

Scripts

npm run dev: Start the server with Nodemon for development
npm test: Placeholder for tests (not implemented)

Database Schema
Key tables include:



Table
Columns



Users
id, firstName, lastName, email, password, role (admin, manager, staff), createdAt, updatedAt


Projects
id, name, description, startDate, endDate, status, createdAt, updatedAt


Tasks
id, title, description, dueDate, projectId, assignedTo, status, createdAt, updatedAt


Reports
id, userId, projectId, title, content, createdAt, updatedAt


UserTeam
id, userId, projectId, role, note, createdAt, updatedAt


ProjectClient
id, projectId, clientId, createdAt, updatedAt


Run DESCRIBE <table_name>; in MySQL to inspect table structures.
Contributing

Fork the repository.

Create a feature branch:
git checkout -b feature/your-feature


Commit changes:
git commit -m "Add your feature"


Push to the branch:
git push origin feature/your-feature


Open a pull request on GitHub.


License
This project is licensed under the ISC License.
Troubleshooting

Database Connection Issues: Verify .env credentials and ensure MySQL is running.
JWT Errors: Check JWT_SECRET in .env and ensure valid tokens are used.
Email Issues: Confirm Nodemailer settings in .env and test with mailer.js.
Swagger UI: Access at http://localhost:8000/api-docs and ensure swagger-jsdoc and swagger-ui-express are installed.
Dependencies: Run npm list express swagger-jsdoc nodemailer to verify versions. Current Node.js version: 22.9.0.

For further assistance, contact the project maintainer or open an issue on GitHub.
