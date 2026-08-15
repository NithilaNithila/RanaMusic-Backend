const sanitizePagination = ({ page, limit } = {}) => ({
  page: Math.max(parseInt(page, 10) || 0, 0),
  limit: Math.min(Math.max(parseInt(limit, 10) || 20, 1), 50),
});

module.exports = { sanitizePagination };
