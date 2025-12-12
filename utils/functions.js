const Task = require("../models/taskModel");
const Project = require("../models/projectModel");
const moment = require("moment");
const axios = require("axios");
const { sendProjectMaintenanceEmail } = require("./emailService");
const { sendProjectMaintenanceWhatsApp } = require("./whatsappService");
// const ProductTaskMapping = require("../models/ProductTaskMapping");
// const { mappings } = require("../scripts/createFormTamplate");

const UTIL_CONFIG = {
  DEFAULT_CHARSET:
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789",
  PROJECT_STATUS: {
    MAINTENANCE: "Maintenance",
    ONGOING: "On-going",
    TODO: "To-do",
    TO_START: "To-start",
  },
};

const randomString = (len, charSet = UTIL_CONFIG.DEFAULT_CHARSET) => {
  if (!len) throw new Error("Length is required");
  let result = "";
  for (let i = 0; i < len; i++) {
    const randomPoz = Math.floor(Math.random() * charSet.length);
    result += charSet.charAt(randomPoz);
  }
  return result;
};

const validateEmail = (email) => {
  if (!email) return false;
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return re.test(String(email).toLowerCase());
};

const secondsToTime = (secs) => {
  if (!secs || secs < 0) return "00:00:00";

  const hours = Math.floor(secs / 3600);
  const minutes = Math.floor((secs % 3600) / 60);
  const seconds = Math.ceil(secs % 60);

  const pad = (num) => String(num).padStart(2, "0");
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
};

const getDomainName = (hostname) => {
  if (!hostname) return null;

  const parts = hostname.split(".").reverse();
  if (parts.length <= 1) return hostname;

  let domain = `${parts[1]}.${parts[0]}`;
  if (hostname.toLowerCase().includes(".co.uk") && parts.length > 2) {
    domain = `${parts[2]}.${domain}`;
  }
  return domain;
};

const jsonStringify = (obj) => {
  try {
    return JSON.parse(JSON.stringify(obj));
  } catch (error) {
    console.error("JSON parsing error:", error);
    return obj;
  }
};

const updateProjectStatus = async (project) => {
  if (!project?.stages) throw new Error("Invalid project data");

  const originalStatus = project.status;

  const analysis = await analyzeProjectStages(project.stages);
  const newStatus = determineProjectStatus(analysis);

  await Project.findByIdAndUpdate(project._id, { status: newStatus });

  if (newStatus === UTIL_CONFIG.PROJECT_STATUS.MAINTENANCE && originalStatus !== newStatus) {
    const admins = await User.find({ role: "Admin" }).select("email phoneNo").lean();
    const adminEmailList = admins.map(admin => admin.email);
    const adminPhoneList = admins.map(admin => admin.phoneNo);

    const pmIds = project.teamMembers
      .filter(member => member.role === "primaryProjectManager" || member.role === "secondaryProjectManager")
      .map(member => member.user);
    const pmUsers = await User.find({ _id: { $in: pmIds } }).select("email phoneNo").lean();
    const pmEmailList = pmUsers.map(pm => pm.email);
    const pmPhoneList = pmUsers.map(pm => pm.phoneNo);

    if (adminEmailList.length || pmEmailList.length) {
      await sendProjectMaintenanceEmail(adminEmailList, pmEmailList, project.name);
      // await sendProjectMaintenanceWhatsApp(adminPhoneList, pmPhoneList, project.name);
    }
  }

  return { success: true, status: newStatus };
};

const analyzeProjectStages = async (stages) => {
  let hasWIPTask = false;
  let hasPendingTasksInOtherStages = false;
  let totalTasksCount = 0;

  for (const stage of stages) {
    const tasks = await Task.find({ _id: { $in: stage.tasks } });

    totalTasksCount += tasks.length;

    const isWIP = tasks.some(
      (task) => task.status === UTIL_CONFIG.PROJECT_STATUS.ONGOING
    );
    const hasPending = tasks.some((task) =>
      [
        UTIL_CONFIG.PROJECT_STATUS.TODO,
        UTIL_CONFIG.PROJECT_STATUS.ONGOING,
      ].includes(task.status)
    );

    if (stage.name !== UTIL_CONFIG.PROJECT_STATUS.MAINTENANCE && hasPending) {
      hasPendingTasksInOtherStages = true;
    }
    if (isWIP) hasWIPTask = true;
  }

  return { hasWIPTask, hasPendingTasksInOtherStages, totalTasksCount };
};

