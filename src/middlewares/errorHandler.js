const errorHandler = (err, req, res, next) => {
  // ── Log for server-side debugging ──
  if (process.env.NODE_ENV !== "production") {
    console.error(`[ERROR] ${req.method} ${req.originalUrl}:`, err.message);
    if (!(err.statusCode)) console.error(err.stack);
  }

  let statusCode = err.statusCode || 500;
  let message = err.message || "Internal server error";
  let errors = err.errors || null;

  // ── Mongoose CastError (invalid ObjectId etc.) ──
  if (err.name === "CastError") {
    statusCode = 400;
    message = `Invalid value for ${err.path || "field"}: "${err.value}"`;
  }

  // ── Mongoose ValidationError ──
  if (err.name === "ValidationError") {
    statusCode = 400;
    message = "Validation failed";
    errors = Object.values(err.errors).map((e) => ({
      field: e.path,
      message: e.message,
    }));
  }

  // ── Mongoose Duplicate Key ──
  if (err.code === 11000) {
    statusCode = 400;
    const field = Object.keys(err.keyValue || {})[0] || "field";
    message = `Duplicate value for "${field}". This already exists.`;
  }

  // ── Raw JS errors (TypeError, ReferenceError etc.) — hide internals ──
  if (err instanceof TypeError || err instanceof ReferenceError) {
    statusCode = 500;
    message = "Something went wrong while processing your request. Please check your input and try again.";
    errors = null;
  }

  // ── RESPONSE ──
  const response = {
    success: false,
    message,
  };

  if (errors) {
    response.errors = errors;
  }

  res.status(statusCode).json(response);
};

module.exports = errorHandler;
