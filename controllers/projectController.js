const Project = require("../models/projectModel");
const Product = require("../models/productModel");
const Client = require("../models/clientModel");
const User = require("../models/userModel");
const Task = require("../models/taskModel");
const DailyUpdate = require("../models/dailyUpdateModel");
const ServiceReport = require("../models/serviceReportModel");
const ProductTaskMapping = require("../models/productTaskMappingModel");
const mongoose = require("mongoose");
const MongoUtils = require("../utils/mongo-utils");
const { deleteFileFromS3 } = require("../utils/awsbucket");
const {
  updateAllProjectsStatus,
  getCityAndStateFromPinCode,
} = require("../utils/functions");
const {
  sendProjectAssignedEmail,
  sendNewProjectEmailToAdmin,
  sendProjectDeletedEmail,
} = require("../utils/emailService");
const { sendNewProjectWhatsAppToAdmin, sendProjectAssignedWhatsApp, sendProjectDeletedWhatsApp } = require("../services/whatsappNotificationService");

const DEFAULT_STAGES = [
  { name: "Pre-requisites", tasks: [] },
  { name: "Installation & Commissioning", tasks: [] },
  { name: "Maintenance", tasks: [] },
];

class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "ValidationError";
    this.statusCode = 400; // Client-side error
  }
}

