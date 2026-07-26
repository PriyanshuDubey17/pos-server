const ADMIN_ACCESS_TOKEN = "adminAccessToken";
const ADMIN_REFRESH_TOKEN = "adminRefreshToken";

const getCookieBaseOptions = () => {
  const isProduction = process.env.NODE_ENV === "production";

  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? "strict" : "lax",
  };
};

const getAdminAccessCookieOptions = () => ({
  ...getCookieBaseOptions(),
  maxAge: 15 * 60 * 1000,
});

const getAdminRefreshCookieOptions = () => ({
  ...getCookieBaseOptions(),
  maxAge: 7 * 24 * 60 * 60 * 1000,
});

module.exports = {
  ADMIN_ACCESS_TOKEN,
  ADMIN_REFRESH_TOKEN,
  getCookieBaseOptions,
  getAdminAccessCookieOptions,
  getAdminRefreshCookieOptions,
};
