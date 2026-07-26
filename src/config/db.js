const mongoose = require("mongoose");

/**
 * Cached Mongo connection for serverless (Vercel) and local Node.
 * Reuses the same promise across warm invocations; never calls process.exit.
 */
let mongoConnectionPromise = null;

const connectDB = async () => {
  if (!process.env.MONGO_URI) {
    throw new Error("MONGO_URI is not set");
  }

  if (mongoose.connection.readyState === 1) {
    return mongoose.connection;
  }

  if (!mongoConnectionPromise) {
    mongoConnectionPromise = mongoose
      .connect(process.env.MONGO_URI)
      .then((connection) => {
        console.log("MongoDB Connected");
        return connection;
      })
      .catch((error) => {
        mongoConnectionPromise = null;
        console.error("MongoDB Error:", error.message);
        throw error;
      });
  }

  return mongoConnectionPromise;
};

module.exports = connectDB;