const handleTransaction = async (operation) => {
  const session = await mongoose.startSession();
  try {
    session.startTransaction();
    const result = await operation(session);
    await session.commitTransaction();
    return result;
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
};

const validateTeamMember = async (userId, session) => {
  if (!userId) return true;
  const user = await MongoUtils.findByIdWithSelect(User, userId, "", {
    session,
  });
  return !!user;
};

const validateProjectData = async (data, session) => {
  const errors = [];

  if (
    data.handoverDate &&
    data.startDate &&
    new Date(data.handoverDate) <= new Date(data.startDate)
  ) {
    errors.push("Handover date must be after start date");
  }

  if (data.capacity && (data.capacity < 0 || data.capacity > 100000)) {
    errors.push("Capacity must be between 0 and 100,000");
  }

  const teamMembers = data.teamMembers || [];

  const validations = await Promise.all(
    teamMembers.map((member) => validateTeamMember(member.user, session))
  );

  if (validations.includes(false)) {
    errors.push("Invalid team member ID");
  }

  return errors;
};

const validateProjectManagers = async (teamMembers) => {
  const primaryPM = teamMembers?.find((member) => member.role === "primaryProjectManager")?.user || null;
  const secondaryPM = teamMembers?.find((member) => member.role === "secondaryProjectManager")?.user || null;

  // Validate ObjectIds to prevent MongoDB errors
  const validPMIdsToQuery = [primaryPM, secondaryPM].filter(
    (id) => mongoose.Types.ObjectId.isValid(id) && id !== null
  );

  // Fetch only valid PMs from the database
  const validPMs = await User.find({ _id: { $in: validPMIdsToQuery } }).select("_id");
  const validPMIds = validPMs.map((user) => user._id.toString());

  // Validate primary PM
  if (!primaryPM || !validPMIds.includes(primaryPM)) {
    throw new ValidationError("Invalid or missing Primary Project Manager ID");
  }

  // Ensure secondaryPM is valid or set to null
  const finalSecondaryPM = validPMIds.includes(secondaryPM) ? secondaryPM : null;

  if (primaryPM && finalSecondaryPM && primaryPM === finalSecondaryPM) {
    throw new ValidationError("Primary and secondary project managers must not be the same");
  }

  return teamMembers
    .filter(({ user }) => validPMIds.includes(user)) // Filter only valid users
    .map(({ role, user }) => ({ role, user }));
};

const processClients = async (clients, session) => {
  const clientIds = [];

  for (const client of clients) {
    const existingClient = await Client.findOne({
      contactNumber: client.contactNumber,
    }).session(session);

    if (existingClient) {
      clientIds.push(existingClient._id); // Use the ObjectId
    } else {
      const newClient = new Client(client);
      await newClient.save({ session });
      clientIds.push(newClient._id); // Use the ObjectId
    }
  }

  return clientIds; // Must be an array of ObjectId
};

exports.createProject = async (req, res) => {
  const fileUrl = req.file?.location || null;

  try {
    const result = await handleTransaction(async (session) => {
      const validationErrors = await validateProjectData(req.body, session);
      if (validationErrors.length) {
        throw new ValidationError(validationErrors.join(", "));
      }

      const teamMembers = await validateProjectManagers(req.body.teamMembers);

      const primaryPM = teamMembers.find((member) => member.role === "primaryProjectManager")?.user || null;
      const secondaryPM = teamMembers.find((member) => member.role === "secondaryProjectManager")?.user || null;

      // Fetch city and state from pin code
      const pinCode = req.body.location.pinCode;
      if (!pinCode) {
        throw new ValidationError("Pin code is required to fetch city and state");
      }
      const { city, state } = await getCityAndStateFromPinCode(pinCode);
      if (!city || !state) {
        throw new ValidationError("Invalid or missing city/state for the given pin code");
      }

      // Process clients from request body
      const clientDocs = req.body.clients || [];
      const uniqueClients = [];

      for (const client of clientDocs) {
        const existingClient = await Client.findOne({
          contactNumber: client.contactNumber,
        }).session(session);

        if (existingClient) {
          uniqueClients.push(existingClient._id);
        } else {
          const newClient = new Client({
            name: client.name,
            contactNumber: client.contactNumber,
          });
          await newClient.save({ session });
          uniqueClients.push(newClient._id);
        }
      }

      // Step 1: Fetch the product-task mapping
      const productMapping = await ProductTaskMapping.findOne({
        product: req.body.product,
      })
        .populate("stages.tasks.form", "name") // Populate forms
        .lean();

      // if (!productMapping) {
      //   return res.handler.response(STATUS_CODES.NOT_FOUND, "No task mapping found for the selected product");
      // }

      const newProject = new Project({
        ...req.body,
        location: { ...req.body.location, city, state },
        createdBy: req.user._id,
        updatedBy: req.user._id,
        clients: uniqueClients.map((client) => client._id),
        projectPicture: fileUrl,
        teamMembers,
        stages: productMapping.stages.map((stage) => ({
          name: stage.name,
          tasks: [],
        })),
      });

      await newProject.save({ session });

      for (const stage of productMapping.stages) {
        const stageIndex = newProject.stages.findIndex((s) => s.name === stage.name);
        if (stageIndex !== -1) {
          for (const taskMapping of stage.tasks) {
            const newTask = new Task({
              name: taskMapping.name,
              project: newProject._id,
              projectStage: stage.name,
              status: "To-do",
              createdBy: req.user._id,
              updatedBy: req.user._id,
            });
            await newTask.save();

            if (taskMapping.form && taskMapping.form._id) {
              const newReport = new ServiceReport({
                task: newTask._id,
                formId: taskMapping.form._id,
                formName: taskMapping.form.name,
                data: {},
                updatedBy: req.user._id,
                updatedAt: new Date(),
              });
              await newReport.save();
              newTask.serviceReport = newReport._id;
              await newTask.save();
            }

            newProject.stages[stageIndex].tasks.push(newTask._id);
          }
        }
      }
      await newProject.save({ session });

      const populatedProject = await Project.findById(newProject._id)
        .session(session)
        .populate("product", "name productPicture")
        .populate("clients", "name contactNumber")
        .populate("stages.tasks", "name status serviceReport")
        .populate({ path: "teamMembers.user", select: "name profilePicture" })
        .lean();

      const admins = await User.find({ role: "Admin" }).select("email phoneNo").lean();
      const adminEmailList = admins.map((admin) => admin.email);
      const adminPhoneNumbers = admins.map((admin) => admin.phoneNo);
      if (adminEmailList.length > 0) {
        await sendNewProjectEmailToAdmin(adminEmailList, newProject);
        // await sendNewProjectWhatsAppToAdmin(adminPhoneNumbers, newProject);
      }

      // Send emails to Primary and Secondary PMs
      if (primaryPM) {
        const primaryPMUser = await User.findById(primaryPM).select("email name phoneNo");
        if (primaryPMUser?.email) {
          await sendProjectAssignedEmail(primaryPMUser, newProject, req.user.name);
        }
        if (primaryPMUser?.phoneNo) {
          await sendProjectAssignedWhatsApp(primaryPMUser, newProject, req.user.name);
          
        }
      }

      if (secondaryPM) {
        const secondaryPMUser = await User.findById(secondaryPM).select("email phoneNo name");
        if (secondaryPMUser?.email) {
          await sendProjectAssignedEmail(secondaryPMUser, newProject, req.user.name);
        }
        if (secondaryPMUser?.phoneNo) {
          await sendProjectAssignedWhatsApp(secondaryPMUser, newProject, req.user.name);
        }
      }

      return populatedProject;
    });

    return res.handler.response(STATUS_CODES.SUCCESS, "Project created successfully", { project: result });
  } catch (error) {
    if (fileUrl) {
      await deleteFileFromS3(fileUrl);
    }

    if (error instanceof ValidationError) {
      return res.handler.response(error.statusCode, error.message);
    }

    console.error("Error creating project:", error);
    return res.handler.response(STATUS_CODES.SERVER_ERROR, "Something went wrong. Please try again.");
  }
};

exports.getAllProjects = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 50,
      sortBy = "createdAt",
      sortOrder = "desc",
      status,
      state,
      product,
    } = req.query;

    const filter = {};

    if (status) filter.status = status;
    if (state) filter["location.state"] = state;
    if (product) filter.product = product;

    // if (req.user.role === "ProjectManager") {
    //   filter["$or"] = [
    //     {
    //       teamMembers: {
    //         $elemMatch: {
    //           user: req.user._id,
    //           role: {
    //             $in: ["primaryProjectManager", "secondaryProjectManager"],
    //           },
    //         },
    //       },
    //     },
    //     {
    //       createdBy: req.user._id,
    //     },
    //   ];
    // }

    const validSortFields = [
      "name",
      "startDate",
      "endDate",
      "status",
      "createdAt",
    ];
    const sortField = validSortFields.includes(sortBy) ? sortBy : "startDate";

    const options = {
      page: parseInt(page, 10),
      limit: parseInt(limit, 10),
      sort: { [sortField]: sortOrder === "asc" ? 1 : -1 },
      select: "name projectPicture startDate status teamMembers location",
      populate: [
        {
          path: "teamMembers.user",
          select: "name profilePicture",
        },
        { path: "product", select: "name productPicture" },
      ],
    };

    const result = await MongoUtils.findWithPagination(
      Project,
      filter,
      options
    );

    await updateAllProjectsStatus();

    if (!result || !result.data) {
      return res.handler.response(
        STATUS_CODES.SERVER_ERROR,
        "Error in pagination utility result"
      );
    }

    return res.handler.response(STATUS_CODES.SUCCESS, "Projects retrieved", {
      projects: result.data,
      pagination: {
        totalProjectsCount: result.total,
        totalPages: result.pages,
        currentPage: result.currentPage,
        pageLimit: limit,
      },
    });
  } catch (error) {
    console.error("Error fetching projects:", error.message);
    return res.handler.response(STATUS_CODES.SERVER_ERROR, error.message);
  }
};

