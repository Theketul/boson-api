const nodemailer = require('nodemailer');
const fs = require('fs').promises;
const path = require('path');
const handlebars = require('handlebars');

const EMAIL_CONFIG = {
    SMTP: {
        service: 'Gmail',
        host: "smtp.gmail.com",
        port: 465,
        secure: true
    },
    SENDER: {
        email: process.env.EMAIL_USER || 'your-email@gmail.com',
        name: process.env.COMPANY_NAME || 'Your Company Name'
    },
    TEMPLATE_DIR: path.join(__dirname, 'template')
};

class EmailService {
    constructor() {
        this.transporter = nodemailer.createTransport({
            ...EMAIL_CONFIG.SMTP,
            auth: {
                user: process.env.EMAIL_USER,
                pass: process.env.EMAIL_PASSWORD
            }
        });
    }

    async loadTemplate(fileName) {
        try {
            const filePath = path.join(EMAIL_CONFIG.TEMPLATE_DIR, fileName);
            const template = await fs.readFile(filePath, 'utf-8');
            return handlebars.compile(template);
        } catch (error) {
            console.error('Template loading error:', error);
            throw new Error(`Failed to load email template: ${fileName}`);
        }
    }

    async sendEmail(to, subject, template, data) {
        try {
            const compiledTemplate = await this.loadTemplate(template);
            const html = compiledTemplate(data);

            const mailOptions = {
                from: `"${EMAIL_CONFIG.SENDER.name}" <${EMAIL_CONFIG.SENDER.email}>`,
                to,
                subject,
                html
            };

            const info = await this.transporter.sendMail(mailOptions);
            return {
                success: true,
                messageId: info.messageId,
                response: info.response
            };

        } catch (error) {
            console.error('Email sending error:', error);
            throw new Error(`Failed to send email to ${to}`);
        }
    }

    async sendLoginNotification(userEmail, loginData) {
        return this.sendEmail(
            userEmail,
            'New Login Detected',
            'login-notification.html',
            loginData
        );
    }
}

const emailService = new EmailService();

module.exports = {
    emailService,
    EMAIL_CONFIG
};



const emailServicedata = async () => {
    try {
        await emailService.sendLoginNotification('user@example.com', {
            userName: 'John Doe',
            loginTime: new Date().toLocaleString(),
            device: 'Chrome Windows',
            location: 'New York'
        });
    } catch (error) {
        console.error('Login notification failed:', error);
    }
}
