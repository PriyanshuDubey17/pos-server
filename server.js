require("dotenv").config();
const server = require("./app");
const connectDB = require("./src/config/db");

connectDB();

const PORT = process.env.PORT || 5002;

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
