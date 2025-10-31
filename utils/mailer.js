const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.MAIL_USER,
    pass: process.env.MAIL_PASS,
  },
});

// 🧩 Verify transporter connection on startup
(async () => {
  try {
    console.log(`🔍 Verifying SMTP connection to ${process.env.MAIL_HOST}:${process.env.MAIL_PORT}...`);
    await transporter.verify();
    console.log("✅ SMTP connection verified successfully!");
  } catch (err) {
    console.error("❌ SMTP connection failed:", err.message);
  }
})();

// 🪲 Listen for socket-level connection issues
transporter.on("error", (err) => {
  console.error("🚨 Transporter error:", err.message);
});
transporter.on("idle", () => {
  console.log("📡 Transporter is idle and ready for new messages.");
});

/**
 * Sends an email using the configured transporter.
 * @param {Object} options - Email options
 * @param {string | string[]} options.to - Recipient email address(es)
 * @param {string} options.subject - Subject of the email
 * @param {string} [options.text] - Plain text content of the email
 * @param {string} [options.html] - HTML content of the email
 * @returns {Promise<void>}
 * @throws {Error} If email sending fails
 */
const sendMail = async ({ to, subject, text, html }) => {
  try {
    if (!to || !subject) {
      throw new Error("Recipient email and subject are required");
    }

    const recipients = Array.isArray(to) ? to.join(", ") : to;

    const mailOptions = {
      from: `"Project Manager" <${process.env.MAIL_USER}>`,
      to: recipients,
      subject,
      text: text || undefined,
      html: html || undefined,
    };

    await transporter.sendMail(mailOptions);
    console.log(`Email sent successfully to ${recipients}`);
  } catch (error) {
    throw new Error(`Failed to send email: ${error.message}`);
  }
};

module.exports = sendMail;


// const nodemailer = require("nodemailer");

// // Create transporter
// const transporter = nodemailer.createTransport({
//   host: process.env.MAIL_HOST,
//   port: process.env.MAIL_PORT || 465,
//   secure: Number(process.env.MAIL_PORT) === 465, // true for SSL, false for TLS
//   auth: {
//     user: process.env.MAIL_USER,
//     pass: process.env.MAIL_PASS,
//   },
//   connectionTimeout: 15000, // 15 seconds timeout
//   greetingTimeout: 10000,
//   socketTimeout: 20000,
// });

// // 🧩 Verify transporter connection on startup
// (async () => {
//   try {
//     console.log(`🔍 Verifying SMTP connection to ${process.env.MAIL_HOST}:${process.env.MAIL_PORT}...`);
//     await transporter.verify();
//     console.log("✅ SMTP connection verified successfully!");
//   } catch (err) {
//     console.error("❌ SMTP connection failed:", err.message);
//   }
// })();

// // 🪲 Listen for socket-level connection issues
// transporter.on("error", (err) => {
//   console.error("🚨 Transporter error:", err.message);
// });
// transporter.on("idle", () => {
//   console.log("📡 Transporter is idle and ready for new messages.");
// });

// /**
//  * Sends an email using the configured transporter.
//  * @param {Object} options - Email options
//  * @param {string | string[]} options.to - Recipient email address(es)
//  * @param {string} options.subject - Subject of the email
//  * @param {string} [options.text] - Plain text content
//  * @param {string} [options.html] - HTML content
//  */
// const sendMail = async ({ to, subject, text, html }) => {
//   try {
//     if (!to || !subject) throw new Error("Recipient email and subject are required");

//     const recipients = Array.isArray(to) ? to.join(", ") : to;

//     const mailOptions = {
//       from: `"Project Manager" <${process.env.MAIL_USER}>`,
//       to: recipients,
//       subject,
//       text: text || undefined,
//       html: html || undefined,
//     };

//     const info = await transporter.sendMail(mailOptions);
//     console.log(`✅ Email sent successfully to ${recipients}`);
//     console.log(`📬 Message ID: ${info.messageId}`);
//   } catch (error) {
//     console.error("❌ Email sending failed:", error.message);
//     throw new Error(`Failed to send email: ${error.message}`);
//   }
// };

// module.exports = sendMail;
