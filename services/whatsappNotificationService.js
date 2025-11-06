const { sendWhatsAppTemplate } = require("../utils/metaWhatsappService");
const { formatDate } = require("../utils/dateUtils"); // assuming you already have this

exports.sendProjectAssignedWhatsApp = async (manager, project, assignedBy) => {
  try {
    const ctaParam = project._id.toString(); // dynamic part for CTA
    return await sendWhatsAppTemplate(
      manager.phoneNo,
      "project_assignment_project_manager",
      [project.name, assignedBy],
      ctaParam
    );
  } catch (err) {
    console.error("❌ sendProjectAssignedWhatsApp error:", err.message);
  }
};

exports.sendTaskAssignedWhatsAppToTechnician = async (technician, task, project) => {
  try {
    const ctaParam = task._id.toString();
    return await sendWhatsAppTemplate(
      technician.phoneNo,
      "task_assignment_tech",
      [task.name, project.name],
      ctaParam
    );
  } catch (err) {
    console.error("❌ sendTaskAssignedWhatsAppToTechnician error:", err.message);
  }
};

exports.sendTaskSubmittedWhatsAppToPM = async (owner, task, project, technician) => {
  try {
    const formattedDate = formatDate(task?.reviewDate);
    const ctaParam = task._id.toString();
    return await sendWhatsAppTemplate(
      owner.phoneNo,
      "task_submission_project_manager",
      [
        technician.name,
        task.name,
        project.name,
        project.product.name,
        formattedDate,
      ],
      ctaParam
    );
  } catch (err) {
    console.error("❌ sendTaskSubmittedWhatsAppToPM error:", err.message);
  }
};

exports.sendTaskResubmittedWhatsAppToTechnician = async (technician, task, resubmittedBy) => {
  try {
    const ctaParam = task._id.toString();
    return await sendWhatsAppTemplate(
      technician.phoneNo,
      "task_resubmission_project_manager",
      [
        resubmittedBy.name,
        task.name,
        task.project?.name,
        task.project?.product?.name,
      ],
      ctaParam
    );
  } catch (err) {
    console.error("❌ sendTaskResubmittedWhatsAppToTechnician error:", err.message);
  }
};

exports.sendDelayedTaskWhatsApp = async (details) => {
  try {
    const formattedStartDate = formatDate(details?.startDate);
    const formattedEndDate = formatDate(details?.endDate);
    const taskId = details.taskId || details._id?.toString(); // Get task ID for URL

    return await sendWhatsAppTemplate(
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
        formattedEndDate,
      ],
      taskId // Pass task ID for the button URL
    );
  } catch (err) {
    console.error("❌ sendDelayedTaskWhatsApp error:", err.message);
  }
};