const determineProjectStatus = ({
  hasWIPTask,
  hasPendingTasksInOtherStages,
  totalTasksCount,
}) => {
  if (totalTasksCount === 0) {
    return UTIL_CONFIG.PROJECT_STATUS.TO_START;
  }

  if (!hasPendingTasksInOtherStages && !hasWIPTask) {
    return UTIL_CONFIG.PROJECT_STATUS.MAINTENANCE;
  }

  return hasWIPTask
    ? UTIL_CONFIG.PROJECT_STATUS.ONGOING
    : UTIL_CONFIG.PROJECT_STATUS.TO_START;
};

const updateAllProjectsStatus = async () => {
  try {
    const projects = await Project.find({}).lean();
    await Promise.all(projects.map(async (proj) => {
      await updateProjectStatus(proj);
    }));
    return { success: true, message: "All projects updated" };
  } catch (error) {
    console.error("Error updating projects:", error);
    throw new Error("Failed to update projects status");
  }
};

const determineTaskStatus = (startDate, endDate) => {
  const currentDate = new Date();

  if (!startDate || !endDate) {
    return "To-do";
  }

  if (currentDate < new Date(startDate)) {
    return "To-do";
  } else if (
    currentDate >= new Date(startDate) &&
    currentDate <= new Date(endDate)
  ) {
    return "On-going";
  } else {
    return "Delayed";
  }
};

const updateTaskStatusAndSave = async (task) => {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const startDate = new Date(task.startDate);
  const endDate = new Date(task.endDate);

  const startDay = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
  const endDay = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate());

  // Keep original logic for these statuses
  if (task.status === "To-review" || task.status === "Completed") {
    return task;
  }

  if (startDay > today) {
    task.status = "To-do";
  } else if (startDay <= today && endDay >= today) {
    task.status = "On-going";
  } else if (today > endDay) {  
    // Delayed only AFTER the full end date day has passed
    task.status = "Delayed";
  }
console.log(`Updating task ${task._id} status to ${task.status}`);
  await task.save();
  return task;
};


