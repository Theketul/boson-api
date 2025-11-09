const axios = require("axios");
require("dotenv").config();
const moment = require('moment');

const BASE_URL = "https://cpaas.messagecentral.com";
const CUSTOMER_ID = process.env.MESSAGECENTRAL_CUSTOMER_ID;
const API_KEY = process.env.MESSAGECENTRAL_API_KEY;
const SENDER_ID = process.env.WHATSAPP_SENDER_ID;

async function generateToken() {
  try {
    const url = `${BASE_URL}/auth/v1/authentication/token`;
    const params = { customerId: CUSTOMER_ID, key: API_KEY, scope: "NEW" };

    const response = await axios.get(url, { params });
    return response.data.token;
  } catch (error) {
    console.error("Error generating token:", error.response?.data || error.message);
    return null;
  }
}

const isValidPhoneNumber = (number) => /^[6-9]\d{9}$/.test(number);

async function sendWhatsAppMessage(phoneNumber, templateName, variables, ctaVariables = []) {
  const token = await generateToken();
  if (!token) return false;
  if (!isValidPhoneNumber(phoneNumber)) {
    console.error("Invalid phone number:", phoneNumber);
    return false;
  }

  try {
    console.log(variables, ctaVariables);
    // Ensure variables and CTA variables are arrays and not empty
    const sanitizedVariables = Array.isArray(variables) && variables.length
      ? variables.map(v => String(v).trim().replace(/[^\w\s.]/g, "").replace(/\s+/g, " "))
      : [];

    const sanitizedCtaVariables = Array.isArray(ctaVariables) && ctaVariables.length
      ? ctaVariables.map(v => String(v)) // Convert ObjectId to string safely
      : [];

    if (sanitizedVariables.length === 0) {
      console.error("❌ Error: No variables provided for template:", templateName);
      return false;
    }

    // Encode variables for URL
    const encodedVariables = sanitizedVariables.map(encodeURIComponent).join("%2C%20");

    // Encode CTA variables for URL
    let encodedCtaVariables = "";
    if (sanitizedCtaVariables.length > 0) {
      encodedCtaVariables = "&ctaVariables=" + sanitizedCtaVariables.map(encodeURIComponent).join("%2C%20");
    }

    const queryParams = `flowType=WHATSAPP&type=BROADCAST&mobileNumber=${phoneNumber}&countryCode=91&senderId=${SENDER_ID}&langId=en_US&templateName=${templateName}&variables=${encodedVariables}${encodedCtaVariables}`;

    console.log(`🚀 Sending WhatsApp message to ${phoneNumber}...`);
    console.log(`🔍 Query Params: ${queryParams}`);

    const url = `${BASE_URL}/verification/v3/send?${queryParams}`;
    const headers = { authToken: token };

    const response = await axios.post(url, {}, { headers });
    console.log(`✅ WhatsApp message sent successfully:`, response.data);
    return true;
  } catch (error) {
    console.error("❌ Error sending WhatsApp message:", error.response?.data || error.message);
    return false;
  }
}

// Notify Admin of New Project
// exports.sendNewProjectWhatsAppToAdmin = async (adminPhoneNumbers, newProject) => {
//   for (const phone of adminPhoneNumbers) {
//     await sendWhatsAppMessage(phone, "new_project_notification_admin", [newProject.name]);
//   }
// };

// Notify PM of Project Assignment
exports.sendProjectAssignedWhatsApp = async (manager, project, assignedBy) => {
  const projectUrl = `https://ops.waters.co.in/project-detail/${project._id}`;
  console.log(projectUrl);
  return await sendWhatsAppMessage(
    manager.phoneNo,
    "project_assignment_project_manager",
    // "project_assignment_manager",
    // "project_assignment_notification",
    [project.name, assignedBy],
    [project._id]
  );
};

// Notify Technician of Task Assignment
exports.sendTaskAssignedWhatsAppToTechnician = async (technician, task, project) => {
  console.log("Task id ", task._id);
  return await sendWhatsAppMessage(
    technician.phoneNo,
    "task_assignment_tech",
    // "task_assignment_technician"
    // "task_assignment_notification_technician",
    [task.name, project.name],
    [task._id]
  );
};

// Notify PM of Task Submission
exports.sendTaskSubmittedWhatsAppToPM = async (owner, task, project, technician) => {
  const formattedDate = formatDate(task?.reviewDate);
  return await sendWhatsAppMessage(
    owner.phoneNo,
    "task_submission_project_manager",
    // "task_submission_manager",
    // "task_submission_notif",
    [technician.name, task.name, project.name, project.product.name, formattedDate], // Updated variables
    // [task._id, project._id]
    [task._id]

  );
};

// Notify Technician of Task Resubmission
exports.sendTaskResubmittedWhatsAppToTechnician = async (technician, task, resubmittedBy) => {
  return await sendWhatsAppMessage(
    technician.phoneNo,
    "task_resubmission_project_manager",
    // "task_resubmission_manager",
    // "task_resubmission_notifi_tech",
    [
      resubmittedBy.name,
      task.name,
      task.project?.name,
      task.project?.product?.name
    ],
    [task._id]
  );
};

exports.sendDelayedTaskWhatsApp = async (details) => {
  const formattedStartDate = formatDate(details?.startDate);
  const formattedEndDate = formatDate(details?.endDate);

  return await sendWhatsAppMessage(
    details.phoneNo,
    "task_delayed",
    [
      details.delayDays, 
      details.taskName, 
      details.projectName, 
      details.productName || "N/A",
      details.primaryOwner || "N/A",
      details.secondaryOwner || "N/A",
      formattedStartDate, 
      formattedEndDate
    ]
  );
};


// Notify Admin of Project Deletion
// exports.sendProjectDeletedWhatsApp = async (adminPhoneNumbers, projectName, deleterName, deletionDate) => {
//   const formattedDate = formatDate(deletionDate)

//   for (const phone of adminPhoneNumbers) {
//     await sendWhatsAppMessage(phone, "project_deletion_notif_admin", [projectName, deleterName, formattedDate]);
//   }
// };

// Notify Admin & PM of Project Maintenance
// exports.sendProjectMaintenanceWhatsApp = async (adminPhoneNumbers, pmPhoneNumbers, projectName) => {
//   const recipients = [...adminPhoneNumbers, ...pmPhoneNumbers];
//   for (const phone of recipients) {
//     await sendWhatsAppMessage(phone, "project_maintenance_notifi", [projectName]);
//   }
// };

const formatDate = (dateString) => {
  if (!dateString) return "Invalid Date";

  const date = new Date(dateString);
  if (isNaN(date)) return "Invalid Date";

  const day = date.getDate();
  const month = date.toLocaleString("en-US", { month: "long" });
  const year = date.getFullYear(); // ✅ Add Year

  const getSuffix = (day) => {
    if (day > 3 && day < 21) return "th";
    switch (day % 10) {
      case 1: return "st";
      case 2: return "nd";
      case 3: return "rd";
      default: return "th";
    }
  };

  return `${day}${getSuffix(day)} ${month} ${year}`; // ✅ Include Year in Output
};