const ROLE_PERMISSIONS = {
    Admin: ["createProject", "viewAllProjects", "searchTasksAndProjects", "projectDetails", "projectHistory", "updateProject", "deleteProject", "deleteClient", "updateClient", "addClient", "createTask", "viewAllTasks", "viewProjectTasks", "updateTaskTime", "updateManHours", "updateDistance", "uploadPhotos", "deletePhotos", "submitForReview", "markAsDone", "assignTask", "createTaskOnSchedule", "viewTaskDetails", "deleteTask", "addProduct", "addForm", "FormImage", "serviceReport"],
    ProjectManager: ["createProject", "viewAllProjects", "updateProject", "projectDetails","searchTasksAndProjects", "projectHistory","deleteClient", "updateClient", "addClient", "createTask", "viewAllTasks", "viewProjectTasks", "updateTaskTime", "updateManHours", "updateDistance", "uploadPhotos", "deletePhotos", "submitForReview", "markAsDone", "assignTask","createTaskOnSchedule", "viewTaskDetails", "deleteTask", "FormImage", "serviceReport"],
    Technician: ["projectDetails", "viewAllTasks", "searchTasksAndProjects","updateDistance", "uploadPhotos", "deletePhotos", "submitForReview", "viewTaskDetails", "FormImage", "serviceReport"],
};

module.exports = ROLE_PERMISSIONS;