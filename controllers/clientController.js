const Project = require("../models/projectModel");
const Client = require("../models/clientModel");
const mongoose = require("mongoose");

exports.addClientToProject = async (req, res) => {
    const { projectId } = req.params; 
    const { name, contactNumber } = req.body;  
  
    let session;
  
    try {
      session = await mongoose.startSession();
      session.startTransaction();
  
      const newClient = new Client({ name, contactNumber });
      const savedClient = await newClient.save({ session });
  
      const updatedProject = await Project.findByIdAndUpdate(
        projectId,
        { $push: { clients: savedClient._id } },  
        { new: true, session }  
      );
  
      if (!updatedProject) {
        throw new Error("Project not found");
      }
  
      await session.commitTransaction();
      session.endSession();
  
      return res.handler.response(
        STATUS_CODES.SUCCESS,
        "Client added to the project successfully",
        { project: updatedProject, client: savedClient }
      );
    } catch (error) {
      if (session) await session.abortTransaction();
      session?.endSession();
  
      console.error("Error adding client to project:", error.message);
      return res.handler.response(STATUS_CODES.SERVER_ERROR, error.message);
    }
};
  
exports.updateClient = async (req, res) => {
    const { clientId } = req.params;
    const updateData = req.body;
  
    try {
      const updatedClient = await Client.findByIdAndUpdate(clientId, updateData, { new: true });
      if (!updatedClient) {
        return res.handler.response(STATUS_CODES.NOT_FOUND, "Client not found");
      }
  
      const project = await Project.findOne({ clients: clientId });
      if (project) {
        project.clients = [clientId];
        await project.save();
      }
  
      return res.handler.response(STATUS_CODES.SUCCESS, "Client updated successfully", updatedClient);
    } catch (error) {
      console.error("Error updating client:", error.message);
      return res.handler.response(STATUS_CODES.SERVER_ERROR, "Error updating client");
    }
  };
  
  exports.deleteClient = async (req, res) => {
    const { clientId } = req.params;
    try {
      const projects = await Project.find({ clients: clientId });
  
      for (const project of projects) {
        if (project.clients.length <= 1) {
          return res.handler.response(
            STATUS_CODES.BAD_REQUEST,
            "there should at least be one client in the project"
          );
        }
      }
  
      const deletedClient = await Client.findByIdAndDelete(clientId);
      if (!deletedClient) {
        return res.handler.response(STATUS_CODES.NOT_FOUND, "Client not found");
      }
  
      await Project.updateMany({ clients: clientId }, { $pull: { clients: clientId } });
  
      return res.handler.response(STATUS_CODES.SUCCESS, "Client deleted successfully");
    } catch (error) {
      console.error("Error deleting client:", error.message);
      return res.handler.response(STATUS_CODES.SERVER_ERROR, "Error deleting client");
    }
  };