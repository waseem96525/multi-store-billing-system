// Wrap async route handlers so Express 4 forwards rejections to the error
// middleware instead of crashing.
const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

module.exports = asyncHandler;