const calculateTaskDates = (repeat, startDate) => {
  const { frequency, interval, daysOfWeek, endCondition, monthlyOption } =
    repeat;
  const dates = [];
  let currentDate = new Date(startDate);
  currentDate.setUTCHours(0, 0, 0, 0);

  // Validate the start date
  if (isNaN(currentDate)) {
    console.error("Invalid start date:", startDate);
    return [];
  }

  // Determine the end condition
  let maxEndDate = null; // Used if the end condition is "1 year"
  if (endCondition.type === "oneYear") {
    maxEndDate = new Date(currentDate);
    maxEndDate.setFullYear(maxEndDate.getFullYear() + 1);
  } else if (endCondition.type === "endDate") {
    maxEndDate = new Date(endCondition.endDate);
    if (isNaN(maxEndDate)) {
      console.error("Invalid end date:", endCondition.endDate);
      return [];
    }
  }

  const maxOccurrences =
    endCondition.type === "occurrences" ? endCondition.occurrences : Infinity;
  const maxIterations = 10000;
  let iterationCount = 0;

  // Normalize custom day numbering for monthly option
  const normalizeDayNumbering = (day) => (day + 1) % 7; // Convert to 0 (Sunday) - 6 (Saturday)

  while (dates.length < maxOccurrences) {
    iterationCount++;
    if (iterationCount > maxIterations) {
      console.error("Loop exceeded max iterations, exiting.");
      break;
    }

    if (maxEndDate && currentDate > maxEndDate) break;

    if (frequency === "daily") {
      dates.push(new Date(currentDate));
      currentDate.setDate(currentDate.getDate() + interval);
    } else if (
      frequency === "weekly" &&
      Array.isArray(daysOfWeek) &&
      daysOfWeek.length > 0
    ) {
      // Generate tasks for each selected day in the week
      daysOfWeek.forEach((day) => {
        const nextDate = new Date(currentDate);
        const dayDifference = (day - nextDate.getDay() + 7) % 7;
        nextDate.setDate(nextDate.getDate() + dayDifference);

        if (
          !dates.some((date) => date.getTime() === nextDate.getTime()) &&
          (!maxEndDate || nextDate <= maxEndDate)
        ) {
          dates.push(new Date(nextDate));
        }
      });
      currentDate.setDate(currentDate.getDate() + 7 * interval);
    } else if (frequency === "monthly") {
      if (monthlyOption === "firstDay") {
        // First day of the month, normalized to midnight
        const firstDay = new Date(
          currentDate.getFullYear(),
          currentDate.getMonth() + 1,
          2
        );
        firstDay.setUTCHours(0, 0, 0, 0); // Ensure time is set to midnight UTC

        // Add the first day if it meets conditions
        if (
          (!maxEndDate || firstDay <= maxEndDate) &&
          !dates.some((d) => d.getTime() === firstDay.getTime())
        ) {
          dates.push(firstDay);
        }
      } else if (monthlyOption === "lastDay") {
        currentDate.setUTCHours(0, 0, 0, 0);

        const lastDay = new Date(
          currentDate.getFullYear(),
          currentDate.getMonth() + 1
        );
        lastDay.setUTCHours(0, 0, 0, 0);

        // Add the last day if it meets conditions
        if (
          (!maxEndDate || lastDay <= maxEndDate) &&
          !dates.some((d) => d.getTime() === lastDay.getTime())
        ) {
          dates.push(lastDay);
        }
      } else if (
        monthlyOption === "nthDay" &&
        daysOfWeek &&
        daysOfWeek.length > 0
      ) {
        const nthOccurrence = repeat.nthOccurrence || 1; // Default to 1st if not provided
        const targetDay = normalizeDayNumbering(daysOfWeek[0]); // Normalize day numbering
        const firstOfMonth = new Date(
          currentDate.getFullYear(),
          currentDate.getMonth(),
          1
        );
        let dayOffset = (targetDay - firstOfMonth.getDay() + 7) % 7;

        if (dayOffset === 0 && nthOccurrence > 1) {
          dayOffset += 7; // Adjust when the first occurrence falls exactly on the 1st week
        }

        const nthDay = new Date(firstOfMonth);
        nthDay.setDate(
          firstOfMonth.getDate() + dayOffset + (nthOccurrence - 1) * 7
        );

        if (
          nthDay.getMonth() === currentDate.getMonth() &&
          (!maxEndDate || nthDay <= maxEndDate) &&
          !dates.some((d) => d.getTime() === nthDay.getTime())
        ) {
          dates.push(new Date(nthDay));
        }
      } else {
        console.error(
          "Invalid monthlyOption or missing parameters:",
          monthlyOption
        );
        break;
      }

      currentDate.setUTCMonth(currentDate.getUTCMonth() + interval);
      currentDate.setUTCHours(0, 0, 0, 0);
    } else {
      console.error("Unknown frequency or missing parameters:", frequency);
      break;
    }
  }

  return dates;
};

const getDatesInRange = (start, end) => {
  const dates = [];
  let current = new Date(start);

  while (current <= end) {
    dates.push(new Date(current));
    current.setDate(current.getDate() + 1);
  }

  return dates;
};

const getCityAndStateFromPinCode = async (pinCode) => {
  try {
    const response = await axios.get(`https://api.postalpincode.in/pincode/${pinCode}`);
    if (response.data && response.data[0]?.Status === "Success") {
      const { District: city, State: state } = response.data[0].PostOffice[0];
      return { city, state };
    } else {
      console.error("Invalid pin code or no data found for pin:", pinCode);
      return { city: null, state: null };
    }
  } catch (error) {
    console.error("Error fetching city and state:", error.message);
    return { city: null, state: null };
  }
};

// const mapTasks = async () => {
//   const data = await ProductTaskMapping.insertMany(mappings);
//   // console.log("Data:", data);
// };

const generateDates = (startDate, endDate) => {
  const dates = [];
  const start = new Date(startDate);
  const end = new Date(endDate);

  if (start > end) {
    throw new Error("Start date cannot be after end date");
  }

  while (start <= end) {
    dates.push(new Date(start));
    start.setDate(start.getDate() + 1);
  }

  return dates;
};

module.exports = {
  generateDates,
  getCityAndStateFromPinCode,
  getDatesInRange,
  randomString,
  validateEmail,
  secondsToTime,
  getDomainName,
  determineTaskStatus,
  updateTaskStatusAndSave,
  calculateTaskDates,
  jsonStringify,
  updateAllProjectsStatus,
  updateProjectStatus,
  UTIL_CONFIG,
  // mapTasks,
};