exports.getProjectById = async (req, res) => {
  try {
    const project = await Project.findById(req.params.id)
      .populate("clients", "name contactNumber")
      .populate("product", "name productPicture")
      .populate({
        path: "teamMembers.user", // Populate the 'user' field
        select: "name email profilePicture",
      })
      .populate({
        path: "stages.tasks",
        select: "status", // Only select the status of tasks to count completed ones
      });

    if (!project) {
      return res.handler.response(STATUS_CODES.NOT_FOUND, "Project not found");
    }

    project.stages.forEach((stage) => {
      stage.totalTasks = stage.tasks.length;
      stage.completedTasks = stage.tasks.filter(
        (task) => task.status === "Completed"
      ).length;
    });

    await project.save();

    return res.handler.response(
      STATUS_CODES.SUCCESS,
      "Project retrieved",
      project
    );
  } catch (error) {
    return res.handler.response(STATUS_CODES.SERVER_ERROR, error.message);
  }
};

exports.updateProject = async (req, res) => {
  const fileUrl = req.file?.location;
  try {
    if (!Object.keys(req.body).length && !req.file) {
      return res.handler.response(STATUS_CODES.BAD_REQUEST, "No data provided");
    }

    // Fetch the original project to capture current PM assignments
    const originalProject = await Project.findById(req.params.id).lean();
    if (!originalProject) {
      return res.handler.response(STATUS_CODES.NOT_FOUND, "Project not found");
    }
    const originalPrimaryPM = originalProject.teamMembers?.find(
      (member) => member.role === "primaryProjectManager"
    )?.user?.toString() || null;
    const originalSecondaryPM = originalProject.teamMembers?.find(
      (member) => member.role === "secondaryProjectManager"
    )?.user?.toString() || null;

    const result = await handleTransaction(async (session) => {
      const project = await MongoUtils.findByIdWithSelect(
        Project,
        req.params.id,
        "",
        { session }
      );
      if (!project) {
        throw new ValidationError("Project not found");
      }

      if (req.user.role === "ProjectManager") {
        const isStartDateChanging =
          req.body.startDate && req.body.startDate !== originalProject.startDate?.toISOString();
        const isEndDateChanging =
          req.body.endDate && req.body.endDate !== originalProject.endDate?.toISOString();

        if (isStartDateChanging || isEndDateChanging) {
          throw new ValidationError(
            "Project Managers are not allowed to edit start date or end date"
          );
        }
      }

      if (req.body.clients) {
        const parsedClients = Array.isArray(req.body.clients)
          ? req.body.clients
          : JSON.parse(req.body.clients);

        const clientIds = await processClients(parsedClients, session);

        project.clients = clientIds.map((id) => {
          if (mongoose.Types.ObjectId.isValid(id)) {
            return new mongoose.Types.ObjectId(id);
          } else {
            throw new ValidationError(`Invalid ObjectId: ${id}`);
          }
        });
      }

      const { clients, teamMembers, projectPicture, ...rest } = req.body;
      Object.assign(project, rest);

      if (fileUrl) {
        if (project.projectPicture) {
          await deleteFileFromS3(project.projectPicture);
        }
        project.projectPicture = fileUrl;
      }

      if (req.body.teamMembers) {
        let currentTeamMembersMap = new Map(
          project.teamMembers.map(member => [member.user.toString(), member])
        );

        let existingPrimaryManagerKey = null;
        let existingSecondaryManagerKey = null;

        for (const [userId, member] of currentTeamMembersMap.entries()) {
          if (member.role === "primaryProjectManager") {
            existingPrimaryManagerKey = userId;
          }
          if (member.role === "secondaryProjectManager") {
            existingSecondaryManagerKey = userId;
          }
        }

        let newPrimaryManager = null;
        let newSecondaryManager = null;
        let hasPrimaryPM = false;
        let hasSecondaryPM = false;

        req.body.teamMembers.forEach(({ role, user }) => {
          const userId = user.toString();

          if (mongoose.Types.ObjectId.isValid(userId)) {
            if (role === "primaryProjectManager") {
              newPrimaryManager = userId;
              hasPrimaryPM = true;
            }
            if (role === "secondaryProjectManager") {
              newSecondaryManager = userId;
              hasSecondaryPM = true;
            }

            if (currentTeamMembersMap.has(userId)) {
              currentTeamMembersMap.get(userId).role = role;
            } else {
              currentTeamMembersMap.set(userId, {
                role,
                user: new mongoose.Types.ObjectId(userId),
              });
            }
          }
        });

        // Remove old primary manager only if a new one is assigned
        if (newPrimaryManager && newPrimaryManager !== existingPrimaryManagerKey) {
          if (existingPrimaryManagerKey) {
            currentTeamMembersMap.delete(existingPrimaryManagerKey);
          }
        }

        // Remove old secondary manager only if a new one is assigned
        if (newSecondaryManager && newSecondaryManager !== existingSecondaryManagerKey) {
          if (existingSecondaryManagerKey) {
            currentTeamMembersMap.delete(existingSecondaryManagerKey);
          }
        }

        // If no new secondary manager is provided, remove the old one
        if (!hasSecondaryPM && existingSecondaryManagerKey) {
          currentTeamMembersMap.delete(existingSecondaryManagerKey);
        }

        project.teamMembers = Array.from(currentTeamMembersMap.values());
      }


      project.updatedBy = req.user._id;
      const updatedProject = await project.save({ session });
      return updatedProject;
    });

    // Extract new PM assignments from updated project
    const updatedPrimaryPM =
      result.teamMembers.find((member) => member.role === "primaryProjectManager")
        ?.user?.toString() || null;
    const updatedSecondaryPM =
      result.teamMembers.find((member) => member.role === "secondaryProjectManager")
        ?.user?.toString() || null;

    // Send email only if the PM assignment has changed
    if (updatedPrimaryPM && updatedPrimaryPM !== originalPrimaryPM) {
      const primaryPMUser = await User.findById(updatedPrimaryPM).select("email name phoneNo");
      if (primaryPMUser?.email) {
        await sendProjectAssignedEmail(primaryPMUser, result, req.user.name);
      }
      if (primaryPMUser?.phoneNo) {
        await sendProjectAssignedWhatsApp(primaryPMUser, result, req.user.name);
      }
    }
    if (updatedSecondaryPM && updatedSecondaryPM !== originalSecondaryPM) {
      const secondaryPMUser = await User.findById(updatedSecondaryPM).select("email name phoneNo");
      if (secondaryPMUser?.email) {
        await sendProjectAssignedEmail(secondaryPMUser, result, req.user.name);
      }
      if (secondaryPMUser?.phoneNo) {
        await sendProjectAssignedWhatsApp(secondaryPMUser, result, req.user.name);
      }
    }

    return res.handler.response(
      STATUS_CODES.SUCCESS,
      "Project updated successfully",
      result
    );
  } catch (error) {
    if (fileUrl) {
      await deleteFileFromS3(fileUrl);
    }
    console.error("Error updating project:", error.message);
    return res.handler.response(STATUS_CODES.SERVER_ERROR, error.message);
  }
};

