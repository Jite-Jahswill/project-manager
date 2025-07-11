const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.MAIL_USER,
    pass: process.env.MAIL_PASS,
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
    console.log(`Email sent successfully to ${recipients}`);
  } catch (error) {
    throw new Error(`Failed to send email: ${error.message}`);
  }
};

module.exports = sendMail;
