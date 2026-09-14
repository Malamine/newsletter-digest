// Express 4 ne catch pas les rejets de promesses dans les handlers async :
// sans ce wrapper, une erreur async fait planter tout le process au lieu de renvoyer une 500.
export function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}
