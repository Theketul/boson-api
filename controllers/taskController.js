const mongoose = require("mongoose");
const User = require("../models/userModel");
const Task = require("../models/taskModel");
const Project = require("../models/projectModel");
const ServiceReport = require("../models/serviceReportModel");
const Product = require("../models/productModel");
const Forms = require("../models/formModel");
const DailyUpdate = require("../models/dailyUpdateModel");
const MongoUtils = require("../utils/mongo-utils");

const {
  sendTaskAssignedEmailToTechnician,
  sendTaskSubmittedEmailToPM,
  sendTaskResubmittedEmailToTechnician,
} = require("../utils/emailService");
const {
  determineTaskStatus,
  updateTaskStatusAndSave,
  calculateTaskDates,
  getDatesInRange,
  generateDates,
} = require("../utils/functions");
const moment = require("moment");
const { deleteFileFromS3 } = require("../utils/awsbucket");
const { sendTaskAssignedWhatsAppToTechnician, sendTaskSubmittedWhatsAppToPM, sendTaskResubmittedWhatsAppToTechnician } = require("../services/whatsappNotificationService");

const updateDailyUpdates = async (task) => {
  try {
    if (!task.startDate || !task.endDate) return;
    const desiredDates = [];
    const mStart = moment(task.startDate);
    const mEnd = moment(task.endDate);
    while (mStart.isSameOrBefore(mEnd, "day")) {
      desiredDates.push(mStart.format("YYYY-MM-DD"));
      mStart.add(1, "day");
    }

    const existingUpdates = await DailyUpdate.find({ taskId: task._id });
    const existingDatesSet = new Set(
      existingUpdates.map((update) => moment(update.date).format("YYYY-MM-DD"))
    );
    const desiredDatesSet = new Set(desiredDates);

    const updatesToDelete = existingUpdates.filter((update) => {
      const updateDateStr = moment(update.date).format("YYYY-MM-DD");
      return !desiredDatesSet.has(updateDateStr);
    });
    if (updatesToDelete.length > 0) {
      const deleteIds = updatesToDelete.map((update) => update._id);
      await DailyUpdate.deleteMany({ _id: { $in: deleteIds } });
    }

    const missingDates = desiredDates.filter(
      (dateStr) => !existingDatesSet.has(dateStr)
    );
    const newUpdates = missingDates.map((dateStr) => ({
      taskId: task._id,
      date: new Date(dateStr),
    }));
    if (newUpdates.length > 0) {
      await DailyUpdate.insertMany(newUpdates);
    }
  } catch (error) {
    console.error("Error updating daily updates:", error.message);
  }
};

const syncProjectTechnicians = async (projectId) => {
  const tasks = await Task.find({ project: projectId })
    .select("primaryOwner secondaryOwner")
    .lean();
  const technicianIds = new Set();

  tasks.forEach((task) => {
    if (task.primaryOwner) {
      technicianIds.add(task.primaryOwner.toString());
    }
    if (task.secondaryOwner) {
      technicianIds.add(task.secondaryOwner.toString());
    }
  });

  const project = await Project.findById(projectId);
  if (!project) {
    throw new Error("Project not found");
  }

  let newTeamMembers = project.teamMembers.filter(
    (member) => member.role !== "Technician"
  );

  technicianIds.forEach((techId) => {
    newTeamMembers.push({
      role: "Technician",
      user: new mongoose.Types.ObjectId(techId),
    });
  });

  const seenTechnicians = new Set();
  newTeamMembers = newTeamMembers.filter((member) => {
    if (member.role === "Technician") {
      const idStr = member.user.toString();
      if (seenTechnicians.has(idStr)) return false;
      seenTechnicians.add(idStr);
    }
    return true;
  });

  project.teamMembers = newTeamMembers;
  await project.save();
  return project;
};

exports.createTask = async (req, res) => {
  const {
    projectId,
    projectStage,
    name,
    startDate,
    endDate,
    primaryOwner,
    secondaryOwner,
    serviceReport,
    remarks,
  } = req.body;

  try {
    if (!projectId || !projectStage || !name) {
      return res.handler.response(
        STATUS_CODES.BAD_REQUEST,
        "Required fields are missing"
      );
    }

    if (isNaN(new Date(startDate)) || isNaN(new Date(endDate))) {
      return res.handler.response(
        STATUS_CODES.BAD_REQUEST,
        "Invalid date format"
      );
    }

    if (new Date(startDate) > new Date(endDate)) {
      return res.handler.response(
        STATUS_CODES.BAD_REQUEST,
        "Start date must be before end date"
      );
    }

    const project = await Project.findById(projectId);

    if (!project) {
      return res.handler.response(STATUS_CODES.NOT_FOUND, "Project not found");
    }

    if (new Date(startDate) < new Date(project.startDate)) {
      return res.handler.response(
        STATUS_CODES.BAD_REQUEST,
        "Task start date cannot be earlier than project start date"
      );
    }

    if (!Array.isArray(project.stages)) {
      return res.handler.response(
        STATUS_CODES.BAD_REQUEST,
        "Invalid project stages structure"
      );
    }

    const stageDoc = project.stages.find(
      (stage) => stage.name === projectStage
    );
    if (!stageDoc) {
      return res.handler.response(
        STATUS_CODES.BAD_REQUEST,
        "Project stage not found"
      );
    }

    // Process the serviceReport object:
    // If serviceReport is provided but its formId is "" or "noData", treat it as not provided.
    let processedServiceReport = null;
    if (serviceReport) {
      if (
        !serviceReport.formId ||
        serviceReport.formId.trim() === "" ||
        serviceReport.formId === "noData"
      ) {
        processedServiceReport = null;
      } else {
        if (!serviceReport.formId || !serviceReport.name) {
          return res.handler.response(
            STATUS_CODES.BAD_REQUEST,
            "Invalid service report structure"
          );
        }
        const form = await Forms.findById(serviceReport.formId);
        if (!form) {
          return res.handler.response(
            STATUS_CODES.BAD_REQUEST,
            "Service form does not exist"
          );
        }
        processedServiceReport = serviceReport;
      }
    }

    const formTemplateId = processedServiceReport ? processedServiceReport.formId : null;
    const formName = processedServiceReport ? processedServiceReport.name : "No Service Form Required";
    const status = determineTaskStatus(startDate, endDate);

    const taskData = {
      project: projectId,
      projectStage,
      status,
      name,
      startDate,
      endDate,
      primaryOwner,
      secondaryOwner: secondaryOwner && secondaryOwner.trim() !== "" ? secondaryOwner : undefined,
      remarks,
      createdBy: req.user._id,
      updatedBy: req.user._id,
    };

    const newTask = new Task(taskData);
    await newTask.save();

    const newReport = new ServiceReport({
      task: newTask._id,
      formId: formTemplateId,
      formName,
      data: {}, // Initially empty; to be updated later by user.
      updatedBy: req.user._id,
      updatedAt: new Date(),
    });
    await newReport.save();

    newTask.serviceReport = newReport._id;
    await newTask.save();

    const dates = generateDates(startDate, endDate);
    const dailyUpdates = dates.map((date) => ({
      taskId: newTask._id,
      date: date,
    }));

    const createdDailyUpdates = await DailyUpdate.insertMany(dailyUpdates);

    newTask.dailyUpdates = createdDailyUpdates.map((update) => update._id);
    await newTask.save();

    stageDoc.tasks.push(newTask._id);
    await project.save();

    // Update project team members for technicians
    const ownersToAdd = [
      { role: "Technician", user: primaryOwner },
      ...(secondaryOwner && secondaryOwner.trim() !== "" ? [{ role: "Technician", user: secondaryOwner }] : []),
    ];

    const currentTeamMembers = project.teamMembers.map((member) =>
      member.user.toString()
    );

    ownersToAdd.forEach((owner) => {
      if (!currentTeamMembers.includes(owner.user.toString())) {
        project.teamMembers.push(owner);
      }
    });

    await project.save();

    await syncProjectTechnicians(project._id);

    try {
      // Send notifications to technicians.
      const primaryTechnician = await User.findById(primaryOwner).select("email phoneNo name");
      const secondaryTechnician = secondaryOwner && secondaryOwner.trim() !== ""
        ? await User.findById(secondaryOwner).select("email phoneNo name")
        : null;
      if (primaryTechnician?.email) {
        await sendTaskAssignedEmailToTechnician(primaryTechnician, newTask, project);
      }
      if (primaryTechnician?.phoneNo) {
        await sendTaskAssignedWhatsAppToTechnician(primaryTechnician, newTask, project);
      }
      if (secondaryTechnician?.email) {
        await sendTaskAssignedEmailToTechnician(secondaryTechnician, newTask, project);
      }
      if (secondaryTechnician?.phoneNo) {
        await sendTaskAssignedWhatsAppToTechnician(secondaryTechnician, newTask, project);
      }
    } catch (notificationError) {
      console.error("Notification error:", {
        error: notificationError.message,
        stack: notificationError.stack,
      });
    }
    const populatedTask = await Task.findById(newTask._id).populate("dailyUpdates");
    return res.handler.response(STATUS_CODES.SUCCESS, "Task created successfully", { task: populatedTask });
  } catch (error) {
    console.error("Error creating task:", {
      error: error.message,
      stack: error.stack,
    });
    return res.handler.response(STATUS_CODES.SERVER_ERROR, "Error creating task");
  }
};