exports.getProjectHistory = async (req, res) => {
  try {
    const { projectId } = req.params;

    const tasks = await Task.find({ project: projectId })
      .select("name primaryOwner dailyUpdates serviceReport")
      .populate("primaryOwner", "name profilePicture")
      .populate("dailyUpdates", "date photos manHours distanceTraveled")
      .populate("serviceReport", "formId formName data updatedBy updatedAt createdAt")
      .lean();

    if (!tasks.length) {
      return res.handler.response(STATUS_CODES.SUCCESS, "No updates found", {
        history: [],
      });
    }

    const historyByMonth = {};

    tasks.forEach((task) => {
      const hasPhotos = task.dailyUpdates.some(
        (update) => update.photos && update.photos.length > 0
      );
      const hasServiceReport =
        task.serviceReport &&
        task.serviceReport.data &&
        Object.keys(task.serviceReport.data).length > 0;

      if (hasPhotos || hasServiceReport) {
        task.dailyUpdates.forEach((update) => {
          if (update.photos && update.photos.length > 0) {
            const updateDate = new Date(update.date);
            const monthKey = updateDate.toLocaleString("default", {
              month: "long",
              year: "numeric",
            });
            const dateKey = updateDate.toISOString().split("T")[0];

            if (!historyByMonth[monthKey]) {
              historyByMonth[monthKey] = {};
            }
            if (!historyByMonth[monthKey][dateKey]) {
              historyByMonth[monthKey][dateKey] = [];
            }

            historyByMonth[monthKey][dateKey].push({
              taskName: task.name,
              taskId: task._id,
              owner: {
                name: task.primaryOwner?.name || "Unassigned",
                profilePicture: task.primaryOwner?.profilePicture || null,
              },
              photos: update.photos,
              serviceReport: null, // Service report will be added separately if present.
              manHours: update.manHours || null,
              distanceTraveled: update.distanceTraveled || null,
            });
          }
        });

        if (hasServiceReport) {
          const reportDate = task.serviceReport.createdAt || (task.dailyUpdates[0] && task.dailyUpdates[0].date) || new Date();
          const formattedDate = new Date(reportDate);
          const monthKey = formattedDate.toLocaleString("default", {
            month: "long",
            year: "numeric",
          });
          const dateKey = formattedDate.toISOString().split("T")[0];

          if (!historyByMonth[monthKey]) {
            historyByMonth[monthKey] = {};
          }
          if (!historyByMonth[monthKey][dateKey]) {
            historyByMonth[monthKey][dateKey] = [];
          }

          historyByMonth[monthKey][dateKey].push({
            taskName: task.name,
            taskId: task._id,
            owner: {
              name: task.primaryOwner?.name || "Unassigned",
              profilePicture: task.primaryOwner?.profilePicture || null,
            },
            photos: [],
            serviceReport: task.serviceReport,
            manHours: null,
            distanceTraveled: null,
          });
        }
      }
    });

    const history = Object.keys(historyByMonth)
      .sort((a, b) => new Date(`1 ${b}`) - new Date(`1 ${a}`)) // Sort by most recent month
      .map((month) => ({
        month,
        dates: Object.keys(historyByMonth[month])
          .sort((a, b) => new Date(b) - new Date(a)) // Sort by most recent day
          .map((date) => ({
            date,
            entries: historyByMonth[month][date],
          })),
      }));

    return res.handler.response(
      STATUS_CODES.SUCCESS,
      "Project history fetched successfully",
      { history }
    );
  } catch (error) {
    console.error("Error fetching project history:", error.message);
    return res.handler.response(
      STATUS_CODES.SERVER_ERROR,
      "Error fetching project history"
    );
  }
};

