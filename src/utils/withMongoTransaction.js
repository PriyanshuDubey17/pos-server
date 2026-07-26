const mongoose = require("mongoose");
const ApiError = require("./ApiError");

/**
 * Run work inside a MongoDB multi-document transaction.
 * Requires a replica set (or Atlas). Does NOT fall back to non-transactional
 * writes — stock/sale mutations must be atomic.
 *
 * Local/dev: start mongod with --replSet (or use Atlas).
 *
 * @template T
 * @param {(session: import("mongoose").ClientSession) => Promise<T>} work
 * @returns {Promise<T>}
 */
const withMongoTransaction = async (work) => {
  const session = await mongoose.startSession();
  try {
    session.startTransaction();
    const result = await work(session);
    await session.commitTransaction();
    return result;
  } catch (err) {
    if (session.inTransaction()) {
      await session.abortTransaction();
    }

    const isTxnUnsupported =
      err?.code === 20 ||
      /Transaction numbers are only allowed/i.test(err?.message || "");

    if (isTxnUnsupported) {
      throw new ApiError(
        "Database must run as a replica set for sales and stock updates. Contact support.",
        503,
      );
    }

    throw err;
  } finally {
    session.endSession();
  }
};

module.exports = { withMongoTransaction };