exports.editTask = async (req, res) => {
  try {
    const { taskId } = req.params;
    const {
      name,
      startDate,
      endDate,
      primaryOwner,
      secondaryOwner,
      projectStage,
      remarks,
      serviceReport,
    } = req.body;

    if (!mongoose.Types.ObjectId.isValid(taskId)) {
      return res.handler.response(STATUS_CODES.BAD_REQUEST, "Invalid task ID");
    }


    const task = await Task.findById(taskId).populate({
      path: "project",
      select: "name location product teamMembers",
      populate: { path: "product", select: "name productPicture" },
    });
    if (!task || !task.project) {
      return res.handler.response(
        STATUS_CODES.NOT_FOUND,
        task ? "Associated project not found" : "Task not found"
      );
    }
    const project = task.project;

    const originalPrimaryOwner = task.primaryOwner ? task.primaryOwner.toString() : null;
    const originalSecondaryOwner = task.secondaryOwner ? task.secondaryOwner.toString() : null;

    let startDateChanged = false;
    let endDateChanged = false;

    if (startDate && !isNaN(new Date(startDate).getTime())) {
      const newStartTime = new Date(startDate).getTime();
      const oldStartTime = task.startDate ? task.startDate.getTime() : 0;
      startDateChanged = newStartTime !== oldStartTime;
      task.startDate = new Date(startDate);
    } else if (startDate) {
      return res.handler.response(STATUS_CODES.BAD_REQUEST, "Invalid start date format");
    }

    if (endDate && !isNaN(new Date(endDate).getTime())) {
      const newEndTime = new Date(endDate).getTime();
      const oldEndTime = task.endDate ? task.endDate.getTime() : 0;
      endDateChanged = newEndTime !== oldEndTime;
      task.endDate = new Date(endDate);
    } else if (endDate) {
      return res.handler.response(STATUS_CODES.BAD_REQUEST, "Invalid end date format");
    }

    if (startDate && endDate && new Date(startDate) > new Date(endDate)) {
      return res.handler.response(
        STATUS_CODES.BAD_REQUEST,
        "Start date must be before end date"
      );
    }

    if (primaryOwner && !mongoose.Types.ObjectId.isValid(primaryOwner)) {
      return res.handler.response(STATUS_CODES.BAD_REQUEST, "Invalid primary owner ID");
    }
    if (secondaryOwner && !mongoose.Types.ObjectId.isValid(secondaryOwner)) {
      return res.handler.response(STATUS_CODES.BAD_REQUEST, "Invalid secondary owner ID");
    }

    if (serviceReport) {
      if (
        !serviceReport.formId ||
        serviceReport.formId.trim() === "" ||
        serviceReport.formId === "noData"
      ) {
        task.serviceReport = null;
      } else {
        const { formId, name: srName, data } = serviceReport;
        if (!formId || !srName || !mongoose.Types.ObjectId.isValid(formId)) {
          return res.handler.response(STATUS_CODES.BAD_REQUEST, "Invalid service report structure");
        }
        const form = await Forms.findById(formId);
        if (!form) {
          return res.handler.response(STATUS_CODES.NOT_FOUND, "Service form does not exist");
        }
        // Update or create the separate ServiceReport document.
        let report;
        if (task.serviceReport) {
          report = await ServiceReport.findById(task.serviceReport);
        }
        if (!report) {
          report = new ServiceReport({
            task: task._id,
            formId: form._id,
            formName: form.name,
            data: data || {},
            updatedBy: req.user._id,
            updatedAt: new Date(),
          });
        } else {
          report.formId = form._id;
          report.formName = form.name;
          if (data) {
            report.data = data;
          }
          report.updatedBy = req.user._id;
          report.updatedAt = new Date();
        }
        await report.save();
        task.serviceReport = report._id;
      }
    }

    if (remarks) task.remarks = remarks;
    if (name) task.name = name;
    if (primaryOwner) task.primaryOwner = primaryOwner;
    task.secondaryOwner = secondaryOwner && secondaryOwner.trim() !== "" ? secondaryOwner : null;
    task.updatedBy = req.user._id;

    await task.save();

    // Update daily updates if date range changed.
    if (startDateChanged || endDateChanged) {
      const updatedTaskForDates = await Task.findById(taskId);
      await updateDailyUpdates(updatedTaskForDates);
      const allUpdates = await DailyUpdate.find({ taskId });
      task.dailyUpdates = allUpdates.map((update) => update._id);
      await task.save();
    }
    try {
      // Update project team members with technician assignments.
      const ownersToAdd = [
        primaryOwner ? { role: "Technician", user: primaryOwner } : null,
        secondaryOwner ? { role: "Technician", user: secondaryOwner } : null,
      ].filter(Boolean);
      const currentTeamMembers = (project.teamMembers || [])
        .map((member) => member.user?.toString())
        .filter(Boolean);
      ownersToAdd.forEach((owner) => {
        if (owner && owner.user && !currentTeamMembers.includes(owner.user.toString())) {
          project.teamMembers.push(owner);
        }
      });
      await project.save();
    } catch (assignmentError) {
      console.error("task edit assignment error:", {
        error: assignmentError.message,
        stack: assignmentError.stack,
      });
    }

    try {
      // Send notifications if technician assignments changed.
      if (primaryOwner && primaryOwner !== originalPrimaryOwner) {
        const primaryTech = await User.findById(primaryOwner).select("email phoneNo name");
        if (primaryTech?.email) {
          await sendTaskAssignedEmailToTechnician(primaryTech, task, project);
        }
        if (primaryTech?.phoneNo) {
          await sendTaskAssignedWhatsAppToTechnician(primaryTech, task, project);
        }
      }
      if (secondaryOwner && secondaryOwner !== originalSecondaryOwner) {
        const secondaryTech = await User.findById(secondaryOwner).select("email phoneNo name");
        if (secondaryTech?.email) {
          await sendTaskAssignedEmailToTechnician(secondaryTech, task, project);
        }
        if (secondaryTech?.phoneNo) {
          await sendTaskAssignedWhatsAppToTechnician(secondaryTech, task, project);
        }
      }
    } catch (notificationError) {
      console.error("Task edit notification error:", {
        error: notificationError.message,
        stack: notificationError.stack,
      });
    }

    await syncProjectTechnicians(project._id);

    // Re-fetch the task with updated daily updates.
    const finalUpdatedTask = await Task.findById(taskId).populate("dailyUpdates");
    return res.handler.response(STATUS_CODES.SUCCESS, "Task updated successfully", finalUpdatedTask);
  } catch (error) {
    console.error("Error editing task:", error.message);
    return res.handler.response(STATUS_CODES.SERVER_ERROR, "Error editing task");
  }
};

