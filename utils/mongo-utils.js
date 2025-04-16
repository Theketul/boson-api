const mongoose = require('mongoose');

class MongoUtils {
  static async findOneByField(Model, field, value, select = '') {
    return await Model.findOne({ [field]: value }).select(select);
  }

  static async findOneByFields(Model, fields, select = '') {
    return await Model.findOne({ $or: fields }).select(select);
  }

  static async findByIdWithSelect(Model, id, select = '') {
    return await Model.findById(id).select(select);
  }

  static async findWithPagination(Model, query = {}, options = {}) {
    const {
      page = 1,
      limit = 10,
      sort = { createdAt: -1 },
      select = '',
      populate = ''
    } = options;

    const skip = (page - 1) * limit;
    const data = await Model.find(query)
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .select(select)
      .populate(populate);

    const total = await Model.countDocuments(query);

    return {
      data,
      total,
      pages: Math.ceil(total / limit),
      currentPage: page
    };
  }

  static async aggregateWithPagination(Model, pipeline = [], options = {}) {
    const { page = 1, limit = 10 } = options;
    
    const [result] = await Model.aggregate([
      ...pipeline,
      {
        $facet: {
          data: [
            { $skip: (page - 1) * limit },
            { $limit: limit }
          ],
          total: [{ $count: 'count' }]
        }
      }
    ]);

    return {
      data: result.data,
      total: result.total[0]?.count || 0,
      pages: Math.ceil((result.total[0]?.count || 0) / limit),
      currentPage: page
    };
  }

  static buildAggregateQuery({
    match = {},
    sort = { createdAt: -1 },
    lookup = [],
    project = {},
    group = null
  }) {
    const pipeline = [];

    if (Object.keys(match).length) pipeline.push({ $match: match });
    if (lookup.length) pipeline.push(...lookup);
    if (Object.keys(project).length) pipeline.push({ $project: project });
    if (group) pipeline.push({ $group: group });
    if (Object.keys(sort).length) pipeline.push({ $sort: sort });

    return pipeline;
  }
}

module.exports = MongoUtils;