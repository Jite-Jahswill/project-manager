const db = require("../models");
const { sendMail } = require("../utils/mailer");
const { Op } = require("sequelize");
const moment = require("moment");

const WorkLog = db.WorkLog;
const User = db.User;
const Task = db.Task;
const Project = db.Project;

exports.sendWeeklySummary = async () => {
  const startOfWeek = moment().startOf("isoWeek").toDate(); // Monday
  const endOfWeek = moment().endOf("isoWeek").toDate(); // Sunday

  try {
    const users = await User.findAll();

    const userSummaries = [];

    for (const user of users) {
      // Fetch work logs for user for the week
      const logs = await WorkLog.findAll({
        where: {
          userId: user.id,
          createdAt: { [Op.between]: [startOfWeek, endOfWeek] },
        },
        include: [{ model: Task }],
      });

      const hoursWorked = logs.reduce((sum, log) => sum + log.hoursWorked, 0);
      const completedTasks = logs.filter(
        (log) => log.Task?.status === "Done"
      ).length;

      // Overdue tasks
      const overdueTasks = await Task.count({
        where: {
          assignedTo: user.id,
          status: { [Op.not]: "In Progress" },
          dueDate: { [Op.lt]: new Date() },
        },
      });

      // Send to user
      await sendMail(
        user.email,
        "📊 Your Weekly Work Summary",
        `<p>Hello ${user.firstName},</p>
        <p>This week you:</p>
        <ul>
          <li>✅ Completed <strong>${completedTasks}</strong> tasks</li>
          <li>⏱️ Worked <strong>${hoursWorked}</strong> hours</li>
          <li>⚠️ You have <strong>${overdueTasks}</strong> overdue tasks. Please complete them ASAP.</li>
        </ul>
        <p>Have a great week ahead!</p>`
      );

      // Prepare for admin summary
      userSummaries.push({
        name: `${user.firstName} ${user.lastName}`,
        email: user.email,
        hoursWorked,
        completedTasks,
      });
    }

    // Admin & Manager summary
    const admins = await User.findAll({
      where: { role: ["admin", "manager"] },
      attributes: ["email", "firstName"],
    });

    const summaryTable = userSummaries
      .map(
        (u) =>
          `<tr>
            <td>${u.name}</td>
            <td>${u.email}</td>
            <td>${u.completedTasks}</td>
            <td>${u.hoursWorked}</td>
          </tr>`
      )
      .join("");

    const html = `
      <p>Hello Admin/Manager,</p>
      <p>Here is the weekly user summary:</p>
      <table border="1" cellpadding="5" cellspacing="0">
        <tr>
          <th>Name</th>
          <th>Email</th>
          <th>Tasks Completed</th>
          <th>Hours Worked</th>
        </tr>
        ${summaryTable}
      </table>
    `;

    for (const admin of admins) {
      await sendMail(admin.email, "📋 Weekly WorkLog Summary", html);
    }

    console.log("✅ Weekly summaries sent.");
  } catch (err) {
    console.error("❌ Error sending summaries:", err);
  }
};