exports.getTaskCountByStatus = async (req, res) => {
  try {
    const { projectId } = req.query; // Extract projectId from query params
    const validStatuses = [
      "To-do",
      "On-going",
      "Delayed",
      "To-review",
      "Completed",
    ];

    const matchFilter = {};

    if (projectId) {
      if (!mongoose.Types.ObjectId.isValid(projectId)) {
        return res.handler.response(
          STATUS_CODES.BAD_REQUEST,
          "Invalid project ID"
        );
      }
      matchFilter.project = new mongoose.Types.ObjectId(projectId);
    }

    if (req.user.role === "Technician") {
      matchFilter.$or = [
        { primaryOwner: req.user._id },
        { secondaryOwner: req.user._id },
      ];
    }
    // else if (req.user.role === "ProjectManager") {
    //   const assignedOrCreatedProjects = await Project.find({
    //     $or: [
    //       { createdBy: req.user._id },
    //       { "teamMembers.user": req.user._id },
    //     ],
    //   }).select("_id");

    //   const projectIds = assignedOrCreatedProjects.map(
    //     (project) => project._id
    //   );

    //   if (projectIds.length) {
    //     matchFilter.project = { $in: projectIds };
    //   } else {
    //     const response = validStatuses.reduce((acc, status) => {
    //       acc[status] = 0;
    //       return acc;
    //     }, {});

    //     return res.handler.response(
    //       STATUS_CODES.SUCCESS,
    //       "Task count fetched successfully",
    //       response
    //     );
    //   }
    // }

    const statusCounts = await Task.aggregate([
      {
        $match: matchFilter,
      },
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 },
        },
      },
    ]);

    const response = validStatuses.reduce((acc, status) => {
      const statusData = statusCounts.find((item) => item._id === status);
      acc[status] = statusData ? statusData.count : 0;
      return acc;
    }, {});

    return res.handler.response(
      STATUS_CODES.SUCCESS,
      "Task count fetched successfully",
      response
    );
  } catch (error) {
    console.error("Error fetching task counts:", error.message);
    return res.handler.response(
      STATUS_CODES.SERVER_ERROR,
      "Error fetching task counts"
    );
  }
};

exports.listTasks = async (req, res) => {
  try {
    const {
      status,
      page = 1,
      limit = 50,
      sortBy = "startDate",
      sortOrder = "desc",
    } = req.query;

    const pageNumber = parseInt(page, 10);
    const pageLimit = parseInt(limit, 10);

    const query = {};
    if (status) {
      query.status = status;
    }

    if (req.user.role === "Technician") {
      query.$or = [
        { primaryOwner: req.user._id },
        { secondaryOwner: req.user._id },
      ];
    }
    // else if (req.user.role === "ProjectManager") {
    //   const assignedOrCreatedProjects = await Project.find({
    //     $or: [
    //       { createdBy: req.user._id },
    //       { "teamMembers.user": req.user._id },
    //     ],
    //   }).select("_id");

    //   const projectIds = assignedOrCreatedProjects.map((proj) => proj._id);
    //   if (projectIds.length) {
    //     query.project = { $in: projectIds };
    //   } else {
    //     return res.handler.response(STATUS_CODES.SUCCESS, "No tasks found", {
    //       tasks: [],
    //       pagination: {
    //         totalTasksCount: 0,
    //         totalPages: 0,
    //         currentPage: pageNumber,
    //         pageLimit,
    //       },
    //     });
    //   }
    // }

    const totalTasksCount = await Task.countDocuments(query);

    const totalPages = Math.ceil(totalTasksCount / pageLimit);

    const validSortFields = ["name", "startDate", "endDate", "status"];
    const finalSortField = validSortFields.includes(sortBy) ? sortBy : "startDate";
    const finalSortOrder = sortOrder === "asc" ? 1 : -1;

    const tasks = await Task.find(query)
      .skip((pageNumber - 1) * pageLimit)
      .limit(pageLimit)
      .sort({ [finalSortField]: finalSortOrder })
      .populate({
        path: "project",
        select: "location.address name product",
        populate: {
          path: "product",
          select: "name productPicture",
        },
      })
      .populate("primaryOwner", "name profilePicture")
      .populate("secondaryOwner", "name profilePicture");

    if (!tasks.length) {
      return res.handler.response(STATUS_CODES.SUCCESS, "No tasks found", {
        tasks: [],
        pagination: {
          totalTasksCount,
          totalPages,
          currentPage: pageNumber,
          pageLimit,
        },
      });
    }

    const updatedTasks = await Promise.all(
      tasks.map(async (task) => {
        const updatedTask = await updateTaskStatusAndSave(task);
        return updatedTask.toObject();
      })
    );

    const tasksGroupedByDay = {};
    const tasksWithoutDates = []; // Group for tasks without startDate and endDate

    updatedTasks.forEach((task) => {
      const { startDate, endDate, project } = task;

      if (!startDate && !endDate) {
        tasksWithoutDates.push(task);
        return;
      }

      const dayKey = moment(startDate).format("YYYY-MM-DD");

      if (!tasksGroupedByDay[dayKey]) {
        tasksGroupedByDay[dayKey] = [];
      }

      tasksGroupedByDay[dayKey].push(task);
    });

    const todayStr = moment().format("YYYY-MM-DD");
    let dayKeysSorted = Object.keys(tasksGroupedByDay).sort((a, b) => {
      const diffA = Math.abs(moment(a, "YYYY-MM-DD").diff(moment(todayStr, "YYYY-MM-DD")));
      const diffB = Math.abs(moment(b, "YYYY-MM-DD").diff(moment(todayStr, "YYYY-MM-DD")));
      return diffA - diffB;
    });

    const groupedTasksArray = dayKeysSorted.map((day) => ({
      day,
      tasks: tasksGroupedByDay[day],
    }));

    // Add the "No Dates" group at the end
    if (tasksWithoutDates.length) {
      groupedTasksArray.push({
        day: "No Dates",
        tasks: tasksWithoutDates,
      });
    }

    // Return the result
    return res.handler.response(STATUS_CODES.SUCCESS, "Tasks fetched successfully", {
      tasks: groupedTasksArray,
      pagination: {
        totalTasksCount,
        totalPages,
        currentPage: pageNumber,
        pageLimit,
      },
    });
  } catch (error) {
    console.error("Error fetching tasks:", error.message);
    return res.handler.response(STATUS_CODES.SERVER_ERROR, "Error fetching tasks");
  }
};