exports.searchTasksAndProjects = async (req, res) => {
  try {
    const { q } = req.query;
    if (!q) {
      return res.status(400).json({ success: false, message: "Search param is required." });
    }
    const searchRegex = new RegExp(q, "i");

    // If the user is a Technician, only return tasks assigned to them.
    if (req.user.role === "Technician") {
      const taskQuery = {
        $and: [
          { name: { $regex: searchRegex } },
          { $or: [{ primaryOwner: req.user._id }, { secondaryOwner: req.user._id }] }
        ]
      };

      const tasks = await Task.find(taskQuery)
        .populate({
          path: "project",
          select: "location.name product",
          populate: {
            path: "product",
            select: "name productPicture",
          },
        })
        .populate({ path: "primaryOwner", select: "name profilePicture" })
        .populate({ path: "secondaryOwner", select: "name profilePicture" })
        .lean();

      return res.status(200).json({
        success: true,
        message: "Search results fetched successfully",
        data: { tasks },
      });
    }

    // Otherwise, for Project Managers and Admins, search both projects and tasks.
    let projectQuery = {
      $or: [
        { name: { $regex: searchRegex } },
        { "location.address": { $regex: searchRegex } }
      ]
    };

    let taskQuery = { $or: [{ name: { $regex: searchRegex } }] };

    // if (req.user.role === "ProjectManager") {
    //   // Find projects assigned to or created by the PM.
    //   const pmProjects = await Project.find({
    //     $or: [
    //       { createdBy: req.user._id },
    //       { teamMembers: { $elemMatch: { user: req.user._id, role: { $in: ["primaryProjectManager", "secondaryProjectManager"] } } } }
    //     ]
    //   }).select("_id").lean();

    //   const projectIds = pmProjects.map(project => project._id);

    //   projectQuery = {
    //     $and: [
    //       { _id: { $in: projectIds } },
    //       {
    //         $or: [
    //           { name: { $regex: searchRegex } },
    //           { "location.address": { $regex: searchRegex } }
    //         ]
    //       }
    //     ]
    //   };

    //   taskQuery.project = { $in: projectIds };
    // }

    const [projects, tasks] = await Promise.all([
      Project.find(projectQuery).select("name location _id").lean(),
      Task.find(taskQuery)
        .populate({
          path: "project",
          select: "location name product",
          populate: {
            path: "product",
            select: "name productPicture",
          },
        })
        .populate({ path: "primaryOwner", select: "name profilePicture" })
        .populate({ path: "secondaryOwner", select: "name profilePicture" })
        .lean()
    ]);

    return res.status(200).json({
      success: true,
      message: "Search results fetched successfully",
      data: { projects, tasks }
    });
  } catch (error) {
    console.error("Error in search API:", error.message);
    return res.status(500).json({
      success: false,
      message: "An error occurred while searching",
    });
  }
};

