const Project = require("../models/projectModel");
const Task = require("../models/taskModel");
const User = require("../models/userModel");
const cron = require("node-cron");
const { sendDelayedTaskEmail } = require("./emailService");
const { sendWhatsAppMessage, sendDelayedTaskWhatsApp } = require("./whatsappService"); // Import WhatsApp Service

const getDelayedTasksData = async () => {
  try {
    const delayedTasks = await Task.find({ status: "Delayed" })
      .populate("project")
      .populate("primaryOwner")
      .populate("secondaryOwner")
      .populate({
        path: "project",
        populate: { path: "product teamMembers.user" },
      });


    if (!delayedTasks || delayedTasks.length === 0) {
      console.log("No delayed tasks found.");
      return [];
    }

    const admins = await User.find({ role: "Admin" }).select("email phoneNo name");

    const notificationTasks = [];
    delayedTasks.forEach((task) => {
      const { project, name, startDate, endDate, primaryOwner, secondaryOwner } = task;
      const delayDays = Math.ceil((new Date() - new Date(endDate)) / (1000 * 60 * 60 * 24));

      console.log("Delayed Tasks:", project.teamMembers);

      const recipients = new Set();

      if (primaryOwner?.email || primaryOwner?.phoneNo) recipients.add(primaryOwner);
      if (secondaryOwner?.email || secondaryOwner?.phoneNo) recipients.add(secondaryOwner);

      if (project.teamMembers) {
        project.teamMembers.forEach((member) => {
          if (
            ["primaryProjectManager", "secondaryProjectManager"].includes(member.role) &&
            (member.user?.email || member.user?.phoneNo)
          ) {
            recipients.add(member.user);
          }
        });
      }

      admins.forEach((admin) => recipients.add(admin));

      recipients.forEach((user) => {
        if (user?.email || user?.phoneNo) {
          notificationTasks.push({
            name: user.name,
            email: user.email,
            phoneNo: user.phoneNo,
            projectName: project.name,
            productName: project.product?.name || "N/A",
            taskName: name,
            delayDays,
            timeline: `${new Date(startDate).toLocaleDateString()} - ${new Date(endDate).toLocaleDateString()}`,
            startDate: new Date(startDate),
            endDate: new Date(endDate),
            primaryOwner: primaryOwner?.name || "N/A",
            secondaryOwner: secondaryOwner?.name || "N/A",
          });
        }
      });
    });

    return notificationTasks;
  } catch (error) {
    console.error("Error fetching delayed tasks:", error);
    return [];
  }
};

const sendDelayedTaskNotifications = async () => {
  try {
    console.log("Fetching delayed task notifications...");

    const notifications = await getDelayedTasksData();

    if (!Array.isArray(notifications)) {
      console.error("Error: getDelayedTasksData() did not return an array!", notifications);
      return;
    }

    if (notifications.length === 0) {
      console.log("No delayed tasks found.");
      return;
    }

    for (const notification of notifications) {
      const message = `Hello ${notification.name},\n\nYour task "${notification.taskName}" is delayed.\nProject: ${notification.projectName}\nProduct: ${notification.productName}\nDelayed by: ${notification.delayDays} days\nTimeline: ${notification.timeline}\nPrimary Owner: ${notification.primaryOwner}\nSecondary Owner: ${notification.secondaryOwner}\n\nPlease take immediate action.\n\nThank you.`;

      if (notification.email) {
        await sendDelayedTaskEmail(notification);
        console.log(`✅ Email sent to: ${notification.email}`);
      }

      if (notification.phoneNo) {
        await sendDelayedTaskWhatsApp(notification);
        console.log(`✅ WhatsApp message sent to: ${notification.phoneNo}`);
      }
    }

    console.log("✅ All delayed task notifications sent successfully.");
  } catch (error) {
    console.error("❌ Error in sending delayed task notifications:", error);
  }
};

// Schedule the function to run every 2 days
// cron.schedule("*/5 * * * *", sendDelayedTaskNotifications);
// cron.schedule("0 0 */2 * *", sendDelayedTaskNotifications);

module.exports = sendDelayedTaskNotifications;