exports.listTasksByProjectStage = async (req, res) => {
  const {
    projectId,
    stage,
    status,
    page = 1,
    limit = 50,
    sortBy = "startDate",
    sortOrder = "desc",
  } = req.query;

  try {
    if (!projectId) {
      return res.handler.response(
        STATUS_CODES.BAD_REQUEST,
        "Project ID is required"
      );
    }

    const query = { project: projectId };

    if (stage) {
      const validStages = [
        "Pre-requisites",
        "Installation & Commissioning",
        "Maintenance",
      ];

      if (!validStages.includes(stage)) {
        return res.handler.response(
          STATUS_CODES.BAD_REQUEST,
          "Invalid stage provided"
        );
      }

      query.projectStage = stage;
    }

    if (status) {
      const validStatuses = [
        "To-do",
        "On-going",
        "Delayed",
        "To-review",
        "Completed",
      ];

      if (!validStatuses.includes(status)) {
        return res.handler.response(
          STATUS_CODES.BAD_REQUEST,
          "Invalid status provided"
        );
      }

      query.status = status;
    }

    const validSortFields = ["name", "startDate", "endDate", "status", "stage"];
    const sortField = validSortFields.includes(sortBy) ? sortBy : "name";

    const options = {
      page: parseInt(page, 10),
      limit: parseInt(limit, 10),
      sort: { [sortField]: sortOrder === "asc" ? 1 : -1 },
      populate: [
        { path: "primaryOwner", select: "name profilePicture" },
        { path: "secondaryOwner", select: "name profilePicture" },
        {
          path: "project",
          select: "name location product",
          populate: {
            path: "product",
            select: "name productPicture",
          },
        },
      ],
    };

    const result = await MongoUtils.findWithPagination(Task, query, options);

    // if (!result || !result.data || result.data.length === 0) {
    //   return res.handler.response(STATUS_CODES.NOT_FOUND, "No tasks found");
    // }

    const updatedTasks = result.data.map((task) => task.toObject());

    return res.handler.response(
      STATUS_CODES.SUCCESS,
      "Tasks retrieved successfully",
      {
        tasks: updatedTasks,
        pagination: {
          totalTasksCount: result.total,
          totalPages: result.pages,
          currentPage: result.currentPage,
          pageLimit: limit,
        },
      }
    );
  } catch (error) {
    console.error("Error listing tasks:", error.message);
    return res.handler.response(
      STATUS_CODES.SERVER_ERROR,
      "Error retrieving tasks"
    );
  }
};

exports.listTasksForMonth = async (req, res) => {
  const { month, year } = req.query;

  if (!month || !year) {
    return res.handler.response(
      STATUS_CODES.BAD_REQUEST,
      "Month and year are required"
    );
  }

  try {
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0);

    const matchFilter = {
      startDate: { $lte: endDate },
      endDate: { $gte: startDate },
    };

    // if (req.user.role === "ProjectManager") {
    //   const projectIds = await Project.find({
    //     $or: [
    //       { "teamMembers.user": req.user._id },
    //       { createdBy: req.user._id },
    //     ],
    //   }).select("_id");

    //   const projectIdList = projectIds.map((project) => project._id);

    //   if (!projectIdList.length) {
    //     return res.handler.response(
    //       STATUS_CODES.SUCCESS,
    //       "No tasks found for the given month and year",
    //       { month, year, tasksByDay: {} }
    //     );
    //   }

    //   matchFilter.project = { $in: projectIdList };
    // }

    const tasks = await Task.find(matchFilter);

    const tasksByDay = {};

    tasks.forEach((task) => {
      // Adjust the range to only include dates within the requested month
      const taskStartDate = new Date(task.startDate);
      const taskEndDate = new Date(task.endDate);
      const effectiveStartDate =
        taskStartDate < startDate ? startDate : taskStartDate;
      const effectiveEndDate = taskEndDate > endDate ? endDate : taskEndDate;

      const taskDates = getDatesInRange(effectiveStartDate, effectiveEndDate);

      taskDates.forEach((date) => {
        const day = date.getDate();

        if (!tasksByDay[day]) tasksByDay[day] = [];
        if (!tasksByDay[day].includes(task.status)) {
          tasksByDay[day].push(task.status);
        }
      });
    });

    return res.handler.response(
      STATUS_CODES.SUCCESS,
      "Tasks retrieved successfully",
      {
        month,
        year,
        tasksByDay,
      }
    );
  } catch (error) {
    console.error("Error listing tasks:", error.message, error.stack);
    return res.handler.response(
      STATUS_CODES.SERVER_ERROR,
      "Error retrieving tasks"
    );
  }
};

exports.listTasksByDate = async (req, res) => {
  try {
    const { date, sortBy = "name", sortOrder = "asc" } = req.query;

    if (!date) {
      return res.handler.response(STATUS_CODES.BAD_REQUEST, "Date is required");
    }

    const providedDate = new Date(date);
    const startOfDay = new Date(providedDate);
    startOfDay.setUTCHours(0, 0, 0, 0);

    const endOfDay = new Date(providedDate);
    endOfDay.setUTCHours(23, 59, 59, 999);

    const query = {
      $or: [
        {
          startDate: { $lte: endOfDay },
          endDate: { $gte: startOfDay },
        },
      ],
    };

    // if (req.user.role === "ProjectManager") {
    //   const projectIds = await Project.find({
    //     $or: [
    //       { "teamMembers.user": req.user._id },
    //       { createdBy: req.user._id },
    //     ],
    //   }).select("_id");

    //   const projectIdList = projectIds.map((project) => project._id);

    //   if (!projectIdList.length) {
    //     return res.handler.response(STATUS_CODES.SUCCESS, "No tasks found", {
    //       tasks: [],
    //     });
    //   }

    //   query.project = { $in: projectIdList };
    // }

    const validSortFields = ["name", "startDate", "endDate", "status"];
    const sortField = validSortFields.includes(sortBy) ? sortBy : "name";

    const tasks = await Task.find(query)
      .populate({
        path: "project",
        select: "name location product",
        populate: {
          path: "product",
          select: "name productPicture",
        },
      })
      .populate("primaryOwner", "name profilePicture")
      .populate("secondaryOwner", "name profilePicture")
      .sort({ [sortField]: sortOrder === "asc" ? 1 : -1 });

    if (!tasks.length) {
      return res.handler.response(STATUS_CODES.SUCCESS, "No tasks found", {
        tasks: [],
      });
    }

    const updatedTasks = tasks.map((task) => task.toObject());

    return res.handler.response(
      STATUS_CODES.SUCCESS,
      "Tasks fetched successfully",
      {
        tasks: updatedTasks,
      }
    );
  } catch (error) {
    console.error("Error fetching tasks:", error.message);
    return res.handler.response(
      STATUS_CODES.SERVER_ERROR,
      "Error fetching tasks"
    );
  }
};