exports.deleteProject = async (req, res) => {
  try {
    const deletedProject = await handleTransaction(async (session) => {
      const project = await MongoUtils.findByIdWithSelect(
        Project,
        req.params.id,
        "name projectPicture clients stages",
        { session }
      );

      if (!project) {
        throw new Error("Project not found");
      }

      const projectName = project.name;

      if (project.projectPicture) {
        await deleteFileFromS3(project.projectPicture);
      }

      if (project.clients?.length) {
        const otherProjects = await Project.find({
          _id: { $ne: req.params.id },
          clients: { $in: project.clients },
        }).session(session);

        const clientsToDelete = project.clients.filter(
          (clientId) =>
            !otherProjects.some((otherProject) =>
              otherProject.clients.includes(clientId)
            )
        );

        if (clientsToDelete.length) {
          await Client.deleteMany({ _id: { $in: clientsToDelete } }, { session });
        }
      }

      const taskIds = project.stages?.flatMap((stage) => stage.tasks) || [];
      if (taskIds.length) {
        const tasks = await Task.find({ _id: { $in: taskIds } }, "dailyUpdates").session(session);
        const dailyUpdateIds = tasks.flatMap((task) => task.dailyUpdates || []);
        if (dailyUpdateIds.length) {
          const dailyUpdates = await DailyUpdate.find({ _id: { $in: dailyUpdateIds } }).session(session);
          for (const update of dailyUpdates) {
            if (update.photos?.length) {
              for (const photoUrl of update.photos) {
                await deleteFileFromS3(photoUrl);
              }
            }
          }
          await DailyUpdate.deleteMany({ _id: { $in: dailyUpdateIds } }, { session });
        }

        await ServiceReport.deleteMany({ task: { $in: taskIds } }, { session });

        await Task.deleteMany({ _id: { $in: taskIds } }, { session });
      }

      await project.deleteOne({ session });

      return { name: projectName, deletedAt: new Date() };
    });

    const admins = await User.find({ role: "Admin" }).select("email phoneNo").lean();
    const adminEmailList = admins.map((admin) => admin.email);
    const adminPhoneList = admins.map((admin) => admin.phoneNo);
    if (adminEmailList.length > 0) {
      await sendProjectDeletedEmail(adminEmailList, deletedProject.name, req.user.name, deletedProject.deletedAt);
      // await sendProjectDeletedWhatsApp(adminPhoneList, deletedProject.name, req.user.name, deletedProject.deletedAt);
    }

    return res.handler.response(
      STATUS_CODES.SUCCESS,
      "Project and associated data deleted successfully"
    );
  } catch (error) {
    console.error("Error deleting project:", error.message);
    return res.handler.response(STATUS_CODES.SERVER_ERROR, error.message);
  }
};
