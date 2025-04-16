const nodemailer = require('nodemailer');

// Configure email transporter
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASSWORD
  }
});

// Send OTP email
exports.sendOTPEmail = async (email, otp) => {
  try {
    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: email,
      subject: 'Your OTP Code',
      html: `
        <h2>One-Time Password</h2>
        <p>Your OTP code is: <strong>${otp}</strong></p>
        <p>This code will expire in 10 minutes.</p>
      `
    };

    await transporter.sendMail(mailOptions);
    return true;
  } catch (error) {
    console.error('Error sending OTP email:', error);
    return false;
  }
};

exports.sendNewProjectEmailToAdmin = async (adminEmails, project) => {
  try {
    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: adminEmails.join(","),
      subject: `New Project Created - ${project.name}`,
      html: `
        <h2>New Project Created</h2>
        <p>A new project is created in Boson platform.</p>
        <ul>
          <li><strong>Project Name:</strong> ${project.name}</li>
        </ul>
      `
    };

    await transporter.sendMail(mailOptions);
  } catch (error) {
    console.error("Error sending new project email:", error);
  }
};

exports.sendProjectAssignedEmail = async (manager, project, assignedBy) => {
  try {

    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: manager?.email,
      subject: `New Project assigned to you - ${project.name}`,
      html: `
        <h2>New Project Assignment</h2>
        <p>You are assigned ownership of a new project.</p>
        <ul>
          <li>
          <strong>Project Name:</strong> 
            <a href="${process.env.FRONTEND_URL}/project-detail/${project.id}">
               ${project.name}
            </a>
          </li>
          <li><strong>Assigned By:</strong> ${assignedBy}</li>
        </ul>
        <p>You can start planning & monitoring tasks for the above project in the Boson platform. For any doubt, please reach out to the Admin.</p>
      `
    };

    const info = await transporter.sendMail(mailOptions);
    console.log("Email sent successfully:", info.response); // Debugging Log
  } catch (error) {
    console.error("Error sending project assignment email:", error.message);
  }
};

exports.sendTaskAssignedEmailToTechnician = async (technician, task, project) => {
  const mailOptions = {
    from: process.env.EMAIL_USER, // your sender email
    to: technician?.email,
    subject: `Task assigned to you in ${project.name}`,
    html: `
      <h2>New Task Assignment</h2>
      <p>You have been assigned ownership of a task:</p>
      <ul>
        <li><strong>Task:</strong> ${task.name}</li>
        <li><strong>Project:</strong> ${project.name}</li>
      </ul>
      <p>Please make sure to upload daily updates for this task and complete it within the deadline.</p>
    `,
  };
  await transporter.sendMail(mailOptions);
};

exports.sendTaskSubmittedEmailToPM = async (owner, task, project) => {
  try {
    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: owner?.email,
      subject: `Task Submitted for Review - ${project.name}`,
      html: `
        <h2>Task Submitted for Review</h2>
        <p>A task has been submitted for review in project <strong>${project.name}</strong>.</p>
        <ul>
          <li><strong>Task Name:</strong> ${task.name}</li>
          <li><strong>Review Date:</strong> ${new Date(task.reviewDate).toLocaleDateString()}</li>
        </ul>
        <p>Please log in to the Boson platform to review the task.</p>
      `
    };
    await transporter.sendMail(mailOptions);
  } catch (error) {
    console.error("Error sending task submitted email:", error.message);
  }
};

exports.sendTaskResubmittedEmailToTechnician = async (owner, task, resubmittedBy) => {
  try {
    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: owner?.email,
      subject: `Task Resubmitted: ${task.name}`,
      html: `
        <h2>Task Resubmitted</h2>
        <p>Dear ${owner.name},</p>
        <p>The following task has been resubmitted by <strong>${resubmittedBy}</strong>:</p>
        <ul>
          <li><strong>Task:</strong> ${task.name}</li>
          <li><strong>Project:</strong> ${task.project.name}</li>
          <li><strong>Product:</strong> ${task.project.product ? task.project.product.name : "N/A"}</li>
        </ul>
        <p>Please connect with your Project Manager and update the task accordingly.</p>
      `,
    };

    await transporter.sendMail(mailOptions);
  } catch (error) {
    console.error("Error sending resubmitted task email:", error.message);
  }
};

exports.sendProjectDeletedEmail = async (adminEmailList, projectName, deleterName, deletionDate) => {
  try {
    const formattedDate = new Date(deletionDate).toLocaleString();
    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: adminEmailList.join(","),  // Comma-separated list of emails
      subject: "Project Deleted",
      html: `
        <h2>Project Deleted Notification</h2>
        <p>Please note that <strong>${projectName}</strong> was deleted by <strong>${deleterName}</strong> on <strong>${formattedDate}</strong>.</p>
        <p>This project will no longer be accessible for team members on the platform.</p>
        <p>For any queries, please contact the support team.</p>
      `,
    };

    await transporter.sendMail(mailOptions);
    return true;
  } catch (error) {
    console.error("Error sending project deleted email:", error.message);
    return false;
  }
};

exports.sendProjectMaintenanceEmail = async (adminEmailList, pmEmailList, projectName) => {
  try {
    const recipients = [...adminEmailList, ...pmEmailList].join(",");

    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: recipients,
      subject: `${projectName} is moving to Maintenance stage`,
      html: `
        <h2>Project Maintenance Notification</h2>
        <p>Please note that Installation and Commissioning for <strong>${projectName}</strong> is completed. Thus, the project is now moving to the Maintenance stage.</p>
        <p>Respective Managers, please plan the maintenance schedule for this project.</p>
      `,
    };

    await transporter.sendMail(mailOptions);
    return true;
  } catch (error) {
    console.error("Error sending project maintenance email:", error.message);
    return false;
  }
};

exports.sendDelayedTaskEmail = async (details) => {
  console.log("Email Details:", details);

  // Ensure valid details exist
  if (!details || !details.email) {
    console.warn("⚠️ Skipping email, missing recipient details:", details);
    return;
  }

  const mailOptions = {
    from: process.env.EMAIL_USER,
    to: details.email, // Send to a single email instead of iterating over recipients
    subject: `Delayed Task: ${details.taskName} in ${details.projectName}`,
    html: `
      <h2>Task Delayed</h2>
      <p>The following task in <strong>${details.projectName}</strong> is delayed:</p>
      <ul>
        <li><strong>Task:</strong> ${details.taskName}</li>
        <li><strong>Delayed By:</strong> ${details.delayDays} days</li>
        <li><strong>Product:</strong> ${details.productName}</li>
        <li><strong>Timeline:</strong> ${details.timeline}</li>
        <li><strong>Primary Owner:</strong> ${details.primaryOwner}</li>
        <li><strong>Secondary Owner:</strong> ${details.secondaryOwner}</li>
      </ul>
      <p>Please ensure the task is updated promptly.</p>
    `,
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log(`✅ Email sent to: ${details.email}`);
  } catch (error) {
    console.error(`❌ Error sending email to ${details.email}:`, error);
  }
};