exports.getTaskById = async (req, res) => {
  const { taskId } = req.params;

  try {
    const task = await Task.findById(taskId)
      .populate("primaryOwner", "name profilePicture")
      .populate("secondaryOwner", "name profilePicture")
      .populate("serviceReport", "formName formId updatedBy data updatedAt")
      .populate(
        "dailyUpdates",
        "manHours.totalHours date photos distanceTraveled"
      )
      .populate("updatedBy", "name")
      .lean();

    if (!task) {
      return res.handler.response(STATUS_CODES.NOT_FOUND, "Task not found");
    }

    const project = await Project.findById(task.project)
      .select("name location product teamMembers")
      .populate({
        path: "teamMembers.user", // Populate the 'user' field
        select: "name email profilePicture",
      })
      .populate("product", "name productPicture")
      .lean();

    if (!project) {
      return res.handler.response(STATUS_CODES.NOT_FOUND, "Project not found");
    }

    const taskDetails = {
      ...task,
      project,
    };

    return res.handler.response(
      STATUS_CODES.SUCCESS,
      "Task fetched successfully",
      taskDetails
    );
  } catch (error) {
    console.error("Error fetching task:", error.message);
    return res.handler.response(
      STATUS_CODES.SERVER_ERROR,
      "Error fetching task"
    );
  }
};

exports.updateTaskTimeline = async (req, res) => {
  const { taskId, startDate, endDate } = req.body;

  try {
    if (!taskId || !startDate || !endDate) {
      return res.handler.response(
        STATUS_CODES.BAD_REQUEST,
        "Required fields are missing"
      );
    }

    if (isNaN(new Date(startDate)) || isNaN(new Date(endDate))) {
      return res.handler.response(
        STATUS_CODES.BAD_REQUEST,
        "Invalid date format"
      );
    }

    if (new Date(startDate) > new Date(endDate)) {
      return res.handler.response(
        STATUS_CODES.BAD_REQUEST,
        "Start date must be before end date"
      );
    }

    const task = await Task.findById(taskId);

    if (!task) {
      return res.handler.response(STATUS_CODES.NOT_FOUND, "Task not found");
    }

    // Optional: Validate the new timeline against the parent project's timeline
    const project = await Project.findById(task.project);
    if (!project) {
      return res.handler.response(
        STATUS_CODES.NOT_FOUND,
        "Associated project not found"
      );
    }

    if (new Date(startDate) < new Date(project.startDate)) {
      return res.handler.response(
        STATUS_CODES.BAD_REQUEST,
        "Task start date cannot be earlier than project start date"
      );
    }

    // Update the task with the new dates
    task.startDate = new Date(startDate);
    task.endDate = new Date(endDate);
    task.updatedBy = req.user._id;

    // Generate daily updates between startDate and endDate
    const dates = generateDates(startDate, endDate);
    const dailyUpdates = dates.map((date) => ({
      taskId: task._id,
      date: date,
    }));

    // Remove any existing daily updates for the task
    await DailyUpdate.deleteMany({ taskId: task._id });

    // Insert new daily updates
    const createdDailyUpdates = await DailyUpdate.insertMany(dailyUpdates);

    // Update the task's reference to daily updates
    task.dailyUpdates = createdDailyUpdates.map((update) => update._id);
    await task.save();

    const populatedTask = await Task.findById(task._id).populate(
      "dailyUpdates"
    );

    return res.handler.response(
      STATUS_CODES.SUCCESS,
      "Task timeline updated successfully",
      { task: populatedTask }
    );
  } catch (error) {
    console.error("Error updating task timeline:", {
      error: error.message,
      stack: error.stack,
    });
    return res.handler.response(
      STATUS_CODES.SERVER_ERROR,
      "Error updating task timeline"
    );
  }
};

exports.updateServiceReport = async (req, res) => {
  try {
    const { taskId, selectedFormId } = req.body;

    const task = await Task.findById(taskId);
    if (!task) {
      return res.handler.response(STATUS_CODES.NOT_FOUND, "Task not found");
    }

    if (task.status === "Completed") {
      return res.handler.response(
        STATUS_CODES.FORBIDDEN,
        "Service report cannot be updated after the task is marked as completed"
      );
    }

    if (!selectedFormId) {
      task.serviceReport = null;
    } else {
      const form = await Forms.findById(selectedFormId);
      if (!form) {
        return res.handler.response(STATUS_CODES.BAD_REQUEST, "Form not found");
      }

      task.serviceReport = {
        formId: form._id,
        name: form.name,
        fields: [],
      };
      task.updatedBy = req.user._id;
    }

    await task.save();

    return res.handler.response(
      STATUS_CODES.SUCCESS,
      "Service report updated successfully",
      { task }
    );
  } catch (error) {
    console.error("Error updating service report:", error);
    return res.handler.response(
      STATUS_CODES.SERVER_ERROR,
      "Error updating service report"
    );
  }
};

exports.uploadPhotos = async (req, res) => {
  const { updateId } = req.params;
  if (!req.files || !req.files.length) {
    return res.handler.response(STATUS_CODES.BAD_REQUEST, "No files uploaded");
  }

  const photos = req.files.map((file) => file.location);

  try {
    const dailyUpdate = await DailyUpdate.findById(updateId);
    if (!dailyUpdate) {
      await Promise.all(photos.map((photoUrl) => deleteFileFromS3(photoUrl)));
      return res.handler.response(STATUS_CODES.NOT_FOUND, "Record not found");
    }

    const task = await Task.findOne({ dailyUpdates: updateId });
    if (!task) {
      await Promise.all(photos.map((photoUrl) => deleteFileFromS3(photoUrl)));
      return res.handler.response(
        STATUS_CODES.NOT_FOUND,
        "Task not found for this record"
      );
    }

    const updatedDailyUpdate = await DailyUpdate.findByIdAndUpdate(
      updateId,
      { $push: { photos: { $each: photos } } },
      { new: true } // Return the updated document
    );

    task.updatedBy = req.user._id;
    await task.save();

    return res.handler.response(STATUS_CODES.SUCCESS, "Uploaded successfully", {
      photos: updatedDailyUpdate.photos,
    });
  } catch (error) {
    console.error("Error during photo upload:", error);

    await Promise.all(photos.map((photoUrl) => deleteFileFromS3(photoUrl)));

    return res.handler.response(
      STATUS_CODES.SERVER_ERROR,
      "Error during photo upload"
    );
  }
};

