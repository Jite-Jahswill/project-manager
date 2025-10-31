const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
  host: process.env.MAIL_HOST, // e.g. "server133.web-hosting.com"
  port: process.env.MAIL_PORT || 465, // 465 for SSL, 587 for TLS
  secure: true, // true for 465, false for 587
  auth: {
    user: process.env.MAIL_USER, // e.g. "sizco@aoudit.com"
    pass: process.env.MAIL_PASS, // e.g. "4YhTO_izfc(7"
  },
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
    console.log(`✅ Email sent successfully to ${recipients}`);
  } catch (error) {
    console.error("❌ Email sending failed:", error.message);
    throw new Error(`Failed to send email: ${error.message}`);
  }
};

module.exports = sendMail;
