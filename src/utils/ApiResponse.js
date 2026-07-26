class ApiResponse {
  constructor(statusCode, message = "success", resData) {
    this.statusCode = statusCode;
    this.message = message;
    this.success = true;
    this.resData = resData;
  }
}

module.exports = ApiResponse;