exports.deletePhotos = async (req, res) => {
  const { updateId } = req.params;
  let { fileUrls } = req.body;

  if (!Array.isArray(fileUrls)) {
    fileUrls = [fileUrls];
  }

  try {
    const dailyUpdate = await DailyUpdate.findById(updateId);
    if (!dailyUpdate) {
      return res.handler.response(STATUS_CODES.NOT_FOUND, "Record not found");
    }

    const task = await Task.findOne({ dailyUpdates: updateId });
    if (!task) {
      return res.handler.response(
        STATUS_CODES.NOT_FOUND,
        "Task not found for this record"
      );
    }

    const filesToDelete = fileUrls.filter((fileUrl) =>
      dailyUpdate.photos.includes(fileUrl)
    );

    if (filesToDelete.length === 0) {
      return res
        .status(404)
        .json({ message: "No matching files found to delete" });
    }

    const remainingPhotos = dailyUpdate.photos.filter(
      (photoUrl) => !filesToDelete.includes(photoUrl)
    );

    const updatedDailyUpdate = await DailyUpdate.findByIdAndUpdate(
      updateId,
      { photos: remainingPhotos },
      { new: true } // Return the updated document
    );

    await Promise.all(
      filesToDelete.map((fileUrl) => deleteFileFromS3(fileUrl))
    );

    task.updatedBy = req.user._id;
    await task.save();

    return res.handler.response(STATUS_CODES.SUCCESS, "Deleted successfully", {
      photos: updatedDailyUpdate.photos,
    });
  } catch (error) {
    console.error("Error during file deletion:", error);
    return res.handler.response(STATUS_CODES.SERVER_ERROR, "Server error");
  }
};

exports.assignTask = async (req, res) => {
  try {
    const { taskId } = req.params;
    const { primaryOwner, secondaryOwner } = req.body;

    if (!mongoose.Types.ObjectId.isValid(taskId)) {
      return res.handler.response(STATUS_CODES.BAD_REQUEST, "Invalid task ID");
    }

    if (!primaryOwner || !mongoose.Types.ObjectId.isValid(primaryOwner)) {
      return res.handler.response(
        STATUS_CODES.BAD_REQUEST,
        "Invalid or missing primary owner ID"
      );
    }

    if (secondaryOwner && !mongoose.Types.ObjectId.isValid(secondaryOwner)) {
      return res.handler.response(
        STATUS_CODES.BAD_REQUEST,
        "Invalid secondary owner ID"
      );
    }

    const task = await Task.findById(taskId).populate("project");
    if (!task) {
      return res.handler.response(STATUS_CODES.NOT_FOUND, "Task not found");
    }

    const project = task.project;
    if (!project) {
      return res.handler.response(
        STATUS_CODES.NOT_FOUND,
        "Associated project not found"
      );
    }

    const primaryUser = await User.findById(primaryOwner).select(
      "email phoneNo name"
    );
    if (!primaryUser) {
      return res.handler.response(
        STATUS_CODES.NOT_FOUND,
        "Primary owner not found"
      );
    }
    let secondaryUser = null;
    if (secondaryOwner) {
      secondaryUser = await User.findById(secondaryOwner).select(
        "email phoneNo name"
      );
      if (!secondaryUser) {
        return res.handler.response(
          STATUS_CODES.NOT_FOUND,
          "Secondary owner not found"
        );
      }
    }

    task.primaryOwner = primaryOwner;
    task.secondaryOwner = secondaryOwner || null;
    task.updatedBy = req.user._id;

    await task.save();

    const ownersToAdd = [
      { role: "Technician", user: primaryOwner },
      ...(secondaryOwner ? [{ role: "Technician", user: secondaryOwner }] : []),
    ];
    const currentTeamMembers = (project.teamMembers || []).map((member) =>
      member.user.toString()
    );
    ownersToAdd.forEach((owner) => {
      if (!currentTeamMembers.includes(owner.user.toString())) {
        project.teamMembers.push(owner);
      }
    });

    await project.save();

    await syncProjectTechnicians(project._id);
    if (primaryUser?.email) {
      await sendTaskAssignedEmailToTechnician(primaryUser, task, project);
    }
    if (primaryUser?.phoneNo) {
      await sendTaskAssignedWhatsAppToTechnician(primaryUser, task, project);
    }
    if (secondaryUser?.email) {
      await sendTaskAssignedEmailToTechnician(secondaryUser, task, project);
    }
    if (secondaryUser?.phoneNo) {
      await sendTaskAssignedWhatsAppToTechnician(secondaryUser, task, project);
    }

    return res.handler.response(
      STATUS_CODES.SUCCESS,
      "Task assigned successfully",
      task
    );
  } catch (error) {
    console.error("Error assigning task:", error.message);
    return res.handler.response(
      STATUS_CODES.SERVER_ERROR,
      "Error assigning task"
    );
  }
};

exports.updateDistance = async (req, res) => {
  const { updateId } = req.params;
  const { distanceTraveled } = req.body;

  try {
    const dailyUpdate = await DailyUpdate.findById(updateId);

    if (!dailyUpdate) {
      return res.handler.response(STATUS_CODES.NOT_FOUND, "Record not found");
    }

    const task = await Task.findOne({ dailyUpdates: updateId });
    if (!task) {
      return res.handler.response(
        STATUS_CODES.NOT_FOUND,
        "Task not found for this record"
      );
    }

    if (task.status === "Completed") {
      return res.handler.response(
        STATUS_CODES.BAD_REQUEST,
        "Task is completed. Distance cannot be updated."
      );
    }

    dailyUpdate.distanceTraveled = distanceTraveled;
    await dailyUpdate.save();

    task.updatedBy = req.user._id;
    await task.save();

    return res.handler.response(STATUS_CODES.SUCCESS, "Updated successfully", {
      distanceTraveled: dailyUpdate.distanceTraveled,
    });
  } catch (error) {
    console.error("Error updating distance traveled:", error.message);
    return res.handler.response(STATUS_CODES.SERVER_ERROR, "Server error");
  }
};

exports.updateManHours = async (req, res) => {
  const { updateId } = req.params;
  const { noOfPerson, noOfHours } = req.body;

  try {
    const dailyUpdate = await DailyUpdate.findById(updateId);

    if (!dailyUpdate) {
      return res.handler.response(STATUS_CODES.NOT_FOUND, "Record not found");
    }

    const task = await Task.findOne({ dailyUpdates: updateId });
    if (!task) {
      return res.handler.response(
        STATUS_CODES.NOT_FOUND,
        "Task not found for this record"
      );
    }

    if (task.status === "Completed") {
      return res.handler.response(
        STATUS_CODES.BAD_REQUEST,
        "Task is completed. Man-hours cannot be updated."
      );
    }

    dailyUpdate.manHours = {
      noOfPerson,
      noOfHours,
      totalHours: noOfPerson * noOfHours,
    };
    await dailyUpdate.save();

    task.updatedBy = req.user._id;
    await task.save();

    return res.handler.response(STATUS_CODES.SUCCESS, "Updated successfully", {
      manHours: dailyUpdate.manHours,
    });
  } catch (error) {
    console.error("Error updating man-hours:", error.message);
    return res.handler.response(STATUS_CODES.SERVER_ERROR, "Server error");
  }
};

exports.listDailyUpdates = async (req, res) => {
  const { taskId } = req.query;

  try {
    const updates = await DailyUpdate.find({ taskId });

    if (!updates.length) {
      return res.handler.response(STATUS_CODES.NOT_FOUND, "No updates found");
    }
    return res.handler.response(
      STATUS_CODES.SUCCESS,
      "updated successfully",
      updates
    );
  } catch (error) {
    console.error("Error fetching daily updates:", error.message);
    return res.handler.response(STATUS_CODES.SERVER_ERROR, "Server error");
  }
};

exports.submitForReview = async (req, res) => {
  const { taskId } = req.params;

  try {
    const task = await Task.findById(taskId)
    if (!task) {
      return res.handler.response(STATUS_CODES.NOT_FOUND, "Task not found");
    }

    if (task.serviceReport) {
      const report = await ServiceReport.findById(task.serviceReport).lean();
      if (report && report.formId) {
        // If the report data is empty, reject the submission.
        if (!report.data || Object.keys(report.data).length === 0) {
          return res.handler.response(
            STATUS_CODES.BAD_REQUEST,
            "Please fill the service report form first"
          );
        }
      }
    }

    const dailyUpdateWithPhotos = await DailyUpdate.findOne({
      taskId: taskId,
      photos: { $exists: true, $ne: [] },
    }).lean();

    if (!dailyUpdateWithPhotos) {
      return res.handler.response(
        STATUS_CODES.BAD_REQUEST,
        "At least one daily update with photos must be logged"
      );
    }

    task.status = "To-review";
    task.reviewDate = new Date();
    task.updatedBy = req.user._id;

    await task.save();

    // Fetch the task with its associated project and project managers
    const populatedTask = await Task.findById(taskId)
      .populate("primaryOwner", "email phoneNo name")
      .populate("secondaryOwner", "email phoneNo name")
      .populate({
        path: "project",
        select: "name teamMembers",
        populate: {
          path: "product",
          select: "name",
        }
      });
    if (!populatedTask || !populatedTask.project) {
      return res.handler.response(
        STATUS_CODES.NOT_FOUND,
        "Associated project not found"
      );
    }
    const project = populatedTask.project;
    try {
      if (populatedTask.primaryOwner?.phoneNo) {
        await sendTaskSubmittedWhatsAppToPM(populatedTask.primaryOwner, populatedTask, project, req.user);
      }
      if (populatedTask.primaryOwner?.email) {
        await sendTaskSubmittedEmailToPM(populatedTask.primaryOwner, populatedTask, project);
      }
      // Notify Secondary Owner
      if (populatedTask.secondaryOwner?.phoneNo) {
        await sendTaskSubmittedWhatsAppToPM(populatedTask.secondaryOwner, populatedTask, project, req.user);
      }

      if (populatedTask.secondaryOwner?.email) {
        await sendTaskSubmittedEmailToPM(populatedTask.secondaryOwner, populatedTask, project);
      }
    } catch (notificationError) {
      console.error("submitForReview notification error:", {
        error: notificationError.message,
        stack: notificationError.stack,
      });
    }

    return res.handler.response(
      STATUS_CODES.SUCCESS,
      "Task submitted for review successfully",
      populatedTask
    );
  } catch (error) {
    console.error("Error submitting task for review:", error.message);
    return res.handler.response(
      STATUS_CODES.SERVER_ERROR,
      "Error submitting task for review"
    );
  }
};

exports.resubmitTask = async (req, res) => {
  try {
    const { taskId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(taskId)) {
      return res.handler.response(STATUS_CODES.BAD_REQUEST, "Invalid task ID");
    }

    let task = await Task.findById(taskId);
    if (!task) {
      return res.handler.response(STATUS_CODES.NOT_FOUND, "Task not found");
    }

    if (task.status !== "To-review") {
      return res.handler.response(STATUS_CODES.BAD_REQUEST, "Task is not in review stage");
    }

    const newStatus = determineTaskStatus(task.startDate, task.endDate);
    task.status = newStatus;
    task.reviewDate = null;
    task.updatedBy = req.user._id;

    await task.save();

    const updatedTask = await Task.findById(taskId)
      .populate("primaryOwner", "email phoneNo name")
      .populate("secondaryOwner", "email phoneNo name")
      .populate({
        path: "project",
        select: "name product",
        populate: { path: "product", select: "name" },
      });

    const resubmittedBy = req.user; // Storing user info for reuse

    try {
      if (updatedTask.primaryOwner?.email) {
        await sendTaskResubmittedEmailToTechnician(updatedTask.primaryOwner, updatedTask, resubmittedBy.name);
      }
      if (updatedTask.primaryOwner?.phoneNo) {
        await sendTaskResubmittedWhatsAppToTechnician(updatedTask.primaryOwner, updatedTask, resubmittedBy);
      }

      // Notify Secondary Owner
      if (updatedTask.secondaryOwner?.email) {
        await sendTaskResubmittedEmailToTechnician(updatedTask.secondaryOwner, updatedTask, resubmittedBy.name);
      }
      if (updatedTask.secondaryOwner?.phoneNo) {
        await sendTaskResubmittedWhatsAppToTechnician(updatedTask.secondaryOwner, updatedTask, resubmittedBy);
      }
    } catch (notificationError) {
      console.error("Notification error:", {
        error: notificationError.message,
        stack: notificationError.stack,
      });
    }

    return res.handler.response(STATUS_CODES.SUCCESS, "Task resubmitted successfully", updatedTask);
  } catch (error) {
    console.error("Error resubmitting task:", error.message);
    return res.handler.response(STATUS_CODES.SERVER_ERROR, "Error resubmitting task");
  }
};

exports.markAsDone = async (req, res) => {
  const { taskId } = req.params;

  try {
    const task = await Task.findById(taskId);
    if (!task) {
      return res.handler.response(STATUS_CODES.NOT_FOUND, "Task not found");
    }

    if (task.status !== "To-review") {
      return res.handler.response(
        STATUS_CODES.BAD_REQUEST,
        "Task is not in review stage"
      );
    }

    task.status = "Completed";
    task.completedDate = new Date();
    task.updatedBy = req.user._id;
    await task.save();

    return res.handler.response(
      STATUS_CODES.SUCCESS,
      "Task marked as completed"
    );
  } catch (error) {
    console.error("Error marking task as completed:", error);
    return res.handler.response(
      STATUS_CODES.SERVER_ERROR,
      "Error marking task as completed"
    );
  }
};

exports.createTasksOnSchedule = async (req, res) => {
  try {
    const { projectId, taskTitle, repeat, stage } = req.body;

    // if (!projectId) {
    //   return res.handler.response(STATUS_CODES.BAD_REQUEST, "Project ID is required.");
    // }
    // if (!taskTitle || typeof taskTitle !== "string") {
    //   return res.handler.response(STATUS_CODES.BAD_REQUEST, "Valid task title is required.");
    // }
    // if (!repeat || typeof repeat !== "object") {
    //   return res.handler.response(STATUS_CODES.BAD_REQUEST, "Valid repeat configuration is required.");
    // }
    // if (!stage) {
    //   return res.handler.response(STATUS_CODES.BAD_REQUEST, "Stage is required.");
    // }

    const { frequency, interval, endCondition } = repeat;
    if (!frequency || !["daily", "weekly", "monthly"].includes(frequency)) {
      return res.handler.response(
        STATUS_CODES.BAD_REQUEST,
        "Invalid or missing frequency."
      );
    }
    if (!interval || typeof interval !== "number" || interval < 1) {
      return res.handler.response(
        STATUS_CODES.BAD_REQUEST,
        "Interval must be a positive number."
      );
    }
    if (
      !endCondition ||
      !["oneYear", "endDate", "occurrences"].includes(endCondition.type)
    ) {
      return res.handler.response(
        STATUS_CODES.BAD_REQUEST,
        "Invalid or missing end condition."
      );
    }

    const now = new Date();
    const startDate = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate()
    );

    const taskDates = calculateTaskDates(repeat, startDate);

    if (!taskDates.length) {
      return res.handler.response(
        STATUS_CODES.BAD_REQUEST,
        "No valid dates generated. Check input parameters."
      );
    }

    const tasks = taskDates.map((date) => ({
      project: projectId,
      taskTitle,
      date,
      stage,
      status: "pending",
    }));

    const project = await Project.findById(projectId)
      .select("name location")
      .populate("product", "name productPicture")
      .lean();

    if (!project) {
      return res.handler.response(STATUS_CODES.NOT_FOUND, "Project not found.");
    }

    const taskDetails = {
      totalTasks: tasks.length,
      stage,
      startDate,
      endDate: taskDates[taskDates.length - 1],
      taskDates,
      project,
    };

    // Example for database insertion (uncomment when needed)
    // await TaskModel.insertMany(tasks);

    return res.handler.response(
      STATUS_CODES.SUCCESS,
      "Tasks scheduled successfully.",
      taskDetails
    );
  } catch (error) {
    console.error("Error in createTasksOnSchedule:", error.message);
    return res.handler.response(STATUS_CODES.SERVER_ERROR, "Server error");
  }
};

exports.createScheduledTasks = async (req, res) => {
  try {
    const { projectId, taskTitle, taskDates, stage } = req.body;

    if (!projectId) {
      return res.handler.response(
        STATUS_CODES.BAD_REQUEST,
        "Project ID is required."
      );
    }
    if (!taskTitle || typeof taskTitle !== "string") {
      return res.handler.response(
        STATUS_CODES.BAD_REQUEST,
        "Valid task title is required."
      );
    }
    if (!Array.isArray(taskDates) || taskDates.length === 0) {
      return res.handler.response(
        STATUS_CODES.BAD_REQUEST,
        "Valid task dates are required."
      );
    }
    if (!stage) {
      return res.handler.response(
        STATUS_CODES.BAD_REQUEST,
        "Stage is required."
      );
    }

    // Fetch the project details
    const project = await Project.findById(projectId);
    if (!project) {
      return res.handler.response(STATUS_CODES.NOT_FOUND, "Project not found.");
    }

    // Prepare task objects for bulk insertion.
    const tasksData = taskDates.map((endDateStr) => {
      const end = new Date(endDateStr);
      const start = new Date(end);
      start.setDate(end.getDate() - 1); // start date is one day before the end date
      return {
        project: projectId,
        name: taskTitle,
        startDate: start,
        endDate: end,
        projectStage: stage,
        status: "To-do",
      };
    });

    // Insert tasks into the database
    const createdTasks = await Task.insertMany(tasksData);
    const taskIds = createdTasks.map((task) => task._id);

    // Find the relevant stage in the project and update it.
    const projectStageDoc = project.stages.find((s) => s.name === stage);
    if (!projectStageDoc) {
      return res.handler.response(STATUS_CODES.BAD_REQUEST, "Project stage not found.");
    }
    projectStageDoc.tasks.push(...taskIds);
    projectStageDoc.totalTasks += taskIds.length;
    await project.save();

    // For each created task, generate and insert daily updates.
    // We assume generateDates returns an array of Date objects for the range [startDate, endDate].
    await Promise.all(
      createdTasks.map(async (task) => {
        const dates = generateDates(task.startDate, task.endDate);
        const dailyUpdatesData = dates.map((date) => ({
          taskId: task._id,
          date: date,
          status: "pending"
        }));
        const createdDailyUpdates = await DailyUpdate.insertMany(dailyUpdatesData);
        task.dailyUpdates = createdDailyUpdates.map((update) => update._id);
        await task.save();
      })
    );

    // Re-fetch tasks with dailyUpdates populated.
    const populatedTasks = await Task.find({ _id: { $in: taskIds } })
      .populate({
        path: "project",
        select: "location.address name product",
        populate: {
          path: "product",
          select: "name productPicture",
        },
      })
      .populate("primaryOwner", "name profilePicture")
      .populate("secondaryOwner", "name profilePicture");

    return res.handler.response(
      STATUS_CODES.SUCCESS,
      "Tasks created successfully.",
      { tasks: populatedTasks, totalTasks: taskIds.length }
    );
  } catch (error) {
    console.error("Error in createScheduledTasks:", error.message);
    return res.handler.response(STATUS_CODES.SERVER_ERROR, "Server error");
  }
};

exports.deleteTask = async (req, res) => {
  const { taskId } = req.params;

  try {
    const task = await Task.findById(taskId).lean();
    if (!task) {
      return res.handler.response(STATUS_CODES.NOT_FOUND, "Task not found");
    }

    await Project.updateMany(
      { "stages.tasks": taskId },
      { $pull: { "stages.$[].tasks": taskId } }
    );

    const dailyUpdates = await DailyUpdate.find({ task: taskId });

    const filesToDelete = [];
    dailyUpdates.forEach((update) => {
      filesToDelete.push(...update.photos);
    });
    await Promise.all(filesToDelete.map((fileUrl) => deleteFileFromS3(fileUrl)));
    await DailyUpdate.deleteMany({ task: taskId });

    if (task.serviceReport) {
      await ServiceReport.findByIdAndDelete(task.serviceReport);
    }

    await Task.findByIdAndDelete(taskId);

    return res.handler.response(
      STATUS_CODES.SUCCESS,
      "Task deleted successfully"
    );
  } catch (error) {
    console.error("Error deleting task:", error);
    return res.handler.response(
      STATUS_CODES.SERVER_ERROR,
      "Error deleting task"
    );
  }
};
